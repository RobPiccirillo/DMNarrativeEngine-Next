import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createDraftLifecycleService } from '../services/draftLifecycleService.js';
import { createLifecycleRouter } from '../routes/lifecycle.js';
import { useAppStore } from '../../src/store/useAppStore';
import { fixtureContext, fixtureSettings } from '../../src/services/turn/__tests__/baseAppGate/fixture';
import { activeDraft, beginDraftAttempt, finishDraftAttempt, loadDraftLifecycle, draftRuntimeCallbacks, recoverUnsavedDraft } from '../../src/services/turn/drafts/runtime';
import { buildCommitCallbacks, capturePendingTurnSnapshot, clearPendingTurnSnapshot, commitPendingTurn, rebuildStateFromLiveStore, reconcilePendingCommitOnLaunch } from '../../src/services/turn/pendingCommit';
import { useSwipeVariants } from '../../src/components/hooks/useSwipeVariants';
import { useSceneContinue } from '../../src/components/hooks/useSceneContinue';
import { useRetryStoryAI } from '../../src/components/hooks/useRetryStoryAI';
import { editDraftRevision, chooseDraftRevision } from '../../src/services/turn/drafts/runtime';
import { runTurn } from '../../src/services/turn/turnOrchestrator';
import { serverStoryHash } from '../services/legacyDraftRepository.js';
import { acceptanceCandidate } from '@narrative/engine/contracts/draftLifecycle';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';
import { createAcceptanceRouter } from '../routes/acceptance.js';
import { acceptanceWriteGuard } from '../lib/acceptanceWriteGuard.js';
import { managedStateToken, stateTokenHeader, verifyManagedStateSave } from '../services/managedStateSave.js';
import { captureStateSaveToken, putCampaignState } from '../../src/store/campaignStateTransport';
import { useChatOperations } from '../../src/hooks/useChatOperations';
import { validateLifecycleSources } from '../services/lifecycleValidation.js';
import { prepareTurnEffects } from '../../src/services/turn/acceptance/prepareEffects';
import { createPinnedWorldMapExports, pinnedWorldMapSource, captureWorldMapSolverInputs, invalidateWorldMapBinding } from '../../src/services/turn/acceptance/worldmapPreparation.js';
import { NodeComputeWorker } from './fixtures/nodeComputeWorker';
import { modToComputeTrack } from '../../src/services/mods/computeTrack';
import { postTurnTracks } from '../../src/services/turn/tracks';
import { postCommitTracks } from '../../src/services/turn/tracks/postCommit';
import type { ValidatedMod } from '../../src/services/mods/modTypes';

const model = vi.hoisted(() => ({ output: 'Visible Story.', abort: false, lostAck: '', acceptanceFault: '', lostCommit: false, calls: [] as unknown[],
    pause: false, stream: null as null | ((text: string, completed?: boolean) => void) }));
vi.mock('../../src/services/chatEngine', async original => ({ ...await original<object>(),
    sendMessage: async (_provider: unknown, messages: unknown, chunk: (text: string) => void, done: (text: string) => void, fail: (error: string) => void) => {
        model.calls.push(messages);
        if (model.pause) {
            await new Promise<void>(resolve => { model.stream = (text, completed = false) => { chunk(text); if (completed) { done(text); model.stream = null; resolve(); } }; });
            return;
        }
        chunk(model.output);
        if (model.abort) fail('__ABORT__'); else done(model.output);
    },
}));

