import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readyLifecycle } from './fixtures/lifecycleCampaign.js';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';
import { createAcceptanceArchiveEmbedding } from '../services/acceptanceArchiveEmbedding.js';
import { maintainLegacyArchive } from '../services/legacyArchiveMaintenance.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('phase3-embedding-')) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
} });
async function setup(embed = vi.fn(async () => new Float32Array([.25, .75]))) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-embedding-')); roots.push(root);
    const f = await readyLifecycle(path.join(root, 'campaigns')), rows = new Map(), work = [];
    const store = vi.fn((campaign, scene, embedding) => rows.set(campaign + ':' + scene, Array.from(embedding)));
    const buildText = vi.fn(entry => 'Synthetic index ' + entry.sceneId);
    const dispatch = createAcceptanceArchiveEmbedding({ directory: f.directory, embed, buildText, store });
    const options = { directory: f.directory, authorityDirectory: path.join(root, 'authority') };
    const coordinator = createAcceptanceCoordinator({ ...options, dispatchArchiveEmbedding: request => { const task = dispatch(request); work.push(task); return task; } });
    const prepared = await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    const request = { ticketId: prepared.ticketId, command: prepared.command, bundle: { groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'] } };
    return { ...f, coordinator, options, request, rows, embed, store, work, dispatch };
}
it('dispatches fresh accepted recall once and never dispatches from duplicate, historical lookup or recovery', async () => {
    const f = await setup(), result = await f.coordinator.commit(f.id, f.request); await Promise.all(f.work);
    expect(f.embed).toHaveBeenCalledOnce(); expect(f.rows.get(f.id + ':001')).toEqual([.25, .75]);
    expect(JSON.parse(f.read('.acceptance.json')).commands[0].derivedRecall.status).toBe('produced');
    await f.coordinator.commit(f.id, f.request); await f.coordinator.preflight(f.id, f.candidate, 'stale-token');
    await createAcceptanceCoordinator(f.options).recover(f.id, result.logicalKey);
    await f.dispatch({ campaignId: f.id, logicalKey: result.logicalKey });
    expect(f.embed).toHaveBeenCalledOnce(); expect(f.store).toHaveBeenCalledOnce();
});
it('does not publish an asynchronous embedding after accepted prose changes', async () => {
    let release, entered;
    const ready = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
    const f = await setup(vi.fn(async () => { entered(); await blocked; return new Float32Array([1, 0]); }));
    const result = await f.coordinator.commit(f.id, f.request); await ready;
    await f.coordinator.acknowledge(f.id, result.logicalKey, result.outcome.head);
    maintainLegacyArchive(f.directory, f.id, [{ target: 'archive', after: Buffer.from(f.read('.archive.md').toString().replace('Selected Story.', 'Edited Story.')) }]);
    release(); await Promise.all(f.work);
    expect(f.store).not.toHaveBeenCalled(); expect(JSON.parse(f.read('.acceptance.json')).commands[0].derivedRecall.status).toBe('superseded');
});
it('records optional embedding failure without changing the accepted outcome or retrying it on recovery', async () => {
    const f = await setup(vi.fn(async () => { throw new Error('optional-embedding-unavailable'); }));
    const result = await f.coordinator.commit(f.id, f.request); await Promise.allSettled(f.work);
    expect(JSON.parse(f.read('.acceptance.json')).commands[0]).toMatchObject({ status: 'completed', derivedRecall: { status: 'incomplete' }, outcome: result.outcome });
    await createAcceptanceCoordinator(f.options).recover(f.id, result.logicalKey); expect(f.embed).toHaveBeenCalledOnce();
});
it('does not catch up embedding work when the process stops after outcome publication', async () => {
    const f = await setup(), dispatch = vi.fn();
    const coordinator = createAcceptanceCoordinator({ ...f.options, dispatchArchiveEmbedding: dispatch, boundary: point => {
        if (point === 'outcome-published') throw new Error('outcome-response-lost');
    } });
    await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    await expect(coordinator.commit(f.id, f.request)).rejects.toThrow('outcome-response-lost');
    const command = JSON.parse(f.read('.acceptance.json')).commands[0];
    expect(command).toMatchObject({ status: 'completed', derivedRecall: { status: 'pending' } });
    const restarted = createAcceptanceCoordinator({ ...f.options, dispatchArchiveEmbedding: dispatch });
    await restarted.recover(f.id, command.logicalKey); await restarted.commit(f.id, f.request);
    expect(dispatch).not.toHaveBeenCalled(); expect(f.embed).not.toHaveBeenCalled();
});
