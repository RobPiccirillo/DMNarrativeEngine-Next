import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it,vi } from 'vitest';
import { fixture, tree } from './migrationFixtures.js';
import { acquireLease, inspectLease, recoverLease } from '../lib/dataDirectoryLease.js';
import { captureSnapshot, validateSnapshot, snapshotBinding } from '../services/campaignMigration/snapshot.js';
import { openCampaignDb, migrate, MIGRATIONS, transaction, integrity } from '../db/campaignDb.js';
import { canonical } from '../services/campaignMigration/artifact.js';

const fixtures = [];
const make = () => { const f = fixture(); fixtures.push(f); return f; };
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()));
describe('Package A: immutable substrate', () => {
    it('preserves exact bytes/presence and isolates SQLite with readonly reopen', () => {
        const f = make(), before = tree(f.dataRoot);
        f.write('.npcs.json', [{ id: 'legacy', secret: 'a fictional token' }]);
        const captured = tree(f.dataRoot);
        const { manifest } = captureSnapshot({ ...f, artifactKey: 'one' });
        expect(tree(f.dataRoot)).toEqual(captured);
        expect(before).not.toEqual(captured);
        const snapshot = path.join(f.artifactRoot, 'one/snapshot');
        expect(validateSnapshot(snapshot).digest).toBe(manifest.digest);
        const options = { file: path.join(f.artifactRoot, 'one/work/campaign.sqlite'), binding: snapshotBinding(manifest) };
        const db = openCampaignDb({ ...options, mode: 'create-staging' });
        try {
            expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
            expect(db.pragma('synchronous', { simple: true })).toBe(2);
            expect(() => transaction(db, () => { db.prepare('DELETE FROM staging_campaign').run(); return Promise.resolve(); })).toThrow('async-transaction');
            expect(db.prepare('SELECT count(*) n FROM staging_campaign').get().n).toBe(1);
            const bad = { version: 2, name: 'fault', sql: 'CREATE TABLE should_rollback(x); INSERT INTO absent VALUES (1);' };
            expect(() => migrate(db, [...MIGRATIONS, bad])).toThrow();
            expect(db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get()).toBeUndefined();
            expect(db.pragma('user_version', { simple: true })).toBe(1);
            expect(() => migrate(db, [{ ...MIGRATIONS[0], name: 'altered' }])).toThrow('history');
            migrate(db); expect(integrity(db)).toBe(true);
        } finally { db.close(); }
        const read = openCampaignDb({ ...options, mode: 'inspect-readonly' });
        try { expect(() => read.prepare('DELETE FROM staging_campaign').run()).toThrow(); } finally { read.close(); }
        expect(() => openCampaignDb({ ...options, mode: 'create-staging' })).toThrow('destination-exists');
        expect(() => openCampaignDb({ ...options, mode: 'inspect-readonly', binding: {} })).toThrow('binding');
    });
    it('detects cooperating child processes and requires explicit exact-token recovery', () => {
        const f = make(), lease = acquireLease(f.dataRoot, 'test');
        try {
            const script = `import {acquireLease} from './server/lib/dataDirectoryLease.js'; try { acquireLease(process.argv[1], 'child'); process.exit(2); } catch(e) { process.exit(e.code === 'lease-busy' ? 0 : 3); }`;
            expect(spawnSync(process.execPath, ['--input-type=module', '-e', script, f.dataRoot]).status).toBe(0);
            expect(() => captureSnapshot(f)).toThrow('lease-busy');
            expect(() => recoverLease(f.dataRoot, lease.owner.token, false)).toThrow();
            expect(() => recoverLease(f.dataRoot, lease.owner.token, true)).toThrow('lease-owner-running');
            expect(inspectLease(f.dataRoot).token).toBe(lease.owner.token);
        } finally { lease.release(); }
        fs.writeFileSync(path.join(f.dataRoot, '.data-directory.lease'), canonical({ pid: 999999, token: 'dead', purpose: 'test' }));
        expect(() => acquireLease(f.dataRoot, 'test')).toThrow('busy');
        expect(recoverLease(f.dataRoot, 'dead', true)).toContain('quarantine');
    });
    it('fails unsealed on drift and forbids credential/debug copying without narrative false positives', () => {
        const f = make();
        expect(() => captureSnapshot({ ...f, artifactKey: 'drift', fault: () => f.write('.facts.json', []) })).toThrow('source-drift');
        expect(fs.existsSync(path.join(f.artifactRoot, 'drift/snapshot'))).toBe(false);
        f.write('.state.json', { context: {}, messages: [{ debugPayload: { apiKey: 'CANARY-DO-NOT-PERSIST' } }] });
        const before = tree(f.dataRoot);
        expect(() => captureSnapshot({ ...f, artifactKey: 'secret' })).toThrow('prohibited-structured-material');
        expect(tree(f.dataRoot)).toEqual(before);
        expect(fs.existsSync(path.join(f.artifactRoot, 'secret'))).toBe(false);
        for(const field of ['x-api-key','clientSecret','bearerToken','authorizationHeaders']) {
            f.write('.state.json',{context:{[field]:'CANARY-DO-NOT-PERSIST'},messages:[]});
            const contaminated=tree(f.dataRoot);
            expect(()=>captureSnapshot({...f,artifactKey:'rejected'})).toThrow('prohibited-structured-material');
            expect(tree(f.dataRoot)).toEqual(contaminated);
            expect(fs.existsSync(path.join(f.artifactRoot,'rejected'))).toBe(false);
        }
        f.write('.state.json',{context:{note:'A scroll reads "apiKey": "a token of friendship".'},messages:[]});
        expect(()=>captureSnapshot({...f,artifactKey:'fiction'})).not.toThrow();
        expect(() => captureSnapshot({ ...f, campaign: '../escape' })).toThrow();
    });
    it('rejects modified sealed payloads and does not copy unrelated global material', () => {
        const f = make(); fs.writeFileSync(path.join(f.dataRoot, 'settings.json'), '{"apiKey":"DO-NOT-COPY"}');
        captureSnapshot({ ...f, artifactKey: 'one' });
        const snapshot = path.join(f.artifactRoot, 'one/snapshot');
        expect(Object.keys(tree(snapshot)).some(p => p.includes('settings'))).toBe(false);
        fs.appendFileSync(path.join(snapshot, 'source/campaigns/test.json'), ' ');
        expect(() => validateSnapshot(snapshot)).toThrow('source-hash');
    });
    it('handles injected fsync failure without sealing or changing sources',()=> {
        const f=make(),before=tree(f.dataRoot),original=fs.fsyncSync;
        let count=0;
        const spy=vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(++count===2) throw new Error('ENOSPC');original(fd);});
        try {expect(()=>captureSnapshot({...f,artifactKey:'disk'})).toThrow('ENOSPC');} finally {spy.mockRestore();}
        expect(tree(f.dataRoot)).toEqual(before);expect(fs.existsSync(path.join(f.artifactRoot,'disk/snapshot'))).toBe(false);
    });
    it('inspects without a DB and never recovers identity by rename or reused storage key',()=> {
        const f=make();
        const preview=captureSnapshot({...f,dryRun:true});expect(preview.status).toBe('inspected');expect(fs.existsSync(f.artifactRoot)).toBe(false);
        const a=captureSnapshot({...f,artifactKey:'a'}).manifest;
        f.write('.json',{id:'test',name:'Renamed'});
        const b=captureSnapshot({...f,artifactKey:'b'}).manifest;
        expect(a.identity.campaignId).not.toBe(b.identity.campaignId);
        expect(validateSnapshot(path.join(f.artifactRoot,'a/snapshot')).digest).toBe(a.digest);
        fs.unlinkSync(path.join(f.dataRoot,'campaigns/test.state.json'));
        expect(captureSnapshot({...f,dryRun:true}).blockers).toBeGreaterThan(0);
    });
});