let root: string;
let directory: string;
let service: ReturnType<typeof createDraftLifecycleService>;
const id = 'phase3-runtime';
const original = useAppStore.getState();
const readDrafts = () => JSON.parse(fs.readFileSync(path.join(directory, `${id}.drafts.json`), 'utf8'));

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-runtime-')); directory = path.join(root, 'campaigns'); fs.mkdirSync(directory);
    model.output = 'Visible Story.'; model.abort = false; model.lostAck = ''; model.acceptanceFault = ''; model.lostCommit = false; model.calls = [];
    model.pause = false; model.stream = null;
    clearPendingTurnSnapshot();
    service = createDraftLifecycleService({ directory, authorityDirectory: path.join(root, 'authority') });
    const app = express(); app.use(express.json()); app.use('/api/campaigns/:id', acceptanceWriteGuard(directory)); app.use(createLifecycleRouter(service));
    app.use(createAcceptanceRouter(createAcceptanceCoordinator({ directory, authorityDirectory: path.join(root, 'authority'), boundary: (point: string) => {
        if (point === model.acceptanceFault) { model.acceptanceFault = ''; throw new Error('synthetic-acceptance-interruption'); }
    } })));
    app.put('/api/campaigns/:id/state', (req, res) => {
        verifyManagedStateSave(directory, id, req.get(stateTokenHeader), req.body);
        fs.writeFileSync(path.join(directory, `${id}.state.json`), JSON.stringify(req.body));
        const token = managedStateToken(directory, id); if (token) res.set(stateTokenHeader, encodeURIComponent(JSON.stringify(token)));
        res.json({ ok: true });
    });
    app.get('/api/campaigns/:id/state', (_req, res) => {
        const token = managedStateToken(directory, id); if (token) res.set(stateTokenHeader, encodeURIComponent(JSON.stringify(token)));
        res.json(JSON.parse(fs.readFileSync(path.join(directory, `${id}.state.json`), 'utf8')));
    });
    app.use((error: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { void _next; res.status(error.statusCode ?? 500).json({ code: error.message }); });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const parsed = new URL(url, 'http://fixture');
        const method = (init?.method ?? 'GET').toLowerCase();
        const pending = request(app)[method as 'get'](parsed.pathname);
        new Headers(init?.headers).forEach((value, name) => pending.set(name, value));
        if (init?.body) pending.send(JSON.parse(String(init.body)));
        const result = await pending;
        if (parsed.pathname.endsWith('/acceptance/commit') && result.status < 400 && model.lostCommit) {
            model.lostCommit = false; throw new Error('acceptance-response-lost');
        }
        if (method === 'post' && parsed.pathname.endsWith('/lifecycle') && JSON.parse(String(init?.body)).action === model.lostAck) {
            model.lostAck = ''; throw new Error('response-lost-after-publication');
        }
        return { ok: result.status < 400, status: result.status, json: async () => result.body,
            headers: new Headers(result.headers as Record<string, string>), text: async () => result.text } as Response;
    });
    useAppStore.setState({ ...useAppStore.getInitialState(), activeCampaignId: id, context: { ...fixtureContext(), surpriseEngineActive: false, encounterEngineActive: false, worldEngineActive: false },
        settings: { ...fixtureSettings(), aiTier: 'lite', providers: [{ id: 'provider', endpoint: 'http://fixture', modelName: 'fixture', apiKey: 'synthetic' }],
            presets: [{ id: 'preset', storyAIProviderId: 'provider', sampling: { temperature: 0.7 } }], activePresetId: 'preset' } as never,
        messages: [{ id: 'user', role: 'user', content: 'Wait.', timestamp: 0 }, { id: 'assistant', role: 'assistant', content: '', timestamp: 1 }],
    });
    fs.writeFileSync(path.join(directory, `${id}.state.json`), JSON.stringify({ context: useAppStore.getState().context, messages: useAppStore.getState().messages, condenser: { condensedUpToIndex: -1 } }));
});
afterEach(() => {
    invalidateWorldMapBinding();
    cleanup(); clearPendingTurnSnapshot(); vi.unstubAllGlobals(); useAppStore.setState(original, true);
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'phase3-runtime-'))) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
});

