import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readyLifecycle } from './fixtures/lifecycleCampaign.js';
import { exportLifecycleBundle, publishLifecycleBundle, validateLifecycleBundle } from '../services/legacyLifecycleTransfer.js';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';
import { managedStateToken, verifyManagedStateSave } from '../services/managedStateSave.js';
import { assertOrdinaryCampaignWrite } from '../lib/acceptanceWriteGuard.js';
import { validateLifecycleSources } from '../services/lifecycleValidation.js';

const roots = [];
const root = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-portable-')); roots.push(value); return value; };
afterEach(() => { vi.unstubAllGlobals(); for (const dir of roots.splice(0)) {
    if (!path.resolve(dir).startsWith(path.join(os.tmpdir(), 'phase3-portable-'))) throw new Error('unsafe-test-cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
} });
const options = (base, scope) => ({ directory: path.join(base, scope, 'campaigns'), dataRoot: path.join(base, scope), portraitRoot: path.join(base, scope, 'portraits') });
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function reseal(bundle) { bundle.digest = sha(Buffer.from(canonical({ version: bundle.version, format: bundle.format, sourceStorageId: bundle.sourceStorageId,
    campaignInstance: bundle.campaignInstance, files: bundle.files, assets: bundle.assets }))); }

it.each(['missing-messages', 'changed-prose'])('rejects a checksummed playable bundle with %s in completed evidence', async kind => {
    const base = root(), source = options(base, 'original'), target = options(base, 'imported'), f = await readyLifecycle(source.directory);
    const coordinator = createAcceptanceCoordinator({ directory: f.directory, authorityDirectory: path.join(source.dataRoot, 'authority') });
    const prepared = await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    const committed = await coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command, bundle: { groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'] } });
    await coordinator.acknowledge(f.id, committed.logicalKey, committed.outcome.head);
    const bundle = exportLifecycleBundle(f.id, source), state = JSON.parse(Buffer.from(bundle.files['.state.json'].base64, 'base64'));
    if (kind === 'missing-messages') state.messages = []; else state.messages[1].content = 'Unrecorded changed prose';
    const bytes = Buffer.from(JSON.stringify(state)); bundle.files['.state.json'] = { base64: bytes.toString('base64'), sha256: sha(bytes) }; reseal(bundle);
    expect(() => validateLifecycleBundle(bundle)).toThrow(); expect(() => publishLifecycleBundle(bundle, 'imported', target)).toThrow(); expect(fs.existsSync(target.directory)).toBe(false);
});

it('imports selected immutable revisions into a new local scope with byte-preserved source, lineage and assets', async () => {
    const base = root(), source = options(base, 'original'), target = options(base, 'imported');
    const f = await readyLifecycle(source.directory);
    fs.mkdirSync(source.portraitRoot, { recursive: true }); fs.writeFileSync(path.join(source.portraitRoot, 'attachment.png'), 'synthetic image bytes');
    const state = JSON.parse(f.read('.state.json')); state.messages[0].attachmentUrl = '/assets/portraits/attachment.png'; f.write('.state.json', state);
    const bundle = exportLifecycleBundle(f.id, source), before = f.read('.drafts.json');
    vi.stubGlobal('fetch', () => { throw new Error('portable-import-must-not-call-model-or-native'); });
    publishLifecycleBundle(bundle, 'imported', target);
    const drafts = JSON.parse(fs.readFileSync(path.join(target.directory, 'imported.drafts.json'), 'utf8'));
    expect(drafts.sets).toEqual(JSON.parse(before).sets);
    expect(drafts.storageGuard.token).not.toBe(JSON.parse(before).storageGuard.token);
    expect(drafts.storageGuard.history.at(-1)).toMatchObject({ kind: 'import', sourceStorageId: 'source', storageId: 'imported' });
    expect(fs.readFileSync(path.join(target.directory, 'imported.state.json'))).toEqual(f.read('.state.json'));
    const alias = drafts.storageGuard.assetAliases[state.messages[0].attachmentUrl];
    expect(fs.readFileSync(path.join(target.portraitRoot, path.basename(alias)), 'utf8')).toBe('synthetic image bytes');
    expect(f.read('.drafts.json')).toEqual(before);
});

it('retains original completed outcomes/provenance while rejecting stale unseen commands after rebinding', async () => {
    const base = root(), source = options(base, 'original'), target = options(base, 'imported'), f = await readyLifecycle(source.directory);
    const coordinator = createAcceptanceCoordinator({ directory: source.directory, authorityDirectory: path.join(base, 'authority') });
    const prepared = await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    const committed = await coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command,
        bundle: { groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'] } });
    await coordinator.acknowledge(f.id, committed.logicalKey, committed.outcome.head);
    const original = JSON.parse(f.read('.acceptance.json'));
    publishLifecycleBundle(exportLifecycleBundle(f.id, source), 'imported', target);
    const imported = createAcceptanceCoordinator({ directory: target.directory, authorityDirectory: path.join(base, 'authority') });
    const result = await imported.preflight('imported', f.candidate, f.view.saveToken.storageToken);
    expect(result.outcome).toEqual(committed.outcome);
    expect(JSON.parse(fs.readFileSync(path.join(target.directory, 'imported.acceptance.json'), 'utf8')).commands).toEqual(original.commands);
    await expect(imported.preflight('imported', { ...f.candidate, expectedSelectionVersion: 'unseen' }, f.view.saveToken.storageToken)).rejects.toThrow('stale-storage-scope');
});

it('rejects imported in-flight commands before destination writes and never executes them', async () => {
    const base = root(), source = options(base, 'original'), target = options(base, 'imported'), f = await readyLifecycle(source.directory);
    await createAcceptanceCoordinator({ directory: source.directory, authorityDirectory: path.join(base, 'authority') }).preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    const bundle = exportLifecycleBundle(f.id, source); expect(bundle.status).toBe('recovery-required');
    expect(() => publishLifecycleBundle(bundle, 'imported', target)).toThrow('recover-and-acknowledge-before-playable-import-or-restore');
    expect(fs.existsSync(target.directory)).toBe(false);
});
it('rejects source and destination authority declarations before lifecycle transfer writes', async () => {
    const base = root(), source = options(base, 'original'), target = options(base, 'imported'), f = await readyLifecycle(source.directory);
    const bundle = exportLifecycleBundle(f.id, source), before = f.read('.drafts.json');
    fs.mkdirSync(path.join(source.dataRoot, 'authority'), { recursive: true });
    fs.writeFileSync(path.join(source.dataRoot, 'authority', f.id + '.authority.json'), JSON.stringify({ owner: 'sqlite' }));
    expect(() => exportLifecycleBundle(f.id, source)).toThrow('lifecycle-transfer-authority-review-required');
    await expect(f.service.inspect(f.id)).rejects.toThrow('authority-binding-requires-review');
    expect(f.read('.drafts.json')).toEqual(before);
    fs.mkdirSync(path.join(target.dataRoot, 'authority'), { recursive: true });
    fs.writeFileSync(path.join(target.dataRoot, 'authority', 'imported.authority.json'), JSON.stringify({ owner: 'sqlite' }));
    expect(() => publishLifecycleBundle(bundle, 'imported', target)).toThrow('lifecycle-transfer-authority-review-required');
    expect(fs.existsSync(target.directory)).toBe(false);
});

it.each(['unknown-path', 'missing-pair', 'future-schema', 'changed-text'])('independently rejects %s even when the bundle checksum is recomputed', async kind => {
    const base = root(), source = options(base, 'original'), target = options(base, 'imported'), f = await readyLifecycle(source.directory);
    const bundle = exportLifecycleBundle(f.id, source);
    if (kind === 'unknown-path') bundle.files['../outside.json'] = bundle.files['.state.json'];
    else if (kind === 'missing-pair') delete bundle.files['.acceptance.json'];
    else {
        const doc = JSON.parse(Buffer.from(bundle.files['.drafts.json'].base64, 'base64'));
        if (kind === 'future-schema') doc.schemaVersion = 99; else doc.sets[0].revisions[0].text += ' tampered';
        const bytes = Buffer.from(JSON.stringify(doc)); bundle.files['.drafts.json'] = { base64: bytes.toString('base64'), sha256: sha(bytes) };
    }
    reseal(bundle);
    expect(() => publishLifecycleBundle(bundle, 'imported', target)).toThrow(); expect(fs.existsSync(target.directory)).toBe(false);
});

it('an interrupted restore stays closed, then verified restoration rotates the local token', async () => {
    const base = root(), source = options(base, 'original'), f = await readyLifecycle(source.directory);
    const bundle = exportLifecycleBundle(f.id, source), token = managedStateToken(source.directory, f.id), saved = JSON.parse(f.read('.state.json'));
    expect(() => publishLifecycleBundle(bundle, f.id, { ...source, restore: true, boundary: point => { if (point === 'after-write:.state.json') throw new Error('restore-cut'); } })).toThrow('restore-cut');
    expect(() => assertOrdinaryCampaignWrite(source.directory, f.id)).toThrow('lifecycle-storage-scope-unready');
    publishLifecycleBundle(bundle, f.id, { ...source, restore: true });
    expect(managedStateToken(source.directory, f.id).storageToken).not.toBe(token.storageToken);
    expect(() => verifyManagedStateSave(source.directory, f.id, encodeURIComponent(JSON.stringify(token)), saved)).toThrow('managed-state-version-conflict');
    expect(validateLifecycleSources(f.read)).toMatchObject({ valid: true, unresolved: false });
});
