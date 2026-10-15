import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as director from '../../services/turn/directorBrief';
import * as stages from '../../services/turn/turnStages';
import * as story from '../../services/llm/llmService';
import * as utility from '../../utils/llmCall';
import * as proxy from '../../services/llm/llmFetch';
import { fixtureProvider } from '../../services/turn/__tests__/baseAppGate/fixture';
import { getChatUrl } from '../../utils/llmApiHelper';
import { api } from '../../services/llm/apiClient';
import { scenario } from './fixtures/scenarios';
import { assertScenario } from './assertions';
import { compare } from './support/artifacts';
import { observe } from './support/observe';
import { syntheticIO } from './support/replayIO';
import { runScenario } from './support/runScenario';
import type { EvalResult } from './support/types';

const baseline = () => JSON.parse(readFileSync('eval/baselines/v0/call-ledger-pro.json', 'utf8')) as EvalResult;
afterEach(() => vi.restoreAllMocks());

describe('behavioral call shape versus required Story completion', () => {
    it('keeps current Pro Director then Story fully accounted and MATCHING the pinned baseline', async () => {
        const f = scenario('call-ledger-pro'), run = await runScenario(f);
        expect(run.calls.map(c => c.purpose)).toEqual(['director-brief', 'story-generation', 'director-brief', 'story-generation']);
        expect(run.calls.every(c => c.attempts.length === 1 && c.attempts[0].status === 200)).toBe(true);
        expect(assertScenario(run.result, f).every(c => c.status === 'PASS')).toBe(true);
        expect(compare(baseline(), run.result).status).toBe('MATCH');
    });

    it('lets Story-only Pro execute and reach REVIEW_REQUIRED with Director absent', async () => {
        // Simulate intentional removal at the Director boundary; keep Pro settings
        // and the real Story request, parser, pending draft and commit unchanged.
        vi.spyOn(director, 'runDirectorBrief').mockResolvedValue(null);
        const f = scenario('call-ledger-pro'), run = await runScenario(f);
        expect(f.fixture().settings.aiTier).toBe('pro');
        expect(run.calls.map(c => c.purpose)).toEqual(['story-generation', 'story-generation']);
        expect(run.calls.every(c => c.attempts.length === 1 && c.attempts[0].status === 200)).toBe(true);
        expect(assertScenario(run.result, f).every(c => c.status === 'PASS')).toBe(true);
        for (const [i, turn] of run.result.turns.entries()) {
            expect(turn.diagnostics).toMatchObject({ violations: [], idle: true });
            expect(turn.messages).toMatchObject({ committed: expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: f.turns[i].response.deltas.join(''), sceneId: expect.any(String) })]) });
        }
        const comparison = compare(baseline(), run.result);
        expect(comparison.status).toBe('REVIEW_REQUIRED');
        expect(comparison.differences.some(d => d.category === 'calls-and-tokens' && d.path.endsWith('.purpose') && d.old === 'director-brief' && d.new === 'story-generation')).toBe(true);
    });

    it('fails Director-only execution before commit instead of accepting a behavioral diff', async () => {
        vi.spyOn(stages, 'runGenerationStage').mockResolvedValue(undefined);
        const append = vi.spyOn(api.archive, 'append');
        let purposes: string[] = [];
        await expect(runScenario(scenario('call-ledger-pro'), { captureCalls: calls => { purposes = calls.map(c => c.purpose); } })).rejects.toThrow('missing-story-generation');
        expect(purposes).toEqual(['director-brief']);
        expect(append).not.toHaveBeenCalled();
    });

    it('fails empty visible offline Story output before commit', async () => {
        const f = scenario('call-ledger-pro'); f.turns[0].response = { deltas: ['  '], reasoning: ['Thinking.'] };
        const append = vi.spyOn(api.archive, 'append');
        await expect(runScenario(f)).rejects.toThrow('empty visible Story content');
        expect(append).not.toHaveBeenCalled();
    });

    it('lets recognized Story then Director ordering reach behavioral comparison', async () => {
        const runDirector = stages.runDirectorStage, generate = stages.runGenerationStage;
        const deferred: (() => Promise<void>)[] = [];
        vi.spyOn(stages, 'runDirectorStage').mockImplementation(async (...args) => { deferred.push(() => runDirector(...args)); });
        vi.spyOn(stages, 'runGenerationStage').mockImplementation(async (...args) => { await generate(...args); await deferred.shift()!(); });
        const f = scenario('call-ledger-pro'), run = await runScenario(f);
        expect(run.calls.map(c => c.purpose)).toEqual(['story-generation', 'director-brief', 'story-generation', 'director-brief']);
        expect(run.calls.every(c => c.attempts.length === 1)).toBe(true);
        expect(assertScenario(run.result, f).every(c => c.status === 'PASS')).toBe(true);
        const comparison = compare(baseline(), run.result);
        expect(comparison.status).toBe('REVIEW_REQUIRED');
        expect(comparison.differences.some(d => d.category === 'calls-and-tokens' && d.path.endsWith('.purpose'))).toBe(true);
    });
});

