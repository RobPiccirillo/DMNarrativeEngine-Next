import { vi } from 'vitest';
import { setTimeout as hostDelay } from 'node:timers/promises';
import { useAppStore } from '../../../store/useAppStore';
import { cancelPendingSaves, flushAllPendingSaves, hasPendingSaves } from '../../../store/slices/campaignSlice';
import { runTurn } from '../../../services/turn/turnOrchestrator';
import type { TurnCallbacks, TurnState } from '../../../services/turn/turnOrchestrator';
import { clearPendingTurnSnapshot, commitPendingTurn, getCachedSwipePayload, getPendingTurnSnapshot, persistPendingTurn } from '../../../services/turn/pendingCommit';
import { clearDirectorBriefCache } from '../../../services/turn/directorBrief';
import { setExtensionModules, getExtensionModules } from '../../../services/payload/contributions/extensions';
import { postTurnTracks } from '../../../services/turn/tracks';
import { mergeLifecycleEntries } from '../../../services/campaign-state/divergenceRegister';
import { countTokens } from '../../../services/infrastructure/tokenizer';
import { getActiveCalls, clearHistory } from '../../../services/llm/utilityCallTracker';
import { Recorder, wrapCallbacksWithRecorder } from '../../../services/turn/__tests__/baseAppGate/recorder';
import { installDeterministicMathRandom } from '../../../services/turn/__tests__/baseAppGate/deterministicSeams';
import { fixtureCondenser, fixtureHistory, fixtureProvider, FIXTURE_CAMPAIGN_ID, FIXTURE_NOW_MS } from '../../../services/turn/__tests__/baseAppGate/fixture';
import { aliasGeneratedIds, canonical, engine, entries, messages, pick, validateArtifact } from './artifacts';
import { syntheticIO } from './replayIO';
import { observe } from './observe';
import type { EvalResult, EvalScenario, Json, TurnEvalResult } from './types';
import { fact } from '../fixtures/scenarios';
import type { SamplingConfig } from '../../../types';
import type { SmokeProvider } from './ollamaLive';
import { getChatUrl } from '../../../utils/llmApiHelper';
import type { ModelCall } from './types';
import type { CallTiming } from './observe';

export type RunOptions = {
    live?: { provider: SmokeProvider; sampling: SamplingConfig; perCallMs: number; totalMs: number };
    now?: () => number;
    afterTurn?: (value: { ordinal: number; draftMs: number; commitMs: number }) => void;
    captureCalls?: (calls: ModelCall[], timings: Map<ModelCall, CallTiming[]>) => void;
};