it('the actual turn pipeline and bundled movement prepare a full group before any live publication', async () => {
    const story = 'We set off. <!-- MOVEMENT {"action":"depart","place":"b"} -->';
    const ledger = ['a', 'b'].map((place, index) => ({ id: place, name: place.toUpperCase(), aliases: '', kind: 'place', description: '', features: [],
        connections: [{ toId: index ? 'a' : 'b', band: 'regional' }], coordinates: { x: 500 + index * 30, y: 500 }, knowledge: 'known' }));
    const tables: Record<string, unknown> = { settings: { worldSeed: 'synthetic-runtime-seed', climateGradient: 0.5 } };
    const native = { context: { ...useAppStore.getState().context, currentPlaceId: 'a', worldDay: 1, travel: null, travelMode: 'flying' }, ledger };
    let nativeWrites = 0;
    const nativeContext = () => ({ data: { campaignId: id, context: structuredClone(native.context), loreChunks: [],
        location: { ...structuredClone(native.context), ledger: structuredClone(native.ledger) } }, refresh: async () => nativeContext(),
        table: { read: async (name: string) => structuredClone(tables[name] ?? null), write: async (name: string, value: unknown) => {
            nativeWrites++; tables[name] = structuredClone(value); fs.writeFileSync(path.join(directory, `${id}.mod-worldmap-${name}.json`), JSON.stringify(value));
        }, subscribe: () => () => {} },
        write: { setLocationLedger: (rows: typeof ledger) => { native.ledger = structuredClone(rows); }, updateContext: (patch: object) => Object.assign(native.context, patch) },
        mounts: { window: () => ({ open: () => {} }), header: () => {} }, events: { on: () => {} }, subscribe: () => () => {}, log: vi.fn(),
    });
    const bundled = createPinnedWorldMapExports(pinnedWorldMapSource()) as { onActivate(ctx: unknown): Promise<void> };
    await bundled.onActivate(nativeContext());
    fs.writeFileSync(path.join(directory, `${id}.locations.json`), JSON.stringify(native.ledger));
    useAppStore.setState({ context: native.context as never, locationLedger: native.ledger as never,
        modTables: Object.fromEntries(Object.entries(tables).map(([name, value]) => [`mod.worldmap.${name}`, value])) });
    const attempt = await beginDraftAttempt('assistant', 'initial');
    await finishDraftAttempt(attempt, 'completed', { text: story, sceneStakes: 'calm', tagPresent: true });
    const registry = Object.fromEntries(['anchors', 'settings', 'visited', 'journey', 'position', 'trails', 'discoveries', 'encounters', 'exploration', 'roads']
        .map(name => [`mod.worldmap.${name}`, `.mod-worldmap-${name}.json`]));
    let armed = true;
    const coordinator = createAcceptanceCoordinator({ directory, authorityDirectory: path.join(root, 'authority'), modTargets: () => registry,
        boundary: (point: string) => { if (armed && point === 'effect-group-published') { armed = false; throw new Error('synthetic-group-publication-loss'); } } });
    const set = activeDraft()!, preflight = await coordinator.preflight(id, acceptanceCandidate(set, story), captureStateSaveToken(id)?.storageToken);
    const frozen = await coordinator.freezeWorldMap(id, preflight.ticketId, await captureWorldMapSolverInputs(id));
    const liveBefore = structuredClone(useAppStore.getState().context), stateBytes = fs.readFileSync(path.join(directory, `${id}.state.json`));
    nativeWrites = 0;
    const prepared = await prepareTurnEffects({ ...preflight, runtimeInput: frozen.worldmapRuntime },
        rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), useAppStore.getState().messages, story);
    expect(prepared.bundle.worldmap.tables.journey.id).toBe(preflight.worldmapInputs.journeyId);
    expect(prepared.bundle.contextPatch.worldDay).toBeGreaterThan(1);
    expect(nativeWrites).toBe(0); expect(useAppStore.getState().context).toEqual(liveBefore);
    expect(fs.readFileSync(path.join(directory, `${id}.state.json`))).toEqual(stateBytes);
    await expect(coordinator.commit(id, { ticketId: preflight.ticketId, command: preflight.command, bundle: prepared.bundle })).rejects.toThrow('synthetic-group-publication-loss');
    expect(nativeWrites).toBe(0); expect(fs.existsSync(path.join(directory, `${id}.archive.md`))).toBe(false);
    const journal = JSON.parse(fs.readFileSync(path.join(directory, `${id}.acceptance.json`), 'utf8'));
    const recovered = await createAcceptanceCoordinator({ directory, authorityDirectory: path.join(root, 'authority'), modTargets: () => registry }).recover(id, journal.commands[0].logicalKey);
    expect(recovered.outcome).toMatchObject({ revisionId: set.selectedRevisionId, sceneId: '001', deterministicEffectsComplete: true });
    expect(model.calls).toHaveLength(0); expect(nativeWrites).toBe(0);
});

async function initial() {
    const handle = await beginDraftAttempt('assistant', 'initial');
    expect(readDrafts().sets[0].attempts[0].status).toBe('streaming');
    await finishDraftAttempt(handle, 'completed', { text: 'Original Story.\r\n', sceneStakes: 'tense', tagPresent: true });
    capturePendingTurnSnapshot(rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), [{ role: 'user', content: 'Wait.' }], 'Wait.');
    return activeDraft()!;
}
it('records an interrupted optional post-commit result without blocking or redispatching accepted prose', async () => {
    const set = await initial(), story = useAppStore.getState().messages[1].content;
    let calls = 0;
    const track = { id: 'test.optional-result', name: 'Optional result', description: 'Synthetic failed optional work', defaultEnabled: true, trigger: 'automatic' as const,
        callsModel: true, shouldRun: () => true, run: async () => { calls++; throw new Error('optional-provider-failed'); } };
    postCommitTracks.register(track);
    try {
        const options = { directory, authorityDirectory: path.join(root, 'authority') }, coordinator = createAcceptanceCoordinator(options);
        const frozen = await coordinator.preflight(id, acceptanceCandidate(set, story), captureStateSaveToken(id)?.storageToken);
        const prepared = await prepareTurnEffects(frozen, rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), useAppStore.getState().messages, story);
        expect(prepared.bundle.optionalWork).toContainEqual({ label: 'optional-post-commit-track', status: 'incomplete' });
        const result = await coordinator.commit(id, { ticketId: frozen.ticketId, command: frozen.command, bundle: prepared.bundle });
        await createAcceptanceCoordinator(options).recover(id, result.logicalKey);
        expect(calls).toBe(1); expect(result.outcome.deterministicEffectsComplete).toBe(true);
    } finally { postCommitTracks.unregister(track.id); }
});

