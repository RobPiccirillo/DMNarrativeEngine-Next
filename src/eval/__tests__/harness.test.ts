import { afterEach, describe, expect, it, vi } from 'vitest';
import * as story from '../../services/llm/llmService';
import * as utility from '../../utils/llmCall';
import { useAppStore } from '../../store/useAppStore';
import { hasPendingSaves } from '../../store/slices/campaignSlice';
import { getPendingTurnSnapshot } from '../../services/turn/pendingCommit';
import { fixtureProvider } from '../../services/turn/__tests__/baseAppGate/fixture';
import { canonical, compare, hash, aliasGeneratedIds, validateArtifact } from './support/artifacts';
import { measurements, observe } from './support/observe';
import { streamResponse, syntheticIO } from './support/replayIO';
import { runScenario } from './support/runScenario';
import { scenario } from './fixtures/scenarios';
import { assertScenario, storyWireMessages } from './assertions';
import { applyKnownTargetViolations, knownTargetViolations } from './support/knownTargetViolations';
import { liveInputs, liveScenario, validateSmokeConfig } from './fixtures/liveSmoke';
import type { SmokeConfig } from './fixtures/liveSmoke';
import type { AssertionResult, EvalResult, Json } from './support/types';

const tiny = (): EvalResult => ({ schemaVersion: 0, scenario: 'canonical-commit', scenarioVersion: 1, kind: 'behavioral', turns: [{ ordinal: 1, prompt: { messages: ['a'] }, retrieval: { semanticArchiveIds: ['s1', 's2'] }, 'effects-and-writes': { writes: ['w1', 'w2'] }, 'calls-and-tokens': { calls: [{ attempts: 1 }] }, messages: { pending: [], committed: [] }, state: { engine: { value: 1 } }, diagnostics: { violations: [] } }] });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('reviewed Phase 0 target violations', () => {
    const rawChecks = (): AssertionResult[] => [
        { id: 'visibility.cast-scoped.knower-included', kind: 'normative', status: 'PASS' },
        ...knownTargetViolations.violations.map(v => ({ id: v.assertionId, kind: 'normative' as const, status: 'FAIL' as const, failureCondition: structuredClone(v.reviewedFailureCondition) })),
    ];
    const classify = (checks: AssertionResult[]) => applyKnownTargetViolations(checks, 'scoped-secret-cast-change');
    it('reports exactly matched reviewed conditions as KNOWN_TARGET_VIOLATION', () => {
        const checks = classify(rawChecks());
        expect(checks.filter(c => c.status === 'KNOWN_TARGET_VIOLATION')).toHaveLength(2);
        expect(checks.filter(c => c.status === 'KNOWN_TARGET_VIOLATION').every(c => c.kind === 'known-target-violation' && c.responsiblePhases?.join(',') === '6,9A')).toBe(true);
    });
    it('keeps an unlisted assertion failure fatal', () => {
        expect(classify([...rawChecks(), { id: 'unexpected.failure', kind: 'normative', status: 'FAIL' }]).at(-1)?.status).toBe('FAIL');
    });
    it('requires review for an unexpected PASS', () => {
        const checks = rawChecks(); checks[1].status = 'PASS';
        expect(classify(checks)[1]).toMatchObject({ status: 'FAIL', reviewRequired: true });
    });
    it('fails closed when a listed assertion disappears', () => {
        expect(classify(rawChecks().slice(0, 2)).at(-1)).toMatchObject({ id: 'visibility.hidden-absent', status: 'FAIL', reviewRequired: true });
    });
    it('fails when a different subcondition produces the failure', () => {
        const checks = rawChecks(); (checks[1].failureCondition as Record<string, Json>).unknownFactsOccurrences = [0];
        expect(classify(checks)[1]).toMatchObject({ status: 'FAIL', reviewRequired: true });
    });
    it('cannot suppress target violations by accepting behavioral snapshots', () => {
        expect(compare(tiny(), tiny()).status).toBe('MATCH');
        expect(classify(rawChecks()).filter(c => c.status === 'KNOWN_TARGET_VIOLATION')).toHaveLength(2);
        const changed = rawChecks(); (changed[1].failureCondition as Record<string, Json>).requirement = 'different-failed-requirement';
        expect(classify(changed)[1].status).toBe('FAIL');
    });
    it('leaves knower inclusion an ordinary required PASS without a disposition', () => {
        expect(knownTargetViolations.violations.some(v => v.assertionId === 'visibility.cast-scoped.knower-included')).toBe(false);
        const checks = rawChecks(); expect(classify(checks)[0]).toMatchObject({ kind: 'normative', status: 'PASS' });
        checks[0].status = 'FAIL'; expect(classify(checks)[0]).toMatchObject({ kind: 'normative', status: 'FAIL' });
    });
    it('uses the actual Story wire request and admits the scoped block at 4096 tokens', async () => {
        const f = scenario('scoped-secret-cast-change'), { result } = await runScenario(f);
        const errors: unknown[] = [], checks = assertScenario(result, f, errors);
        expect(errors).toEqual([]);
        expect(checks.filter(c => c.status === 'KNOWN_TARGET_VIOLATION')).toHaveLength(2);
        expect(checks.find(c => c.id === 'visibility.cast-scoped.knower-included')?.status).toBe('PASS');
        expect(f.fixture().settings.contextLimit).toBe(4096);
        const cachedMutation = structuredClone(result); cachedMutation.turns[0].prompt = { messages: [], trace: (result.turns[0].prompt as Record<string, Json>).trace };
        expect(assertScenario(cachedMutation, f).find(c => c.id === 'visibility.cast-scoped.knower-included')?.status).toBe('PASS');
        const wireMutation = structuredClone(result);
        for (const m of storyWireMessages(wireMutation.turns[0])) m.content = m.content?.replace('The brass token opens the cellar.', '') ?? null;
        expect(assertScenario(wireMutation, f).find(c => c.id === 'visibility.cast-scoped.knower-included')?.status).toBe('FAIL');
    });
});

