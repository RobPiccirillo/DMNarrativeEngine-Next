import { writeJson } from '../lib/fileStore.js';
import { deleteFiles } from '../services/archiveRepository.js';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDraftLifecycleService } from '../services/draftLifecycleService.js';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';
import { acceptanceCandidate } from '@narrative/engine/contracts/draftLifecycle';
import { assertOrdinaryCampaignWrite } from '../lib/acceptanceWriteGuard.js';

const roots = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
        if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'phase3-coordinator-'))) throw new Error('unsafe-test-cleanup');
        fs.rmSync(root, { recursive: true, force: true });
    }
});

async function coordinatorFixture(boundary = () => {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-coordinator-')); roots.push(root);
    const directory = path.join(root, 'campaigns'); fs.mkdirSync(directory);
    const id = 'synthetic', stateFile = path.join(directory, id + '.state.json');
    const state = { context: {}, condenser: { condensedUpToIndex: -1 }, messages: [
        { id: 'user', role: 'user', content: 'Wait.', timestamp: 1 }, { id: 'assistant', role: 'assistant', content: 'Story.', timestamp: 2 },
    ] };
    fs.writeFileSync(stateFile, JSON.stringify(state));
    const options = { directory, authorityDirectory: path.join(root, 'authority'), boundary };
    const lifecycle = createDraftLifecycleService(options);
    const begun = await lifecycle.transition(id, { action: 'begin', kind: 'initial', profileId: 'current', assistantMessageId: 'assistant', sourceMessageId: 'user', archivedUserText: 'Wait.' });
    const set = begun.document.sets[0];
    const finished = await lifecycle.transition(id, { action: 'finish', setId: set.id, attemptId: begun.attempt.id, status: 'completed', text: 'Story.', expectedVersion: begun.version });
    const candidate = acceptanceCandidate(finished.document.sets[0], 'Story.');
    return { directory, id, stateFile, options, candidate, storageToken: finished.saveToken.storageToken, coordinator: createAcceptanceCoordinator(options) };
}
const bundle = () => ({ groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'], contextPatch: { lastSceneStakes: 'calm' } });

it('publishes intent and generated inputs before preparation and reuses them after restart', async () => {
    const f = await coordinatorFixture();
    const first = await f.coordinator.preflight(f.id, f.candidate, f.storageToken);
    expect(() => assertOrdinaryCampaignWrite(f.directory, f.id)).toThrow('acceptance-write-owned');
    expect(fs.existsSync(path.join(f.directory, f.id + '.archive.md'))).toBe(false);
    const second = await createAcceptanceCoordinator(f.options).preflight(f.id, f.candidate, f.storageToken);
    expect(second.command).toEqual(first.command); expect(second.worldmapInputs).toEqual(first.worldmapInputs); expect(second.preview).toEqual(first.preview);
    const logicalKey = JSON.parse(fs.readFileSync(path.join(f.directory, f.id + '.acceptance.json'), 'utf8')).commands[0].logicalKey;
    await expect(f.coordinator.recover(f.id, logicalKey)).rejects.toThrow('missing-prepared-effect-plan');
    expect(fs.existsSync(path.join(f.directory, f.id + '.archive.md'))).toBe(false);
});

it('records every original precondition together before the first target write and recovers without regeneration', async () => {
    let armed = true;
    const f = await coordinatorFixture(point => { if (armed && point === 'effect-group-published') { armed = false; throw new Error('power-cut'); } });
    const prepared = await f.coordinator.preflight(f.id, f.candidate, f.storageToken);
    await expect(f.coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command, bundle: bundle() })).rejects.toThrow('power-cut');
    const journal = JSON.parse(fs.readFileSync(path.join(f.directory, f.id + '.acceptance.json'), 'utf8')), command = journal.commands[0];
    expect(command.steps).toHaveLength(command.effectGroup.stepIds.length);
    expect(command.steps.every(step => step.status === 'prepared' && step.beforeVersion && step.afterVersion)).toBe(true);
    expect(fs.existsSync(path.join(f.directory, f.id + '.archive.md'))).toBe(false);
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('no-recovery-random'); });
    vi.stubGlobal('fetch', () => { throw new Error('no-recovery-provider-or-native'); });
    try {
        const recovered = await createAcceptanceCoordinator(f.options).recover(f.id, command.logicalKey);
        expect(recovered.outcome).toMatchObject({ sceneId: '001', deterministicEffectsComplete: true });
        const after = fs.readFileSync(path.join(f.directory, f.id + '.archive.md'));
        await createAcceptanceCoordinator(f.options).recover(f.id, command.logicalKey);
        expect(fs.readFileSync(path.join(f.directory, f.id + '.archive.md'))).toEqual(after);
        expect(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).messages[1]).toMatchObject({ sceneId: '001', draftStatus: 'accepted' });
        await f.coordinator.acknowledge(f.id, command.logicalKey, recovered.outcome.head);
        expect(() => assertOrdinaryCampaignWrite(f.directory, f.id)).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
});