it('captures the shipped Arc worker on-return journal before publication and never invokes the worker during recovery', async () => {
    const arc = { id: 'arc-one', type: 'threat', seed: 'A distant patrol', status: 'active', stance: 'ignored', tickDC: 101,
        currentRung: 0, ladder: [{ label: 'Rumors of patrols', surface: 'rumor' }], lastTickScene: '000' };
    const key = 'mod.arc.arcs', suffix = '.mod-arc-arcs.json';
    useAppStore.setState({ modTables: { [key]: [arc] } }); fs.writeFileSync(path.join(directory, id + suffix), JSON.stringify([arc]));
    await initial();
    const mod = { ...JSON.parse(fs.readFileSync(path.resolve('mods/arc/manifest.json'), 'utf8')), folder: '/fixture/arc',
        computeSource: fs.readFileSync(path.resolve('mods/arc/compute.js'), 'utf8') } as ValidatedMod;
    const workers: NodeComputeWorker[] = [];
    const track = modToComputeTrack(mod, { sandboxOptions: { createWorker: source => { const worker = new NodeComputeWorker(source); workers.push(worker); return worker; } } });
    postTurnTracks.register(track);
    try {
        const options = { directory, authorityDirectory: path.join(root, 'authority'), modTargets: () => ({ [key]: suffix }) };
        const coordinator = createAcceptanceCoordinator({ ...options, boundary: (point: string) => { if (point === 'effect-group-published') throw new Error('arc-group-cut'); } });
        const frozen = await coordinator.preflight(id, acceptanceCandidate(activeDraft()!, useAppStore.getState().messages[1].content), captureStateSaveToken(id)?.storageToken);
        const prepared = await prepareTurnEffects(frozen, rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), useAppStore.getState().messages, useAppStore.getState().messages[1].content);
        expect(prepared.bundle.modTables[key]).toMatchObject([{ tickDC: 96 }]);
        expect(JSON.parse(fs.readFileSync(path.join(directory, id + suffix), 'utf8'))).toEqual([arc]);
        expect(workers).toHaveLength(1); expect(workers.every(worker => worker.terminated)).toBe(true);
        await expect(coordinator.commit(id, { ticketId: frozen.ticketId, command: frozen.command, bundle: prepared.bundle })).rejects.toThrow('arc-group-cut');
        const journal = JSON.parse(fs.readFileSync(path.join(directory, id + '.acceptance.json'), 'utf8'));
        postTurnTracks.unregister(track.id);
        await createAcceptanceCoordinator(options).recover(id, journal.commands[0].logicalKey);
        expect(workers).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(path.join(directory, id + suffix), 'utf8'))).toEqual(prepared.bundle.modTables[key]);
        expect(model.calls).toHaveLength(0);
    } finally { postTurnTracks.unregister(track.id); }
});

it('records populated agency, activity, pressure and counters once and reuses frozen random inputs on renewed preparation', async () => {
    const story = '👥 [Present] Mira\n\nMira waits by the gate.';
    const npc = { id: 'mira', name: 'Mira', aliases: '', appearance: '', faction: 'Guard', storyRelevance: '', disposition: '', status: '', goals: '', voice: '', personality: '', exampleOutput: '', affinity: 40,
        populated: true, region: 'Town', wants: { short: [], medium: ['Secure the gate'], long: 'Protect the town' },
        personalityHex: { drive: 2, diligence: 2, boldness: -2, warmth: -2, empathy: -2, composure: 3 } };
    const store = useAppStore.getState();
    useAppStore.setState({ npcLedger: [npc] as never, onStageNpcIds: ['mira'],
        context: { ...store.context, agencyHeartbeatDC: 0, agencyTick: 0, playerCharacter: { ...npc, id: 'pc', name: 'Player', isPC: true } as never },
        settings: { ...store.settings, aiTier: 'max', inferenceProfileId: 'constrained-local-v1' } });
    fs.writeFileSync(path.join(directory, id + '.npcs.json'), JSON.stringify([npc]));
    fs.writeFileSync(path.join(directory, id + '.state.json'), JSON.stringify({ context: useAppStore.getState().context, messages: useAppStore.getState().messages, condenser: store.condenser }));
    const attempt = await beginDraftAttempt('assistant', 'initial'); await finishDraftAttempt(attempt, 'completed', { text: story, sceneStakes: 'calm', tagPresent: true });
    let cut = false;
    const options = { directory, authorityDirectory: path.join(root, 'authority') };
    const coordinator = createAcceptanceCoordinator({ ...options, boundary: (point: string) => { if (cut && point === 'after-write:npcs') { cut = false; throw new Error('populated-writer-cut'); } } });
    const candidate = acceptanceCandidate(activeDraft()!, story), frozen = await coordinator.preflight(id, candidate, captureStateSaveToken(id)?.storageToken);
    const turn = rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), messages = useAppStore.getState().messages;
    const before = fs.readFileSync(path.join(directory, id + '.npcs.json'));
    const first = await prepareTurnEffects(frozen, turn, messages, story);
    const renewed = await createAcceptanceCoordinator(options).preflight(id, candidate, captureStateSaveToken(id)?.storageToken);
    expect(renewed.turnInputs).toEqual(frozen.turnInputs);
    const second = await prepareTurnEffects(renewed, turn, messages, story);
    expect(second.bundle.npcs).toEqual(first.bundle.npcs); expect(second.bundle.contextPatch, JSON.stringify({ first: first.bundle.contextPatch, second: second.bundle.contextPatch })).toEqual(first.bundle.contextPatch);
    expect(first.bundle.npcs?.[0]).toMatchObject({ agencyActivity: expect.any(Object) });
    expect(first.bundle.contextPatch).toHaveProperty('agencyHeartbeatDC');
    expect(first.bundle.bookkeepingTurnCounter).toBeGreaterThanOrEqual(0);
    expect(fs.readFileSync(path.join(directory, id + '.npcs.json'))).toEqual(before); expect(model.calls).toHaveLength(0);
    cut = true;
    await expect(coordinator.commit(id, { ticketId: frozen.ticketId, command: frozen.command, bundle: first.bundle })).rejects.toThrow('populated-writer-cut');
    const journal = JSON.parse(fs.readFileSync(path.join(directory, id + '.acceptance.json'), 'utf8'));
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('recovery-rerolled'); });
    try { await createAcceptanceCoordinator(options).recover(id, journal.commands[0].logicalKey); } finally { random.mockRestore(); }
    expect(JSON.parse(fs.readFileSync(path.join(directory, id + '.npcs.json'), 'utf8'))).toEqual(first.bundle.npcs);
    expect(model.calls).toHaveLength(0);
});