describe('strict deterministic artifacts', () => {
    it('sorts keys recursively and preserves array and write/rank order', () => {
        expect(canonical({ b: 2, a: { z: 0, a: 1 } })).toBe(canonical({ a: { a: 1, z: 0 }, b: 2 }));
        expect(canonical({ '2': true, '10': false })).toBe('{\n  "10": false,\n  "2": true\n}\n');
        const a = tiny(), b = tiny();
        b.turns[0].retrieval = { semanticArchiveIds: ['s2', 's1'] };
        expect(hash(canonical(a))).not.toBe(hash(canonical(b)));
        b.turns[0]['effects-and-writes'] = { writes: ['w2', 'w1'] };
        expect(compare(a, b).differences.some(d => d.category === 'effects-and-writes')).toBe(true);
    });
    it.each([undefined, NaN, Infinity, () => {}, Symbol('x'), 1n, new Map(), new Set(), new Date()])('rejects unsupported values %s', v => expect(() => canonical({ v })).toThrow());
    it('rejects cycles', () => { const x: Record<string, unknown> = {}; x.x = x; expect(() => canonical(x)).toThrow(); });
    it('aliases generated references without changing source identity', () => {
        const result = aliasGeneratedIds([{ id: 'loc_1700000000000_abcd' }, { placeId: 'loc_1700000000000_abcd', id: 'holder-old' }] as Json);
        expect(result).toEqual([{ id: 'generated-1' }, { placeId: 'generated-1', id: 'holder-old' }]);
    });
    it.each(['apiKey', 'Authorization', 'headers', 'timestamp', 'stack', 'password'])('rejects forbidden %s fields', field => {
        const x = tiny(); x.turns[0].state = { [field]: 'x' }; expect(() => validateArtifact(x)).toThrow();
    });
    it.each(['C:\\Users\\person\\secret', '/home/person/private', 'http://localhost:11434', 'Bearer secret', '2026-10-15T10:00:00Z'])('rejects unsafe text %s', text => {
        const x = tiny(); x.turns[0].prompt = { text }; expect(() => validateArtifact(x)).toThrow();
    });
    it('rejects unexpected result fields', () => expect(() => validateArtifact({ ...tiny(), liveSettings: {} })).toThrow());
    it.each(['prompt', 'retrieval', 'calls-and-tokens', 'state', 'effects-and-writes'] as const)('reports a focused %s mutation for review', category => {
        const a = tiny(), b = tiny();
        const field = Object.keys(b.turns[0][category] as object)[0];
        b.turns[0][category] = { [field]: [{ changed: true }] };
        const diff = compare(a, b);
        expect(diff.status).toBe('REVIEW_REQUIRED');
        expect(diff.differences.every(d => d.category === category && d.path.startsWith(`turns.0.${category}`))).toBe(true);
    });
});

