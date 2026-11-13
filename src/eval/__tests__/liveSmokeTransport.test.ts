import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveScenario, validateSmokeConfig } from './fixtures/liveSmoke';
import type { SmokeConfig } from './fixtures/liveSmoke';
import { runScenario } from './support/runScenario';
import { ollamaLiveBody } from './support/ollamaLive';
import { measurements, observe } from './support/observe';
import { streamResponse, syntheticIO } from './support/replayIO';
import { FIXTURE_CAMPAIGN_ID } from '../../services/turn/__tests__/baseAppGate/fixture';
import { api } from '../../services/llm/apiClient';
import * as proxy from '../../services/llm/llmFetch';
import { postTurnTracks } from '../../services/turn/tracks';
import { backgroundQueue } from '../../services/infrastructure/backgroundQueue';

function config(format: 'openai' | 'ollama'): SmokeConfig {
    return {
        provider: { endpoint: `http://127.0.0.1:1234${format === 'openai' ? '/v1' : ''}`, apiKey: '', modelName: 'unit-story-model', apiFormat: format, ...(format === 'ollama' ? { think: false as const } : {}) },
        environment: { modelId: 'unit-story-model', quantization: 'unit-quantization', inferenceServer: 'unit-server', serverVersion: 'unit-version', contextWindow: 4096, outputLimit: 512, sampling: { temperature: 0.7, max_tokens: 512 }, cpu: 'unit-cpu', ramGiB: 32, gpu: null, vramGiB: null, offload: { mode: 'cpu-only', layers: 0 }, threads: null, batch: null, modelStatus: 'warm', endpointRoles: { story: 'local-story', utility: null, auxiliary: null, summariser: null } },
        ceilings: { perCallMs: 2000, totalMs: 8000 },
    };
}

function nativeResponse(visible = 'Rain ☃ falls.', thinking = 'Private reasoning.', done = true) {
    const records = [
        { message: { role: 'assistant', thinking }, done: false },
        { message: { role: 'assistant', content: visible.slice(0, 6) }, done: false },
        { message: { role: 'assistant', content: visible.slice(6) }, done: false },
        ...(done ? [{ message: { content: '' }, done: true, prompt_eval_count: 123, eval_count: 17, done_reason: 'stop', total_duration: 9000 }] : []),
    ];
    const bytes = new TextEncoder().encode(records.map(r => JSON.stringify(r)).join('\n'));
    let offset = 0;
    return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset === bytes.length) { controller.close(); return; }
            controller.enqueue(bytes.slice(offset, offset + 7)); offset = Math.min(bytes.length, offset + 7);
        },
    }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

afterEach(() => vi.restoreAllMocks());

