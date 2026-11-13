import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach,describe,it,expect } from 'vitest';
import { fixture,tree } from './migrationFixtures.js';
import { captureSnapshot } from '../services/campaignMigration/snapshot.js';
import { importSnapshot,verifyArtifact,withArtifact } from '../services/campaignMigration.js';
import { inspectLease,recoverLease } from '../lib/dataDirectoryLease.js';
import { backupArtifact,validateBackup } from '../services/campaignMigration/recovery.js';

const active=[];
afterEach(()=>active.splice(0).forEach(f=>f.cleanup()));
function setup(){const f=fixture();active.push(f);captureSnapshot({...f,artifactKey:'one'});return {...f,artifactKey:'one',run:'default'};}
describe('real killed-process staging recovery',()=> {
    for(const point of ['source-before-commit','source-after-commit']) it(point,()=> {
        const opts=setup(),before=tree(opts.dataRoot);
        const child=spawnSync(process.execPath,['server/__tests__/migrationCrashChild.mjs',opts.artifactRoot,point],{timeout:10000,encoding:'utf8'});
        expect(child.status).not.toBe(0);
        const root=path.join(opts.artifactRoot,'one'),lease=inspectLease(root,'.artifact.lease');
        expect(lease?.token).toBeTruthy();
        expect(()=>importSnapshot(opts)).toThrow('lease-busy');
        recoverLease(root,lease.token,true,'.artifact.lease');
        withArtifact(opts,ctx=> {
            const sources=ctx.db.prepare('SELECT count(*) n FROM migration_sources').get().n;
            expect(sources).toBe(point==='source-before-commit'?0:1);
            expect(ctx.db.prepare('SELECT count(*) n FROM migration_command_outcomes').get().n).toBe(sources+1);
        });
        importSnapshot(opts);expect(verifyArtifact(opts).status).toBe('verified');
        expect(tree(opts.dataRoot)).toEqual(before);
    });
    it('a killed backup is unpublished and a fresh backup succeeds',async()=> {
        const opts=setup();importSnapshot(opts);verifyArtifact(opts);
        const child=spawnSync(process.execPath,['server/__tests__/migrationCrashChild.mjs',opts.artifactRoot,'backup-after-db'],{timeout:10000,encoding:'utf8'});
        expect(child.status).not.toBe(0);
        const root=path.join(opts.artifactRoot,'one');
        recoverLease(root,inspectLease(root,'.artifact.lease').token,true,'.artifact.lease');
        expect(()=>validateBackup(path.join(root,'backups/interrupted.partial'))).toThrow();
        expect((await backupArtifact({...opts,backupKey:'fresh'})).backupKey).toBe('fresh');
    });
    for(const point of ['verification-before-commit','verification-after-commit']) it(point+' recovers publication',()=> {
        const opts=setup();importSnapshot(opts);
        const child=spawnSync(process.execPath,['server/__tests__/migrationCrashChild.mjs',opts.artifactRoot,point],{timeout:10000,encoding:'utf8'});
        expect(child.status).not.toBe(0);
        const root=path.join(opts.artifactRoot,'one');
        recoverLease(root,inspectLease(root,'.artifact.lease').token,true,'.artifact.lease');
        withArtifact(opts,ctx=> {
            const run=ctx.db.prepare('SELECT status,report_digest FROM migration_runs WHERE run_id=?').get('default');
            expect(run.status).toBe(point==='verification-before-commit'?'imported':'verified');
        });
        expect(verifyArtifact(opts).status).toBe('verified');
        expect(fs.existsSync(path.join(root,'reports/default.json'))).toBe(true);
    });
    it('CLI is explicit, rejects cutover and retains snapshots on discard',()=> {
        const opts=setup();
        const cli=(...args)=>spawnSync(process.execPath,['scripts/campaign-migration.mjs',...args,'--data-root',opts.dataRoot,'--artifact-root',opts.artifactRoot,'--artifact','one'],{encoding:'utf8',timeout:10000});
        expect(cli('commit-cutover').status).toBe(4);
        expect(cli('import').status).toBe(0);
        expect(cli('verify').status).toBe(0);
        expect(JSON.parse(cli('discard','--dry-run').stdout).snapshotRetained).toBe(true);
        expect(cli('discard').status).toBe(0);
        expect(fs.existsSync(path.join(opts.artifactRoot,'one/snapshot/manifest.json'))).toBe(true);
        expect(fs.existsSync(path.join(opts.artifactRoot,'one/work'))).toBe(false);
    });
});