describe('real provider parsing and strict synthetic API', () => {
    it('parses separate stream deliveries, split records, UTF-8 and reasoning incrementally', async () => {
        const original = globalThis.fetch, observation = observe();
        const chunks: string[] = [], reasoning: string[] = [];
        globalThis.fetch = async () => streamResponse({ deltas: ['The ', '☃ courtyard ', 'opens.'], reasoning: ['Considering.'] });
        try {
            await story.sendMessage(fixtureProvider(), [{ role: 'user', content: 'Look.' }], s => chunks.push(s), () => {}, e => { throw new Error(e); }, [], undefined, undefined, undefined, undefined, s => reasoning.push(s));
            expect(chunks).toEqual(['The ', 'The ☃ courtyard ', 'The ☃ courtyard opens.']);
            expect(reasoning).toEqual(['Considering.']);
            expect(observation.idle()).toBe(true);
        } finally { globalThis.fetch = original; observation.restore(); }
    });
    it('retains state writes, appends and declared source reads and rejects unknown traffic', async () => {
        const o = observe(), io = syntheticIO(o);
        const root = '/api/campaigns/camp-base-app-gate/';
        try {
            await fetch(root + 'archive', { method: 'POST', body: JSON.stringify({ userContent: 'Look.', assistantContent: 'Rain.' }) });
            const index = await (await fetch(root + 'archive/index')).json(); expect(index.at(-1).sceneId).toBe('001');
            expect(await (await fetch(root + 'archive/scenes?ids=001')).json()).toEqual([{ sceneId: '001', content: 'Look.\nRain.' }]);
            await fetch(root + 'divergence', { method: 'PUT', body: JSON.stringify({ entries: [{ id: 'bridge-status', text: 'Closed.' }] }) });
            expect(await (await fetch(root + 'divergence')).json()).toEqual({ entries: [{ id: 'bridge-status', text: 'Closed.' }] });
            await fetch(root + 'undeclared');
            expect(() => io.assertComplete()).toThrow('undeclared-route');
        } finally { io.restore(); o.restore(); }
    });
    it('rejects unexpected provider requests independently of production fallbacks', async () => {
        const o = observe(), io = syntheticIO(o);
        try {
            io.begin({ deltas: ['Recorded.'] }, false);
            await utility.llmCall(fixtureProvider(), 'Unexpected.', { trackingLabel: 'extra', timeoutMs: 1000 }).catch(() => {});
            expect(() => io.assertComplete()).toThrow('unexpected-provider-request');
        } finally { io.restore(); o.restore(); }
    });
    it('captures actual nonstreaming Director parsing separately from Story and API traffic', async () => {
        const f = scenario('call-ledger-pro'), run = await runScenario(f);
        expect(assertScenario(run.result, f).every(a => a.status === 'PASS')).toBe(true);
        expect(run.calls.map(c => c.purpose)).toEqual(['director-brief', 'story-generation', 'director-brief', 'story-generation']);
        expect(run.calls.map(c => c.attempts[0].stream)).toEqual([false, true, false, true]);
        expect(run.calls.every(c => c.attempts.length === 1)).toBe(true);
    });
    it('retains failed and retried provider attempts under one logical invocation', async () => {
        const o = observe(), io = syntheticIO(o);
        io.begin({ deltas: ['Rain.'], attemptStatuses: [503, 200] }, true);
        try {
            expect(await utility.llmCall(fixtureProvider(), 'Brief.', { trackingLabel: 'director-brief', timeoutMs: 3000 })).toContain('preserve');
            expect(o.calls).toHaveLength(1); expect(o.calls[0].attempts.map(a => a.status)).toEqual([503, 200]);
        } finally { io.restore(); o.restore(); }
    });
});

describe('runner boundaries and cleanup', () => {
    it('is stable across sequential runs and leaves globals/store/saves clean', async () => {
        const fetch = globalThis.fetch, random = Math.random, original = useAppStore.getState();
        const f = scenario('canonical-commit');
        const a = await runScenario(f), b = await runScenario(f);
        expect(canonical(a.result)).toBe(canonical(b.result));
        expect(assertScenario(a.result, f).every(a => a.status === 'PASS')).toBe(true);
        const mutation = structuredClone(a.result); (mutation.turns[0].state as Record<string, Json>).archiveAfterCommit = 0;
        expect(compare(a.result, mutation).status).toBe('REVIEW_REQUIRED');
        expect(assertScenario(mutation, f).some(a => a.id.startsWith('state.') && a.status === 'FAIL')).toBe(true);
        expect(globalThis.fetch).toBe(fetch); expect(Math.random).toBe(random);
        expect(useAppStore.getState()).toBe(original); expect(getPendingTurnSnapshot()).toBeNull();
        expect(hasPendingSaves()).toBe(false); expect(vi.isFakeTimers()).toBe(false);
    });
    it('restores globals and store after fixture exceptions', async () => {
        const original = useAppStore.getState(), fetch = globalThis.fetch, random = Math.random;
        const f = scenario('canonical-commit'); f.fixture = () => { throw new Error('broken fixture'); };
        await expect(runScenario(f)).rejects.toThrow('broken fixture');
        expect(globalThis.fetch).toBe(fetch); expect(Math.random).toBe(random); expect(useAppStore.getState()).toBe(original);
        expect(vi.isFakeTimers()).toBe(false);
    });
});