describe('live-smoke-only native Ollama transport', () => {
    it('validates both transports and rejects unsupported/misleading native controls', () => {
        expect(() => validateSmokeConfig(config('openai'))).not.toThrow();
        expect(() => validateSmokeConfig(config('ollama'))).not.toThrow();
        const wrongBase = config('ollama'); wrongBase.provider.endpoint += '/v1';
        expect(() => validateSmokeConfig(wrongBase)).toThrow('server root');
        const wrongThink = config('openai'); wrongThink.provider.think = false;
        expect(() => validateSmokeConfig(wrongThink)).toThrow('only in native Ollama');
        const unsupported = config('ollama'); unsupported.environment.sampling.frequency_penalty = 0.5;
        expect(() => validateSmokeConfig(unsupported)).toThrow('Unsupported native Ollama');
    });
    it('maps sampling and output limits exactly into native options', () => {
        const c = config('ollama');
        expect(ollamaLiveBody({ messages: [] }, c.provider, { temperature: 0.7, max_tokens: 512, top_p: 0.9, top_k: 40, min_p: 0.05, repetition_penalty: 1.1 })).toEqual({
            model: 'unit-story-model', messages: [], stream: true, think: false,
            options: { temperature: 0.7, num_predict: 512, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.1 },
        });
    });
    it.each(['openai', 'ollama'] as const)('streams and commits seven visible responses in %s mode with one call each', async format => {
        const c = config(format), original = globalThis.fetch, requests: Record<string, unknown>[] = [];
        globalThis.fetch = async (input, init) => {
            expect(String(input)).toBe(format === 'ollama' ? 'http://127.0.0.1:1234/api/chat' : 'http://127.0.0.1:1234/v1/chat/completions');
            const body = JSON.parse(String(init?.body)); requests.push(body);
            if (format === 'ollama') {
                expect(body).toMatchObject({ think: false, stream: true, options: { temperature: 0.7, num_predict: 512 } });
                expect(body.max_tokens).toBeUndefined(); expect(body.temperature).toBeUndefined();
                return nativeResponse();
            }
            expect(body).toMatchObject({ temperature: 0.7, max_tokens: 512, stream: true, stream_options: { include_usage: true } });
            expect(body.think).toBeUndefined(); expect(body.options).toBeUndefined();
            return streamResponse({ deltas: ['Rain ', '☃ falls.'], reasoning: ['Private reasoning.'], usage: { prompt_tokens: 123, completion_tokens: 17 } });
        };
        try {
            const completed: number[] = [];
            const run = await runScenario(liveScenario(c), { live: { provider: c.provider, sampling: c.environment.sampling, ...c.ceilings }, afterTurn: t => {
                completed.push(t.ordinal);
                expect(t.acceptanceDiagnostics).toMatchObject({ archiveDelta: 1, callDelta: 1,
                    storyByDraftId: { role: 'assistant', pendingCommit: false, nonempty: true } });
                const audit = t.acceptanceDiagnostics as { draftId: string; storyByDraftId: { id: string; sceneId: string }; appendedSceneIds: string[] };
                expect(audit.storyByDraftId.id).toBe(audit.draftId);
                expect(audit.appendedSceneIds).toEqual([audit.storyByDraftId.sceneId]);
            } });
            expect(completed).toEqual([1, 2, 3, 4, 5, 6, 7]);
            expect(requests).toHaveLength(7); expect(run.calls).toHaveLength(7);
            for (const call of run.calls) {
                expect(call).toMatchObject({ purpose: 'story-generation', status: 'success' });
                expect(call.attempts).toHaveLength(1);
                expect(call.attempts[0]).toMatchObject({ status: 200, error: null, usage: { prompt_tokens: 123, completion_tokens: 17 } });
                const times = measurements(run.timings.get(call)![0]);
                expect(times.ttftMs).not.toBeNull(); expect(times.reasoningFirstTokenMs).not.toBeNull();
                if (format === 'ollama') expect(call.attempts[0]).toMatchObject({ ollama: { thinking: 'Private reasoning.', metadata: { eval_count: 17, total_duration: 9000 } } });
            }
            for (const turn of run.result.turns) {
                const accepted = (turn.messages as { committed: { role: string; content: string; sceneId?: string; pendingCommit?: boolean }[] }).committed.at(-1)!;
                expect(accepted.content).toBe('Rain ☃ falls.'); expect(accepted.sceneId).toBeTruthy(); expect(accepted.pendingCommit).toBeUndefined();
                expect(accepted.content).not.toContain('Private reasoning.');
            }
        } finally { globalThis.fetch = original; }
    });
    it.each(['openai', 'ollama'] as const)('fails before commit for HTTP-200 reasoning-only output in %s mode', async format => {
        const c = config(format), original = globalThis.fetch, append = vi.spyOn(api.archive, 'append');
        const completed = vi.fn(); let ttft: number | null | undefined, reasoning: number | null | undefined;
        globalThis.fetch = async () => format === 'ollama' ? nativeResponse('') : streamResponse({ deltas: ['  '], reasoning: ['Private reasoning.'] });
        try {
            await expect(runScenario(liveScenario(c), {
                live: { provider: c.provider, sampling: c.environment.sampling, ...c.ceilings }, afterTurn: completed,
                captureCalls: (calls, timings) => { const times = measurements(timings.get(calls[0])![0]); ttft = times.ttftMs; reasoning = times.reasoningFirstTokenMs; },
            })).rejects.toThrow('empty visible Story content');
            expect(append).not.toHaveBeenCalled(); expect(completed).not.toHaveBeenCalled();
            expect(ttft).toBeNull(); expect(reasoning).not.toBeNull();
        } finally { globalThis.fetch = original; }
    });
    it('fails for incomplete native streams rather than silently committing content', async () => {
        const c = config('ollama'), original = globalThis.fetch, append = vi.spyOn(api.archive, 'append');
        globalThis.fetch = async () => nativeResponse('Rain.', '', false);
        try {
            await expect(runScenario(liveScenario(c), { live: { provider: c.provider, sampling: c.environment.sampling, ...c.ceilings } })).rejects.toThrow();
            expect(append).not.toHaveBeenCalled();
        } finally { globalThis.fetch = original; }
    });
    it('surfaces an undeclared native provider target', async () => {
        const c = config('ollama'), original = globalThis.fetch, providerFetch = vi.fn(async () => nativeResponse());
        globalThis.fetch = providerFetch;
        const forward = proxy.llmFetch;
        vi.spyOn(proxy, 'llmFetch').mockImplementation((_target, init) => forward('http://127.0.0.1:1234/undeclared', init));
        try {
            const f = liveScenario(c);
            await expect(runScenario(f, { live: { provider: c.provider, sampling: c.environment.sampling, ...c.ceilings } })).rejects.toThrow();
            expect(providerFetch).not.toHaveBeenCalled();
        } finally { globalThis.fetch = original; }
    });
    it.each([true, false])('privately captures native HTTP failure without consuming the response or retrying (JSON=%s)', async json => {
        const c = config('ollama'), original = globalThis.fetch, append = vi.spyOn(api.archive, 'append');
        const body = json ? JSON.stringify({ error: 'input length exceeds context window', input_tokens: 8300, context_length: 8192 }) : 'native failure';
        const response = new Response(body, { status: 400 });
        const providerFetch = vi.fn(async () => response);
        globalThis.fetch = providerFetch;
        let attempts: unknown[] = [];
        try {
            const fixture = liveScenario(c); fixture.turns = fixture.turns.slice(0, 1);
            await expect(runScenario(fixture, {
                live: { provider: { ...c.provider, contextWindow: 8192 }, sampling: c.environment.sampling, ...c.ceilings },
                captureCalls: calls => { attempts = calls.flatMap(call => call.attempts); },
            })).rejects.toThrow('Turn did not generate a successful response');
            expect(providerFetch).toHaveBeenCalledTimes(1); expect(append).not.toHaveBeenCalled();
            expect(attempts).toHaveLength(1);
            expect(attempts[0]).toMatchObject({ status: 400, ollamaFailure: { status: 400, turn: 1,
                requestContextWindow: 8192, outputLimit: 512, think: false, body,
                error: json ? 'input length exceeds context window' : null, bodyReadError: null,
                metadata: json ? { input_tokens: 8300, context_length: 8192 } : {},
            } });
        } finally { globalThis.fetch = original; }
    });
});