it('managed acceptance uses the actual coordinator once and duplicate drains produce no model work', async () => {
    await initial();
    await commitPendingTurn();
    expect(activeDraft()).toBeUndefined();
    const before = fs.readFileSync(path.join(directory, `${id}.archive.md`));
    expect(useAppStore.getState().messages[1]).toMatchObject({ sceneId: '001', draftStatus: 'accepted' });
    await commitPendingTurn();
    expect(fs.readFileSync(path.join(directory, `${id}.archive.md`))).toEqual(before);
    expect(model.calls).toHaveLength(0);
    expect(validateLifecycleSources(suffix => {
        const file = path.join(directory, id + suffix); return fs.existsSync(file) ? fs.readFileSync(file) : null;
    })).toMatchObject({ valid: true, unresolved: false });
});
it('preserves newer unsaved manual movement and rejects preparation against an older frozen context', async () => {
    const set = await initial(), story = useAppStore.getState().messages[1].content;
    const coordinator = createAcceptanceCoordinator({ directory, authorityDirectory: path.join(root, 'authority') });
    const frozen = await coordinator.preflight(id, acceptanceCandidate(set, story), captureStateSaveToken(id)?.storageToken);
    const bytes = fs.readFileSync(path.join(directory, id + '.state.json'));
    useAppStore.setState({ context: { ...useAppStore.getState().context, worldDay: 99, currentPlaceId: 'manual-position' } });
    await expect(prepareTurnEffects(frozen, rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), useAppStore.getState().messages, story)).rejects.toThrow('acceptance-live-context-source-conflict');
    expect(useAppStore.getState().context.currentPlaceId).toBe('manual-position'); expect(fs.readFileSync(path.join(directory, id + '.state.json'))).toEqual(bytes);
    expect(fs.existsSync(path.join(directory, id + '.archive.md'))).toBe(false); expect(model.calls).toHaveLength(0);
});

it('independent validation checks pending revision hashes and bindings without normalizing corrupt source bytes', async () => {
    await initial();
    const read = (suffix: string) => { const file = path.join(directory, id + suffix); return fs.existsSync(file) ? fs.readFileSync(file) : null; };
    expect(validateLifecycleSources(read)).toMatchObject({ valid: true });
    const file = path.join(directory, id + '.drafts.json'), changed = readDrafts(); changed.sets[0].revisions[0].text += ' changed';
    fs.writeFileSync(file, JSON.stringify(changed)); const bytes = fs.readFileSync(file);
    expect(validateLifecycleSources(read)).toMatchObject({ valid: false, errors: expect.arrayContaining(['revision-hash-conflict']) });
    expect(fs.readFileSync(file)).toEqual(bytes);
});