describe('provider accounting still fails closed', () => {
    it('records malformed provider bodies even if a caller swallows their error', async () => {
        const o = observe(), io = syntheticIO(o), forward = proxy.llmFetch;
        io.begin({ deltas: ['Rain.'] });
        vi.spyOn(proxy, 'llmFetch').mockImplementation(async (...args) => {
            await forward(args[0], { ...args[1], body: '{malformed' });
            return forward(...args);
        });
        try {
            await utility.llmCall(fixtureProvider(), 'Brief.', { trackingLabel: 'director-brief', timeoutMs: 1000 }).catch(() => {});
            expect(() => io.assertComplete()).toThrow('malformed-provider-request');
            expect(o.calls[0].attempts).toHaveLength(2);
            expect(o.calls[0].attempts[0]).toMatchObject({ ordinal: 1, status: 500, error: 'malformed-provider-request' });
        } finally { io.restore(); o.restore(); }
    });

    it.each(['unknown-purpose', 'undeclared-endpoint', 'unmodeled-retry'] as const)('rejects and records %s traffic', async mode => {
        const o = observe(), io = syntheticIO(o), provider = fixtureProvider();
        io.begin({ deltas: ['Rain.'] });
        try {
            if (mode === 'undeclared-endpoint') provider.endpoint = 'http://localhost:9999/undeclared';
            if (mode === 'unmodeled-retry') {
                const forward = proxy.llmFetch;
                vi.spyOn(proxy, 'llmFetch').mockImplementation(async (...args) => { await forward(...args); return forward(...args); });
            }
            await utility.llmCall(provider, 'Brief.', { trackingLabel: mode === 'unknown-purpose' ? 'unknown' : 'director-brief', timeoutMs: 1000 }).catch(() => {});
            expect(() => io.assertComplete()).toThrow(mode === 'undeclared-endpoint' ? 'undeclared-provider-request' : 'unexpected-provider-request');
            expect(o.calls.flatMap(c => c.attempts)).toHaveLength(mode === 'unmodeled-retry' ? 2 : 1);
            expect(o.calls.flatMap(c => c.attempts).at(-1)).toMatchObject({ status: 500, error: expect.any(String) });
        } finally { io.restore(); o.restore(); }
    });

    it('rejects provider traffic outside an observed scenario invocation', async () => {
        const o = observe(), io = syntheticIO(o);
        io.begin({ deltas: ['Rain.'] });
        try {
            const res = await proxy.llmFetch(getChatUrl(fixtureProvider()), { method: 'POST', body: JSON.stringify({ model: fixtureProvider().modelName, stream: true, messages: [{ role: 'user', content: 'Look.' }] }) });
            expect(res.status).toBe(500);
            expect(() => io.assertComplete()).toThrow('unclassified-provider-request');
            expect(o.violations).toContain('unobserved-provider-attempt');
        } finally { io.restore(); o.restore(); }
    });

    it('accounts for a recognized Director addition without requiring it or its order', async () => {
        const o = observe(), io = syntheticIO(o);
        io.begin({ deltas: ['Rain.'] });
        try {
            await story.sendMessage(fixtureProvider(), [{ role: 'user', content: 'Look.' }], () => {}, () => {}, e => { throw new Error(e); });
            expect(() => io.assertComplete()).not.toThrow();
            await utility.llmCall(fixtureProvider(), 'Brief.', { trackingLabel: 'director-brief', timeoutMs: 1000 });
            expect(() => io.assertComplete()).not.toThrow();
            expect(o.calls.map(c => c.purpose)).toEqual(['story-generation', 'director-brief']);
            expect(o.calls.every(c => c.attempts.length === 1)).toBe(true);
        } finally { io.restore(); o.restore(); }
    });

    it('lets additional accounted Director invocations become behavioral differences', async () => {
        const runDirector = stages.runDirectorStage;
        vi.spyOn(stages, 'runDirectorStage').mockImplementation(async (...args) => {
            await runDirector(...args);
            await utility.llmCall(args[1].provider!, 'Additional recognized brief.', { trackingLabel: 'director-brief', timeoutMs: 1000 });
        });
        const f = scenario('call-ledger-pro'), run = await runScenario(f);
        expect(run.calls.map(c => c.purpose)).toEqual(['director-brief', 'director-brief', 'story-generation', 'director-brief', 'director-brief', 'story-generation']);
        expect(run.calls.every(c => c.attempts.length === 1)).toBe(true);
        expect(assertScenario(run.result, f).every(c => c.status === 'PASS')).toBe(true);
        expect(compare(baseline(), run.result).status).toBe('REVIEW_REQUIRED');
    });
});