describe('Package C observed local configuration', () => {
    it('accepts measured percentage offload without inventing layer counts', () => {
        const c = config('ollama');
        c.environment.offload = { mode: 'mixed-gpu-cpu', layers: null, gpuPercent: 98, cpuPercent: 2 };
        expect(() => validateSmokeConfig(c)).not.toThrow();
        c.environment.offload.cpuPercent = 3;
        expect(() => validateSmokeConfig(c)).toThrow('Explicit offload identity required');
    });
    it('puts the confirmed context on the native wire without changing output or sampling', () => {
        const c = config('ollama');
        const body = ollamaLiveBody({ messages: [] }, { ...c.provider, contextWindow: 8192 }, c.environment.sampling);
        expect(body.options).toEqual({ temperature: 0.7, num_predict: 512, num_ctx: 8192 });
        expect(() => ollamaLiveBody({ messages: [] }, { ...c.provider, contextWindow: -1 }, c.environment.sampling)).toThrow('Invalid native Ollama context window');
    });
});


it('populated live fixture covers local movement and a relationship callback identically for both profiles', () => {
    const c = config('ollama'); c.runKind = 'populated';
    const current = liveScenario({ ...c, inferenceProfileId: 'current' });
    const constrained = liveScenario({ ...c, inferenceProfileId: 'constrained-local-v1' });
    expect(current.turns).toEqual(constrained.turns);
    expect(current.turns[2].input).toContain('guardhouse doorway');
    expect(current.turns[3].input).toContain('apology');
    expect(current.fixture().context.currentFeature).toBe('east bridge gate');
    expect(current.fixture().locationLedger?.[0].features).toContain('guardhouse doorway');
});