it('lost completed acceptance response reloads and acknowledges the exact outcome without redispatching', async () => {
    const set = await initial(); model.lostCommit = true;
    await expect(commitPendingTurn()).rejects.toThrow('acceptance-response-lost');
    expect(useAppStore.getState().draftLifecycle?.unacknowledged).toHaveLength(1);
    clearPendingTurnSnapshot();
    await reconcilePendingCommitOnLaunch();
    expect(useAppStore.getState().messages[1]).toMatchObject({ sceneId: '001', selectedRevisionId: set.selectedRevisionId });
    expect(useAppStore.getState().draftLifecycle?.unacknowledged).toHaveLength(0);
    expect((fs.readFileSync(path.join(directory, `${id}.archive.md`), 'utf8').match(/## SCENE/g) ?? [])).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
});

it('a rejected prior acceptance preserves composer, attachment and armed next-turn actions', async () => {
    await initial(); model.acceptanceFault = 'intent-published';
    const setInput = vi.fn(), takeAttachment = vi.fn(() => ({ caption: 'synthetic image', localPath: 'synthetic.png' })), setBrief = vi.fn();
    useAppStore.setState({ deepArmed: true, armedAbsoluteCommand: 'Keep this action.' });
    const hook = renderHook(() => useChatOperations({ input: 'Next action.', setInput, resetTextareaHeight: vi.fn(), oocBusy: false,
        armedAskGmBrief: { campaignId: id, text: 'Keep this brief.' }, setArmedAskGmBrief: setBrief,
        sceneContinue: { getAbortController: () => null } as never, checkAndSealChapter: vi.fn(), takeAttachment }));
    await act(async () => { await hook.result.current.handleSend(); });
    expect(setInput).not.toHaveBeenCalled(); expect(takeAttachment).not.toHaveBeenCalled(); expect(setBrief).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({ deepArmed: true, armedAbsoluteCommand: 'Keep this action.' });
    expect(model.calls).toHaveLength(0); expect(fs.existsSync(path.join(directory, `${id}.archive.md`))).toBe(false);
    expect(useAppStore.getState().draftLifecycle?.pendingAcceptance).toBeTruthy();
});

it('managed state PUTs reject missing tokens and spoofed revision, selection and acceptance markers without writes', async () => {
    await initial();
    const file = path.join(directory, `${id}.state.json`), saved = JSON.parse(fs.readFileSync(file, 'utf8')), before = fs.readFileSync(file);
    const send = async (body: unknown, token?: unknown) => fetch(`/api/campaigns/${id}/state`, { method: 'PUT', headers: {
        'Content-Type': 'application/json', ...(token ? { [stateTokenHeader]: encodeURIComponent(JSON.stringify(token)) } : {}),
    }, body: JSON.stringify(body) });
    expect((await send(saved)).status).toBe(409);
    for (const patch of [{ content: 'Unrecorded replacement.' }, { sceneId: '999' }, { selectedRevisionId: 'forged' }, { draftStatus: 'accepted' }]) {
        const body = structuredClone(saved); Object.assign(body.messages[1], patch);
        expect((await send(body, captureStateSaveToken(id))).status).toBe(409);
    }
    expect(fs.readFileSync(file)).toEqual(before);
});

it('a delayed pre-acceptance state save cannot erase accepted movement, head or message stamps', async () => {
    await initial();
    const state = useAppStore.getState(), stale = { context: state.context, messages: state.messages, condenser: state.condenser }, token = captureStateSaveToken(id);
    await commitPendingTurn();
    const file = path.join(directory, `${id}.state.json`), before = fs.readFileSync(file);
    await expect(putCampaignState(id, stale, token)).rejects.toThrow('managed-state-version-conflict');
    expect(fs.readFileSync(file)).toEqual(before);
});

it('real runTurn production callback seam persists an attempt and exact finalized revision', async () => {
    useAppStore.setState({ messages: [] });
    const store = useAppStore.getState();
    await runTurn(rebuildStateFromLiveStore(store, 'Wait.'), { ...buildCommitCallbacks(id, store), drafts: draftRuntimeCallbacks }, new AbortController());
    const set = activeDraft()!;
    expect(set.attempts[0].status).toBe('completed');
    expect(set.revisions[0].text).toBe('Visible Story.');
    expect(set.revisions[0].hash).toBe(await serverStoryHash('Visible Story.'));
    expect(readDrafts().sets[0]).toEqual(set);
    expect(model.calls).toHaveLength(1);
});

it('two actual Swipe hook generations produce siblings; edit and Continue retain their parents', async () => {
    const originalSet = await initial();
    const swipe = renderHook(() => useSwipeVariants('assistant'));
    for (const text of ['Sibling one.', 'Sibling two.']) {
        model.output = text; await act(async () => { await swipe.result.current.generateSwipe(); });
    }
    expect(activeDraft()!.revisions).toHaveLength(3);
    expect(activeDraft()!.revisions.slice(1).every(revision => revision.reason === 'swipe' && !revision.parentRevisionId)).toBe(true);
    const parent = activeDraft()!.revisions[1];
    await act(async () => { await chooseDraftRevision('assistant', parent.id, parent.text); await editDraftRevision('assistant', 'Edited Story.'); });
    const edited = activeDraft()!.revisions.at(-1)!;
    expect(edited.parentRevisionId).toBe(parent.id); expect(edited.metadata).toBeUndefined();
    expect(activeDraft()!.revisions[0]).toEqual(originalSet.revisions[0]);
    model.output = 'A continuation.';
    const continuation = renderHook(() => useSceneContinue('assistant'));
    await act(async () => { await continuation.result.current.runSceneContinue(); });
    const merged = activeDraft()!.revisions.at(-1)!;
    expect(merged.parentRevisionId).toBe(edited.id); expect(merged.text).toContain('A continuation.');
    expect(activeDraft()!.turnReference).toBe(originalSet.turnReference);
    expect(model.calls).toHaveLength(3);
});
it('a deferred Swipe cannot overwrite or select itself after navigation to a sealed sibling', async () => {
    const set = await initial(), selected = set.revisions[0], swipe = renderHook(() => useSwipeVariants('assistant'));
    model.pause = true; let pending!: Promise<void>;
    act(() => { pending = swipe.result.current.generateSwipe(); });
    await waitFor(() => expect(model.stream).not.toBeNull());
    act(() => swipe.result.current.setSwipeIndex(0));
    await waitFor(() => expect(useAppStore.getState().messages[1].content).toBe(selected.text));
    act(() => model.stream!('Later partial text.'));
    expect(useAppStore.getState().messages[1].content).toBe(selected.text);
    await act(async () => { model.stream!('Unselected new Story.', true); await pending; });
    expect(activeDraft()!.selectedRevisionId).toBe(selected.id); expect(useAppStore.getState().messages[1].content).toBe(selected.text);
    expect(activeDraft()!.revisions.at(-1)!.text).toBe('Unselected new Story.');
});
it('a deferred Continue cannot overwrite or select its child after another revision is selected', async () => {
    const first = await initial(), source = first.revisions[0], swipe = renderHook(() => useSwipeVariants('assistant'));
    model.output = 'Other sibling.'; await act(async () => { await swipe.result.current.generateSwipe(); });
    const sibling = activeDraft()!.revisions.at(-1)!;
    await act(async () => { await chooseDraftRevision('assistant', source.id, source.text); });
    const continuation = renderHook(() => useSceneContinue('assistant')); model.pause = true; let pending!: Promise<void>;
    act(() => { pending = continuation.result.current.runSceneContinue(); });
    await waitFor(() => expect(model.stream).not.toBeNull());
    await act(async () => { await chooseDraftRevision('assistant', sibling.id, sibling.text); });
    act(() => model.stream!('A later continuation chunk.'));
    expect(useAppStore.getState().messages[1].content).toBe(sibling.text);
    await act(async () => { model.stream!('An unselected continuation.', true); await pending; });
    expect(activeDraft()!.selectedRevisionId).toBe(sibling.id); expect(useAppStore.getState().messages[1].content).toBe(sibling.text);
    expect(activeDraft()!.revisions.at(-1)).toMatchObject({ parentRevisionId: source.id, reason: 'continue' });
});
it.each([false, true])('manual movement saved before acceptance wins over generation movement, including preparation restart=%s', async restart => {
    const store = useAppStore.getState(), story = '📍 [B]\n\nThe Story is at B.';
    const ledger = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), aliases: '', kind: 'place', features: [], connections: [], description: '' }));
    useAppStore.setState({ context: { ...store.context, currentPlaceId: 'a' }, locationLedger: ledger as never });
    fs.writeFileSync(path.join(directory, id + '.locations.json'), JSON.stringify(ledger));
    const attempt = await beginDraftAttempt('assistant', 'initial'); await finishDraftAttempt(attempt, 'completed', { text: story, sceneStakes: 'calm', tagPresent: true });
    const generated = rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), selected = activeDraft()!;
    useAppStore.setState({ context: { ...useAppStore.getState().context, currentPlaceId: 'c' } });
    const current = useAppStore.getState(); await putCampaignState(id, { context: current.context, messages: current.messages, condenser: current.condenser });
    const options = { directory, authorityDirectory: path.join(root, 'authority') }, coordinator = createAcceptanceCoordinator(options), candidate = acceptanceCandidate(selected, story);
    let frozen = await coordinator.preflight(id, candidate, captureStateSaveToken(id)?.storageToken);
    if (restart) { clearPendingTurnSnapshot(); frozen = await createAcceptanceCoordinator(options).preflight(id, candidate, captureStateSaveToken(id)?.storageToken); }
    expect(JSON.parse(frozen.generationPosition!)[0]).toBe('a');
    const prepared = await prepareTurnEffects(frozen, restart ? rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.') : generated, current.messages, story);
    expect(prepared.bundle.contextPatch.currentPlaceId).toBeUndefined();
    await coordinator.commit(id, { ticketId: frozen.ticketId, command: frozen.command, bundle: prepared.bundle });
    expect(JSON.parse(fs.readFileSync(path.join(directory, id + '.state.json'), 'utf8')).context.currentPlaceId).toBe('c');
});