it('a source write race conflicts before effect publication without overwriting the changed target', async () => {
    const f = await coordinatorFixture(), prepared = await f.coordinator.preflight(f.id, f.candidate, f.storageToken);
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(f.stateFile, 'utf8')), manual: 'newer' })); fs.writeFileSync(f.stateFile, changed);
    await expect(f.coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command, bundle: bundle() })).rejects.toThrow('prepared-source-version-conflict');
    expect(fs.readFileSync(f.stateFile)).toEqual(changed); expect(fs.existsSync(path.join(f.directory, f.id + '.archive.md'))).toBe(false);
});

it('loss after an applied target rejects an unexplained target rather than rebuilding its precondition', async () => {
    let armed = true;
    const f = await coordinatorFixture(point => { if (armed && point === 'after-write:archive') { armed = false; throw new Error('power-cut'); } });
    const prepared = await f.coordinator.preflight(f.id, f.candidate, f.storageToken);
    await expect(f.coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command, bundle: bundle() })).rejects.toThrow('power-cut');
    const journal = JSON.parse(fs.readFileSync(path.join(f.directory, f.id + '.acceptance.json'), 'utf8'));
    const unexpected = Buffer.from('unowned bytes'); fs.writeFileSync(path.join(f.directory, f.id + '.archive.index.json'), unexpected);
    await expect(createAcceptanceCoordinator(f.options).recover(f.id, journal.commands[0].logicalKey)).rejects.toThrow('recovery-required');
    expect(fs.readFileSync(path.join(f.directory, f.id + '.archive.index.json'))).toEqual(unexpected);
});

it.each([
    ['manual movement', '.state.json'], ['settings edit', '.mod-worldmap-settings.json'], ['road edit', '.mod-worldmap-roads.json'],
    ['cleanup', '.locations.json'], ['debounce save', '.state.json'],
])('rejects the actual ordinary %s persistence sink while preparation owns the campaign', async (kind, suffix) => {
    const f = await coordinatorFixture(), target = path.join(f.directory, f.id + suffix);
    if (!fs.existsSync(target)) fs.writeFileSync(target, '{}');
    const before = fs.readFileSync(target);
    await f.coordinator.preflight(f.id, f.candidate, f.storageToken);
    expect(() => kind === 'cleanup' ? deleteFiles([target]) : writeJson(target, { changed: kind })).toThrow('acceptance-write-owned');
    expect(fs.readFileSync(target)).toEqual(before);
    expect(fs.existsSync(path.join(f.directory, f.id + '.archive.md'))).toBe(false);
});

it('a second acceptance cannot reserve another scene while the first command is preparing', async () => {
    const f = await coordinatorFixture();
    const first = await f.coordinator.preflight(f.id, f.candidate, f.storageToken);
    const replay = await f.coordinator.preflight(f.id, f.candidate, f.storageToken);
    expect(replay.command.commandId).toBe(first.command.commandId);
    await expect(f.coordinator.preflight(f.id, { ...f.candidate, expectedSelectionVersion: 'other' }, f.storageToken)).rejects.toThrow('unresolved-acceptance');
    const journal = JSON.parse(fs.readFileSync(path.join(f.directory, f.id + '.acceptance.json'), 'utf8'));
    expect(journal.highWater).toBe(1); expect(journal.commands).toHaveLength(1);
});