describe('bounded smoke configuration and objective timing', () => {
    it('has seven fixed inputs and rejects absent identity before network dispatch', () => {
        expect(liveInputs).toHaveLength(7); expect(() => validateSmokeConfig({})).toThrow('identity');
    });
    it('calculates dispatch-based TTFT, reasoning, queue and logical durations separately', () => {
        expect(measurements({ invocation: 0, queueRequested: 2, granted: 12, dispatch: 15, firstReasoning: 20, firstNarrative: 35, completed: 75, terminal: 80 })).toEqual({ queueWaitMs: 10, ttftMs: 20, reasoningFirstTokenMs: 5, generationMs: 60, logicalCallMs: 80 });
    });
    it('observes parsed first deltas from controlled delayed stream deliveries', async () => {
        let tick = 0;
        const original = globalThis.fetch, o = observe(() => tick);
        globalThis.fetch = async () => {
            tick = 5; o.dispatch(); let n = 0;
            return new Response(new ReadableStream({
                async pull(controller) {
                    await Promise.resolve(); n++; tick = n * 10;
                    if (n === 3) { controller.close(); return; }
                    const delta = n === 1 ? { reasoning_content: 'Consider.' } : { content: 'Rain.' };
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
                },
            }, { highWaterMark: 0 }));
        };
        try {
            await story.sendMessage(fixtureProvider(), [{ role: 'user', content: 'Look.' }], () => {}, () => {}, e => { throw new Error(e); });
            expect(measurements(o.timings.get(o.calls[0])![0])).toEqual({ queueWaitMs: 0, ttftMs: 15, reasoningFirstTokenMs: 5, generationMs: 25, logicalCallMs: 30 });
        } finally { globalThis.fetch = original; o.restore(); }
    });
    it('validates identity and executes seven turns through the real-timer smoke mechanism with a controlled provider', async () => {
        const config: SmokeConfig = {
            provider: { endpoint: 'http://127.0.0.1:1234/v1', modelName: 'unit-model', apiKey: '', apiFormat: 'openai' },
            environment: { modelId: 'unit-model', quantization: 'unit-quantization', inferenceServer: 'unit-server', serverVersion: 'unit-version', contextWindow: 4096, outputLimit: 128, sampling: { temperature: 0.7, max_tokens: 128 }, cpu: 'unit-cpu', ramGiB: 16, gpu: null, vramGiB: null, offload: { mode: 'cpu-only', layers: 0 }, threads: null, batch: null, modelStatus: 'warm', endpointRoles: { story: 'local-story', auxiliary: null, utility: null, summariser: null } },
            ceilings: { perCallMs: 1000, totalMs: 5000 },
        };
        expect(() => validateSmokeConfig(config)).not.toThrow();
        for (const field of ['quantization', 'serverVersion', 'cpu', 'offload', 'threads', 'modelStatus'] as const) {
            const bad = structuredClone(config); delete (bad.environment as unknown as Record<string, unknown>)[field];
            expect(() => validateSmokeConfig(bad)).toThrow();
        }
        const original = globalThis.fetch;
        let dispatches = 0;
        globalThis.fetch = async (input, init) => {
            expect(String(input)).toBe('http://127.0.0.1:1234/v1/chat/completions');
            expect(JSON.parse(String(init?.body)).model).toBe('unit-model');
            dispatches++;
            return streamResponse({ deltas: ['Rain ', 'falls.'], usage: { prompt_tokens: 100, completion_tokens: 4 } });
        };
        try {
            const turns: unknown[] = [];
            const run = await runScenario(liveScenario(config), { live: { provider: config.provider, sampling: config.environment.sampling, ...config.ceilings }, afterTurn: t => turns.push(t) });
            expect(dispatches).toBe(7); expect(turns).toHaveLength(7);
            expect(run.calls.every(c => c.status === 'success')).toBe(true);
            expect(run.calls[0].attempts[0].usage).toMatchObject({ prompt_tokens: 100, completion_tokens: 4 });
            expect(run.result.turns[4].state).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ id: 'bridge-status', text: 'The north bridge is closed.', source: 'manual' })]) });
            expect(vi.isFakeTimers()).toBe(false);
        } finally { globalThis.fetch = original; }
    });
});
