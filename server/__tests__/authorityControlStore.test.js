import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityControlStore } from '../lib/authorityControlStore.js';
import { createStableId, createCompatibilityReferences, ROOT_CAMPAIGN_SCOPE } from '../../packages/engine/dist/contracts/identity.js';
import { isAuthorityControlDocument } from '@narrative/engine/contracts/authorityControl';

const campaign = createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'test', key: 'campaign' });
const other = createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'test', key: 'other' });
const init = { type: 'initialize', legacyOwner: 'legacy', formatEpoch: 0 };
const report = { type: 'canonical', kind: 'evidence', id: createStableId({ kind: 'evidence', campaign, namespace: 'test', key: 'verified-snapshot' }) };
const [legacyReportId] = createCompatibilityReferences({
    kind: 'evidence', campaign: 'legacy-c', namespace: 'test', family: 'verification', version: 'snapshot-1',
    scope: { mode: 'compatibility' },
}, ['report']);
const reportForms = [report, { type: 'compatibility', kind: 'evidence', id: legacyReportId }];
let directory;
let store;
let file;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-control-'));
    store = createAuthorityControlStore(path.join(directory, 'authority'));
    file = path.join(directory, 'authority', 'campaign.authority.json');
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
function initialize() {
    expect(store.initialize('campaign', campaign).status).toBe('saved');
    expect(store.apply('campaign', campaign, 0, 'future.items', init).status).toBe('saved');
}
function advance(type, fields = {}) {
    const doc = store.load('campaign', campaign).document;
    const state = doc.domains[0];
    return store.apply('campaign', campaign, doc.revision, state.domainId, {
        type, expectedOwner: ['legacy', 'shadow'].includes(state.stage) ? state.legacyOwner : state.newOwner,
        expectedFormatEpoch: state.formatEpoch, ...fields,
    });
}
describe('authority control sidecar', () => {
    describe.each(reportForms)('closed verification persistence: $type', reference => {
        it('roundtrips an exact reference through real store transition/save/load', () => {
            initialize();
            advance('begin-shadow', { newOwner: 'repository.items' });
            expect(advance('verify', { verification: reference }).status).toBe('saved');
            const loaded = createAuthorityControlStore(path.dirname(file)).load('campaign', campaign);
            expect(loaded.status).toBe('loaded');
            expect(loaded.document.domains[0].verification).toEqual(reference);
            expect(isAuthorityControlDocument(loaded.document)).toBe(true);
        });
        it.each([
            { fictionalState: { hp: 7 } }, { cutoverApproved: true },
            { metadata: { nested: { ignored: false } } }, { extra: 42 },
        ])('refuses extended verify operation without writing %#', extra => {
            initialize();
            advance('begin-shadow', { newOwner: 'repository.items' });
            const before = fs.readFileSync(file, 'utf8');
            const revision = store.load('campaign', campaign).document.revision;
            expect(advance('verify', { verification: { ...reference, ...extra } }))
                .toEqual({ status: 'rejected', reason: 'malformed-operation' });
            expect(fs.readFileSync(file, 'utf8')).toBe(before);
            expect(store.load('campaign', campaign).document.revision).toBe(revision);
        });
        it.each(['shadow', 'sqlite', 'retired'])('does not load or repair extended persisted reference in %s', stage => {
            initialize();
            advance('begin-shadow', { newOwner: 'repository.items' });
            advance('verify', { verification: reference });
            if (stage !== 'shadow') {
                advance('prepare-cutover');
                advance('commit-cutover', { nextFormatEpoch: 1 });
            }
            if (stage === 'retired') {
                advance('mark-new-owner-write');
                advance('retire');
            }
            const doc = store.load('campaign', campaign).document;
            doc.domains[0].verification.fictionalState = { hp: 7 };
            expect(isAuthorityControlDocument(doc)).toBe(false);
            const raw = JSON.stringify(doc);
            fs.writeFileSync(file, raw);
            expect(store.load('campaign', campaign)).toEqual({ status: 'malformed' });
            expect(store.initialize('campaign', campaign)).toEqual({ status: 'malformed' });
            expect(store.apply('campaign', campaign, doc.revision, 'future.items', init)).toEqual({ status: 'malformed' });
            expect(fs.readFileSync(file, 'utf8')).toBe(raw);
        });
    });
    it('missing files and missing domains remain unadopted without writes', () => {
        expect(store.load('campaign', campaign)).toEqual({ status: 'missing' });
        expect(fs.existsSync(path.dirname(file))).toBe(false);
        expect(store.apply('campaign', campaign, 0, 'future.items', init)).toEqual({ status: 'missing' });
        expect(fs.existsSync(file)).toBe(false);
        expect(store.initialize('campaign', campaign).document.domains).toEqual([]);
        expect(store.load('campaign', campaign).document.domains).toEqual([]);
    });
    it('initializes explicitly, rejects duplicates and roundtrips without implicit epoch changes', () => {
        initialize();
        const before = fs.readFileSync(file, 'utf8');
        expect(store.initialize('campaign', campaign)).toEqual({ status: 'already-initialized' });
        expect(store.apply('campaign', campaign, 1, 'future.items', init)).toEqual({ status: 'rejected', reason: 'duplicate-initialization' });
        expect(store.load('campaign', campaign).document.domains[0].formatEpoch).toBe(0);
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });
    it('saves a deterministic document regardless of domain insertion order', () => {
        initialize();
        expect(store.apply('campaign', campaign, 1, 'another.domain', init).status).toBe('saved');
        const a = fs.readFileSync(file, 'utf8');
        const second = createAuthorityControlStore(path.join(directory, 'second'));
        second.initialize('campaign', campaign);
        second.apply('campaign', campaign, 0, 'another.domain', init);
        second.apply('campaign', campaign, 1, 'future.items', init);
        expect(fs.readFileSync(path.join(directory, 'second', 'campaign.authority.json'), 'utf8')).toBe(a);
    });
    it('keeps metadata apart from generic campaign replacement', () => {
        initialize();
        const before = fs.readFileSync(file, 'utf8');
        fs.mkdirSync(path.join(directory, 'campaigns'));
        fs.writeFileSync(path.join(directory, 'campaigns', 'campaign.json'), '{"context":{}}');
        fs.writeFileSync(path.join(directory, 'campaigns', 'campaign.state.json'), '{}');
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
        expect(Object.keys(JSON.parse(before)).sort()).toEqual(['campaignId', 'domains', 'revision', 'schemaVersion']);
    });
    it('rejects stale revisions across store instances without clobbering the latch', () => {
        initialize();
        const second = createAuthorityControlStore(path.dirname(file));
        advance('begin-shadow', { newOwner: 'repository.items' });
        expect(second.apply('campaign', campaign, 1, 'future.items', init)).toEqual({ status: 'revision-conflict' });
    });
    it('persists the first-write latch across reload and refuses rollback or reset', () => {
        initialize();
        for (const [type, fields] of [
            ['begin-shadow', { newOwner: 'repository.items' }], ['verify', { verification: report }],
            ['prepare-cutover', {}], ['commit-cutover', { nextFormatEpoch: 1 }], ['mark-new-owner-write', {}],
        ]) expect(advance(type, fields).status).toBe('saved');
        store = createAuthorityControlStore(path.dirname(file));
        const before = fs.readFileSync(file, 'utf8');
        expect(store.load('campaign', campaign).document.domains[0].firstNewOwnerWrite).toBe(true);
        expect(advance('rollback', { nextFormatEpoch: 2 })).toEqual({ status: 'rejected', reason: 'rollback-prohibited' });
        expect(store.initialize('campaign', campaign)).toEqual({ status: 'already-initialized' });
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });
    it('persists a permitted pre-write rollback with a fresh epoch', () => {
        initialize();
        advance('begin-shadow', { newOwner: 'repository.items' });
        advance('verify', { verification: report });
        advance('prepare-cutover');
        advance('commit-cutover', { nextFormatEpoch: 1 });
        expect(advance('rollback', { nextFormatEpoch: 2 }).status).toBe('saved');
        expect(store.load('campaign', campaign).document.domains[0]).toMatchObject({ stage: 'legacy', formatEpoch: 2, firstNewOwnerWrite: false });
    });
    it.each([
        ['malformed JSON', 'broken'], ['schema version', { schemaVersion: 2 }],
        ['invalid owner', { domains: [{ domainId: 'future.items', stage: 'legacy', legacyOwner: 'Bad', formatEpoch: 0, firstNewOwnerWrite: false }] }],
        ['invalid domain', { domains: [{ domainId: 'bad domain', stage: 'legacy', legacyOwner: 'legacy', formatEpoch: 0, firstNewOwnerWrite: false }] }],
        ['invalid epoch', { domains: [{ domainId: 'future.items', stage: 'legacy', legacyOwner: 'legacy', formatEpoch: -1, firstNewOwnerWrite: false }] }],
        ['unknown stage', { domains: [{ domainId: 'future.items', stage: 'verification', legacyOwner: 'legacy', formatEpoch: 0, firstNewOwnerWrite: false }] }],
        ['contradiction', { domains: [{ domainId: 'future.items', stage: 'legacy', legacyOwner: 'legacy', formatEpoch: 0, firstNewOwnerWrite: true }] }],
        ['duplicate domains', 'duplicates'], ['unknown control field', { replay: [] }],
    ])('fails closed without repair: %s', (_, corrupt) => {
        initialize();
        const base = store.load('campaign', campaign).document;
        const raw = corrupt === 'broken' ? '{broken' : JSON.stringify(corrupt === 'duplicates'
            ? { ...base, domains: [base.domains[0], base.domains[0]] } : { ...base, ...corrupt });
        fs.writeFileSync(file, raw);
        expect(store.load('campaign', campaign)).toEqual({ status: 'malformed' });
        expect(store.initialize('campaign', campaign)).toEqual({ status: 'malformed' });
        expect(store.apply('campaign', campaign, 0, 'future.items', init)).toEqual({ status: 'malformed' });
        expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    });
    it('fails closed on campaign identity mismatch and malformed expected identity', () => {
        initialize();
        const before = fs.readFileSync(file, 'utf8');
        expect(store.load('campaign', other)).toEqual({ status: 'campaign-mismatch' });
        expect(store.initialize('campaign', other)).toEqual({ status: 'campaign-mismatch' });
        expect(store.apply('campaign', other, 1, 'future.items', init)).toEqual({ status: 'campaign-mismatch' });
        expect(store.load('campaign', 'raw')).toEqual({ status: 'invalid-campaign' });
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
        expect(() => store.load('../escape', campaign)).toThrow('Invalid campaign ID');
    });
    it('uses fsynced temporary replacement and preserves old state on rename failure', () => {
        initialize();
        const before = fs.readFileSync(file, 'utf8');
        const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Error('injected rename failure'); });
        expect(advance('begin-shadow', { newOwner: 'repository.items' })).toEqual({ status: 'io-error' });
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
        expect(fs.existsSync(`${file}.tmp`)).toBe(false);
        expect(fs.existsSync(`${file}.lock`)).toBe(false);
        rename.mockRestore();
        const sync = vi.spyOn(fs, 'fsyncSync');
        expect(advance('begin-shadow', { newOwner: 'repository.items' }).status).toBe('saved');
        expect(sync).toHaveBeenCalledOnce();
    });
    it('fails closed on abandoned lock/temp files without deleting operator evidence', () => {
        initialize();
        const before = fs.readFileSync(file, 'utf8');
        for (const suffix of ['.lock', '.tmp']) {
            fs.writeFileSync(file + suffix, 'interrupted');
            expect(advance('begin-shadow', { newOwner: 'repository.items' })).toEqual({ status: 'busy' });
            expect(fs.readFileSync(file + suffix, 'utf8')).toBe('interrupted');
            expect(fs.readFileSync(file, 'utf8')).toBe(before);
            fs.unlinkSync(file + suffix);
        }
    });
    it('reports read errors and invalid revisions without resetting state', () => {
        initialize();
        const before = fs.readFileSync(file, 'utf8');
        expect(store.apply('campaign', campaign, NaN, 'future.items', init)).toEqual({ status: 'invalid-revision' });
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Object.assign(Error('denied'), { code: 'EACCES' }); });
        expect(store.load('campaign', campaign)).toEqual({ status: 'io-error' });
        vi.restoreAllMocks();
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });
});