it('aborted Continue finalizes a nonempty merged child without mutating the parent', async () => {
    const set = await initial(), parent = set.revisions[0];
    model.output = 'Partial continuation.'; model.abort = true;
    const continuation = renderHook(() => useSceneContinue('assistant'));
    await act(async () => { await continuation.result.current.runSceneContinue(); });
    expect(activeDraft()!.revisions[0]).toEqual(parent);
    expect(activeDraft()!.attempts.at(-1)!.status).toBe('aborted');
    expect(activeDraft()!.revisions.at(-1)).toMatchObject({ reason: 'continue', parentRevisionId: parent.id });
    expect(activeDraft()!.revisions.at(-1)!.text).toContain('Partial continuation.');
});

it('generation Retry creates new attempt lineage rather than accepting or replacing an old revision', async () => {
    const handle = await beginDraftAttempt('assistant', 'initial'); await finishDraftAttempt(handle, 'failed');
    useAppStore.setState({ messages: useAppStore.getState().messages.map(message => message.id === 'assistant' ? { ...message, retryable: true } : message) });
    capturePendingTurnSnapshot(rebuildStateFromLiveStore(useAppStore.getState(), 'Wait.'), [{ role: 'user', content: 'Wait.' }], 'Wait.');
    const retry = renderHook(() => useRetryStoryAI());
    await act(async () => { await retry.result.current.retryStoryAI('assistant'); });
    expect(activeDraft()!.attempts).toHaveLength(2);
    expect(activeDraft()!.attempts[1]).toMatchObject({ kind: 'retry', sourceAttemptId: handle!.attemptId, status: 'completed' });
    expect(fs.existsSync(path.join(directory, `${id}.archive.md`))).toBe(false);
});