export async function runScenario(scenario: EvalScenario, options: RunOptions = {}) {
    const originalStore = useAppStore.getState();
    const originalExtensions = getExtensionModules();
    const removedTracks = postTurnTracks.list().filter(t => t.id.startsWith('mod.'));
    const realFetch = globalThis.fetch;
    const now = options.now ?? (() => performance.now());
    const started = now();
    const restoreRandom = options.live ? () => {} : installDeterministicMathRandom(scenario.seed);
    if (!options.live) { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); vi.setSystemTime(FIXTURE_NOW_MS); }
    const observer = observe(now);
    const io = syntheticIO(observer, options.live ? { fetch: realFetch, endpoint: getChatUrl(options.live.provider, { stream: true }), perCallMs: options.live.perCallMs, provider: options.live.provider, sampling: options.live.sampling, now } : undefined);
    const runAbort = new AbortController();
    const totalTimer = options.live ? setTimeout(() => runAbort.abort(), options.live.totalMs) : null;
    const recorder = new Recorder();
    const storeChanges: Json[] = [];
    const unsubscribe = useAppStore.subscribe((s, previous) => {
        const fields = {
            engine: engine(s.context), entries: entries(s.divergenceRegister.entries), cast: s.onStageNpcIds,
            location: pick(s.context, ['currentPlaceId', 'currentFeature']),
        };
        const before = {
            engine: engine(previous.context), entries: entries(previous.divergenceRegister.entries), cast: previous.onStageNpcIds,
            location: pick(previous.context, ['currentPlaceId', 'currentFeature']),
        };
        for (const key of Object.keys(fields) as (keyof typeof fields)[]) if (canonical(fields[key]) !== canonical(before[key])) storeChanges.push({ field: key, value: fields[key] });
    });
    const results: TurnEvalResult[] = [];
    const drive = async <T>(promise: Promise<T>): Promise<T> => {
        if (options.live) return promise;
        let done = false, result: T | undefined, failure: unknown;
        void promise.then(v => { result = v; done = true; }, e => { failure = e; done = true; });
        for (let step = 0; step < 2000 && !done; step++) {
            await vi.advanceTimersByTimeAsync(0);
            if (!done) await vi.advanceTimersByTimeAsync(1);
            if (step % 10 === 0) await hostDelay(1);
        }
        if (!done) { runAbort.abort(); throw new Error('Scenario exceeded bounded zero-time progress'); }
        if (failure) throw failure;
        return result as T;
    };
    const idle = async () => {
        for (let step = 0; step < 100; step++) {
            await drive(flushAllPendingSaves());
            if (!options.live) { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(1); await hostDelay(1); }
            else await new Promise(resolve => setTimeout(resolve, 5));
            if (observer.idle() && io.idle() && !hasPendingSaves() && !getActiveCalls().length) return;
        }
        throw new Error(`Unfinished background work or requests: ${JSON.stringify({ calls: observer.calls.map(c => ({ purpose: c.purpose, status: c.status, attempts: c.attempts.length })), active: getActiveCalls().map(c => c.label), violations: io.violations })}`);
    };
    try {
        cancelPendingSaves(); clearPendingTurnSnapshot(); clearDirectorBriefCache(); clearHistory();
        setExtensionModules([]);
        removedTracks.forEach(t => postTurnTracks.unregister(t.id));
        const f = scenario.fixture();
        if (f.archiveSource) {
            io.sources.set('000', f.archiveSource);
            io.index[0].userSnippet = f.history?.find(m => m.role === 'user')?.content ?? '';
            io.index[0].keywords = ['courtyard', 'guardhouse'];
        }
        if (f.chapterTitle) io.chapters[0].title = f.chapterTitle;
        useAppStore.setState({ ...useAppStore.getInitialState(),
            activeCampaignId: FIXTURE_CAMPAIGN_ID, context: f.context, settings: f.settings,
            messages: f.history ?? fixtureHistory(), condenser: fixtureCondenser(), loreChunks: [], npcLedger: f.npcs,
            archiveIndex: structuredClone(io.index), chapters: structuredClone(io.chapters), timeline: [], divergenceRegister: f.register,
            pinnedExcerpts: [], onStageNpcIds: [], locationLedger: [], npcSuggestions: [], locationSuggestions: [],
            bookkeepingTurnCounter: 0, autoBookkeepingInterval: 5,
        });
        io.persisted.set('npcs', structuredClone(f.npcs));
        if (scenario.id === 'stale-holder-supersession') {
            const next = mergeLifecycleEntries(f.register, [fact('holder-new', 'Kaelen holds the Moon Key.', { stateKey: 'item:moon-key:holder', supersedesFactId: 'holder-old' })], '000');
            useAppStore.getState().setDivergenceRegister(next);
            io.sources.set('000', 'Earlier, Mira held the Moon Key beside the tavern.');
            io.index[0].keywords = ['Moon Key', 'Mira', 'holder'];
            useAppStore.setState({ archiveIndex: structuredClone(io.index) });
        }
        await idle();
        const store = () => useAppStore.getState();
        const cb: TurnCallbacks = {
            onCheckingNotes: () => {}, addMessage: m => store().addMessage(m),
            updateLastAssistant: s => store().updateLastAssistant(s), updateLastMessage: p => store().updateLastMessage(p),
            updateLastAssistantMessage: p => store().updateLastAssistantMessage(p), updateContext: p => store().updateContext(p),
            getFreshLocationState: () => ({ activeCampaignId: FIXTURE_CAMPAIGN_ID, context: store().context, locationLedger: store().locationLedger }),
            setCharacterProfileData: p => store().setCharacterProfileData(p), setInventoryItems: p => store().setInventoryItems(p),
            setLocationLedger: p => store().setLocationLedger(p), addLocationSuggestions: p => store().addLocationSuggestions(p),
            setArchiveIndex: p => store().setArchiveIndex(p), setTimeline: p => store().setTimeline(p),
            updateNPC: (id, p) => store().updateNPC(id, p), addNPC: p => store().addNPC(p), setCondensed: p => store().setCondensed(p),
            setStreaming: p => store().setStreaming(p), setLastPayloadTrace: p => store().setLastPayloadTrace(p),
            setLoadingStatus: () => {}, setPipelinePhase: p => { observer.setPhase(p); store().setPipelinePhase(p); },
            setDivergenceRegister: p => store().setDivergenceRegister(p), setOnStageNpcIds: p => store().setOnStageNpcIds(p),
            addNpcSuggestions: (p, c) => store().addNpcSuggestions(p, c), archiveNPC: (id, turn, reason) => store().archiveNPC(id, turn, reason),
            restoreNPC: id => store().restoreNPC(id), stageInventoryProposal: () => {}, onDirectorBriefPhase: () => {},
            persistTurnState: () => { void persistPendingTurn(); },
        };
        const callbacks = wrapCallbacksWithRecorder(cb, recorder);
        for (const [i, turn] of scenario.turns.entries()) {
            if (runAbort.signal.aborted || (options.live && now() - started >= options.live.totalMs)) throw new Error('Total smoke ceiling reached');
            const turnStarted = now();
            observer.setTurn(i + 1); observer.setPhase('setup');
            const writeStart = io.writes.length, effectStart = recorder.effects.length, jobStart = observer.jobs.length, callStart = observer.calls.length, trafficStart = io.traffic.length, trackStart = observer.tracks.length, changeStart = storeChanges.length, warningStart = observer.warnings.length;
            if (turn.cast) store().setOnStageNpcIds(turn.cast);
            if (turn.correction) {
                store().editDivergenceFact('bridge-status', 'The north bridge is closed.');
                await idle();
                const res = await fetch(`/api/campaigns/${FIXTURE_CAMPAIGN_ID}/divergence`);
                useAppStore.setState({ divergenceRegister: await res.json() });
            }
            const registerBefore = entries(store().divergenceRegister.entries);
            const s = store(), provider = options.live?.provider ?? fixtureProvider();
            const state: TurnState = {
                ...s, input: turn.input, displayInput: turn.input, provider,
                getMessages: () => store().messages, getFreshProvider: () => provider, getUtilityEndpoint: () => undefined,
                getFreshAuxiliaryProvider: () => provider, getRawAuxiliaryProvider: () => provider, getRawSummariserProvider: () => provider,
                clearPinnedChapters: () => store().clearPinnedChapters(), setChapters: c => store().setChapters(c),
                incrementBookkeepingTurnCounter: () => store().incrementBookkeepingTurnCounter(), resetBookkeepingTurnCounter: () => store().resetBookkeepingTurnCounter(),
                getFreshContext: () => store().context, sampling: options.live?.sampling,
                deepSearchThisTurn: false, armedRoll: null, armedLoot: null, armedOneShot: null,
                absoluteCommand: null, nextTurnOocBrief: undefined, directorSkipController: null,
            };
            const archiveBefore = io.index.length;
            io.begin(turn.response);
            await drive(runTurn(state, callbacks, runAbort));
            const draftMs = now() - turnStarted;
            io.assertComplete();
            if (observer.calls.slice(callStart).some(c => c.status !== 'success')) throw new Error('Turn did not generate a successful response');
            const draft = useAppStore.getState().messages.at(-1);
            if (draft?.role !== 'assistant' || !draft.content.trim()) throw new Error(`${options.live ? 'Live turn' : 'Turn'} ${i + 1} has empty visible Story content; response was not committed`);
            if (options.live) {
                const calls = observer.calls.slice(callStart);
                if (calls.length !== 1 || calls[0].purpose !== 'story-generation' || calls[0].attempts.length !== 1 || calls[0].attempts[0].status !== 200 || calls[0].attempts[0].error) throw new Error('Live turn requires one successful Story call without retries/errors');
            }
            const snapshot = getPendingTurnSnapshot(), payload = getCachedSwipePayload();
            if (!snapshot?.turnContext || !payload?.length) throw new Error('Successful turn has no captured payload/context');
            const ctx = snapshot.turnContext, g = ctx.gathered;
            const pending = messages(store().messages);
            const archiveAtDraft = io.index.length;
            const castAtDraft = [...state.onStageNpcIds ?? []];
            await idle();
            observer.setPhase('commit');
            await drive(commitPendingTurn());
            await idle();
            io.assertComplete();
            if (options.live) {
                const accepted = useAppStore.getState().messages.at(-1);
                if (accepted?.role !== 'assistant' || !accepted.content.trim() || !accepted.sceneId || accepted.pendingCommit || io.index.length !== archiveBefore + 1 || observer.calls.length !== callStart + 1) throw new Error('Live Story response was not committed cleanly or triggered an unexpected call');
            }
            if (observer.violations.length) throw new Error(observer.violations.join(', '));
            const effects = recorder.effects.slice(effectStart).flatMap(e => {
                const args = e.args as unknown[] | undefined;
                if (e.name === 'updateLastAssistant') return [{ name: e.name, value: args?.[0] ?? null }];
                if (e.name === 'updateContext') return [{ name: e.name, value: engine(args?.[0]) }];
                if (e.name === 'setPipelinePhase' || e.name === 'setOnStageNpcIds') return [{ name: e.name, value: args?.[0] ?? null }];
                return [];
            });
            const result: TurnEvalResult = {
                ordinal: i + 1,
                prompt: { messages: payload as unknown as Json, trace: (ctx.payloadTrace ?? []).map(t => pick(t, ['source', 'included', 'reason', 'tokens', 'position', 'classification', 'content'])) },
                retrieval: {
                    semanticArchiveIds: g.semanticArchiveIds ?? null, semanticLoreIds: g.semanticLoreIds ?? null,
                    recalled: (g.archiveRecall ?? []).map(x => pick(x, ['sceneId', 'content', 'tokens'])),
                    loreIds: (g.relevantLore ?? []).map(x => x.id), ruleIds: (g.relevantRules ?? []).map(x => x.id),
                    elevatedIds: g.elevatedSceneRankedIds ?? [], slotted: (g.slottedRagSnippets ?? []).map(x => pick(x, ['sceneId', 'lines'])),
                },
                'effects-and-writes': { callbacks: effects as Json, writes: io.writes.slice(writeStart), jobs: observer.jobs.slice(jobStart), tracks: observer.tracks.slice(trackStart), storeChanges: storeChanges.slice(changeStart), apiTraffic: io.traffic.slice(trafficStart) },
                'calls-and-tokens': { calls: observer.calls.slice(callStart) as unknown as Json, tokenizer: 'cl100k_base-estimate', requestTextEstimate: countTokens(payload.map(m => m.content ?? '').join('\n')) },
                messages: { pending, committed: messages(store().messages) },
                state: {
                    engine: engine(store().context), inventory: store().context.inventory, registerBefore,
                    location: pick(store().context, ['currentPlaceId', 'currentFeature']),
                    entries: entries(store().divergenceRegister.entries), castAtDraft,
                    castAfterCommit: store().onStageNpcIds, archiveBefore, archiveAtDraft, archiveAfterCommit: io.index.length,
                    appendSceneId: io.index.at(-1)!.sceneId,
                },
                diagnostics: { violations: [...io.violations, ...observer.violations], warnings: observer.warnings.slice(warningStart), idle: observer.idle() && io.idle(), pendingSaves: hasPendingSaves() },
            };
            results.push(result);
            options.afterTurn?.({ ordinal: i + 1, draftMs, commitMs: now() - turnStarted });
        }
        const result = aliasGeneratedIds({ schemaVersion: 0, scenario: scenario.id, scenarioVersion: 1, kind: 'behavioral', turns: results } as unknown as Json) as unknown as EvalResult;
        if (!options.live) validateArtifact(result);
        return { result, calls: observer.calls, timings: observer.timings };
    } finally {
        runAbort.abort(); if (totalTimer) clearTimeout(totalTimer);
        try { await idle(); } finally {
            try { options.captureCalls?.(observer.calls, observer.timings); } finally {
                cancelPendingSaves(); clearPendingTurnSnapshot(); clearDirectorBriefCache(); clearHistory();
                unsubscribe();
                io.restore(); observer.restore();
                setExtensionModules(originalExtensions); removedTracks.forEach(t => postTurnTracks.register(t));
                useAppStore.setState(originalStore, true);
                if (!options.live) { vi.clearAllTimers(); vi.useRealTimers(); }
                restoreRandom();
            }
        }
    }
}