it('explicit current-profile live comparison persists real helper-produced relationship records in synthetic storage', async () => {
    const observer = observe(), c = config('ollama');
    const io = syntheticIO(observer, { fetch: vi.fn(), endpoint: 'http://127.0.0.1:1234/api/chat', perCallMs: 2000, provider: c.provider, sampling: c.environment.sampling, now: performance.now.bind(performance), allowAuxiliary: true });
    try {
        const route = `/api/campaigns/${FIXTURE_CAMPAIGN_ID}/relationship-memory`;
        const records = { npcToMc: [{ sceneId: '001', outcome: 'A promise was acknowledged' }], npcToNpc: [] };
        const response = await fetch(route, { method: 'PUT', body: JSON.stringify(records) });
        expect(response.ok).toBe(true);
        expect(await (await fetch(route + '/npc-to-mc')).json()).toEqual(records.npcToMc);
        expect(io.writes).toEqual([expect.objectContaining({ route: 'relationship-memory', value: records })]);
        expect(io.violations).toEqual([]);
        expect(observer.calls).toEqual([]);
    } finally { io.restore(); observer.restore(); }
});


it('live quiescence waits for retained background work beyond the old half-second replay window', async () => {
    const original = globalThis.fetch, c = config('ollama');
    globalThis.fetch = async () => nativeResponse();
    let settled = false;
    postTurnTracks.register({ id: 'track.live-quiescence-probe', name: 'Live quiescence probe', description: 'Test-only deterministic background work', defaultEnabled: true,
        shouldRun: () => true, run: async () => { void backgroundQueue.push('live-quiescence-probe', async () => {
            await new Promise(resolve => setTimeout(resolve, 700)); settled = true;
        }); },
    });
    try {
        const fixture = liveScenario(c); fixture.turns = fixture.turns.slice(0, 1);
        const run = await runScenario(fixture, { live: { provider: c.provider, sampling: c.environment.sampling, ...c.ceilings } });
        expect(settled).toBe(true);
        expect(run.result.turns[0].diagnostics).toMatchObject({ idle: true });
    } finally { globalThis.fetch = original; postTurnTracks.unregister('track.live-quiescence-probe'); }
});

it('accepts the newly archived Story when deterministic movement validation appends a system message', async () => {
    const original = globalThis.fetch, c = config('ollama');
    globalThis.fetch = async () => nativeResponse('The gate remains in sight. <!-- MOVEMENT {"action":"teleport-anywhere"} -->', '');
    try {
        const fixture = liveScenario(c); fixture.turns = fixture.turns.slice(0, 1);
        const run = await runScenario(fixture, { inferenceProfileId: 'constrained-local-v1', live: { provider: c.provider, sampling: c.environment.sampling, ...c.ceilings } });
        const turn = run.result.turns[0];
        const committed = (turn.messages as { committed: { id: string; role: string; sceneId?: string; pendingCommit?: boolean }[] }).committed;
        expect(committed.at(-1)?.role).toBe('system');
        const story = committed.find(m => m.role === 'assistant' && m.sceneId === '001');
        expect(story).toBeDefined(); expect(story?.pendingCommit).toBeUndefined();
        expect(turn.state).toMatchObject({ archiveBefore: 1, archiveAtDraft: 1, archiveAfterCommit: 2, appendSceneId: '001' });
        expect(run.calls).toHaveLength(1); expect(run.calls[0].attempts).toHaveLength(1);
    } finally { globalThis.fetch = original; }
});