it('startup restores the persisted selected swipe without a model call or archive append', async () => {
    await initial(); model.output = 'Selected sibling.';
    const swipe = renderHook(() => useSwipeVariants('assistant')); await act(async () => { await swipe.result.current.generateSwipe(); });
    const selected = activeDraft()!.selectedRevisionId;
    clearPendingTurnSnapshot(); model.calls = [];
    useAppStore.setState({ draftLifecycle: null });
    await reconcilePendingCommitOnLaunch();
    expect(activeDraft()!.selectedRevisionId).toBe(selected);
    expect(useAppStore.getState().messages[1].content).toBe('Selected sibling.');
    expect(model.calls).toHaveLength(0); expect(fs.existsSync(path.join(directory, `${id}.archive.md`))).toBe(false);
});

it('interrupted attempts reload as noncanonical and ambiguous legacy siblings remain intact', async () => {
    await beginDraftAttempt('assistant', 'initial');
    await loadDraftLifecycle(id, true);
    expect(activeDraft()!.attempts[0].status).toBe('interrupted'); expect(activeDraft()!.revisions).toHaveLength(0);
    expect(useAppStore.getState().messages[1].draftStatus).toBe('interrupted');
});

it('stale selection tokens produce HTTP 409 and zero lifecycle writes', async () => {
    const set = await initial(), view = await service.inspect(id), file = path.join(directory, `${id}.drafts.json`), before = fs.readFileSync(file);
    await expect(service.transition(id, { action: 'select', setId: set.id, revisionId: set.selectedRevisionId, displayedText: set.revisions[0].text, expectedVersion: 'stale' })).rejects.toMatchObject({ statusCode: 409 });
    expect(fs.readFileSync(file)).toEqual(before); expect(view.managed).toBe(true);
});

it('pending regeneration keeps the turn, source, siblings and counters while adding attempt lineage', async () => {
    const set = await initial(), counter = useAppStore.getState().bookkeepingTurnCounter;
    model.output = 'Regenerated Story.';
    const retry = renderHook(() => useRetryStoryAI());
    await act(async () => { await retry.result.current.regenerateStoryAI('assistant'); });
    expect(activeDraft()!.turnReference).toBe(set.turnReference);
    expect(activeDraft()!.sourceMessageId).toBe(set.sourceMessageId);
    expect(activeDraft()!.attempts.at(-1)).toMatchObject({ kind: 'regenerate', sourceAttemptId: set.attempts[0].id, sourceRevisionId: set.selectedRevisionId });
    expect(activeDraft()!.revisions[0]).toEqual(set.revisions[0]); expect(useAppStore.getState().bookkeepingTurnCounter).toBe(counter);
    expect(useAppStore.getState().messages.map(message => message.id)).toEqual(['user', 'assistant']);
});

it('a lost finalized-draft response retries the same operation without a model or duplicate revision', async () => {
    const handle = await beginDraftAttempt('assistant', 'initial'); model.lostAck = 'finish';
    await expect(finishDraftAttempt(handle, 'completed', { text: 'Exact Story.', sceneStakes: 'calm', tagPresent: false })).rejects.toThrow('response-lost-after-publication');
    expect(useAppStore.getState().draftLifecycle?.status).toBe('unsaved');
    expect(readDrafts().sets[0].revisions).toHaveLength(1);
    await recoverUnsavedDraft();
    expect(activeDraft()!.revisions).toHaveLength(1); expect(useAppStore.getState().messages[1].content).toBe('Exact Story.');
    expect(model.calls).toHaveLength(0);
});

it('compatibility preserves ambiguous old variants and blocks generation without rewriting state', async () => {
    const stateFile = path.join(directory, `${id}.state.json`);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    Object.assign(saved.messages[1], { pendingCommit: true, content: 'First', swipeActiveIndex: 0,
        swipeSet: [{ id: 'duplicate', text: 'First' }, { id: 'duplicate', text: 'Second' }] });
    fs.writeFileSync(stateFile, JSON.stringify(saved)); const bytes = fs.readFileSync(stateFile);
    await loadDraftLifecycle(id, true);
    expect(useAppStore.getState().draftLifecycle).toMatchObject({ status: 'conflict', error: 'ambiguous-variant-identity' });
    expect(readDrafts().conflicts[0].preserved[1].swipeSet).toEqual(saved.messages[1].swipeSet);
    expect(fs.readFileSync(stateFile)).toEqual(bytes); expect(model.calls).toHaveLength(0);
});
