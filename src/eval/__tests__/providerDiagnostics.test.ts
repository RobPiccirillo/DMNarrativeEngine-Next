import { afterEach, describe, expect, it, vi } from 'vitest';
import { observe } from './support/observe';
import { syntheticIO } from './support/replayIO';
import { phase0CallProjection } from './support/types';
import { fixtureProvider } from '../../services/turn/__tests__/baseAppGate/fixture';
import { llmCall } from '../../utils/llmCall';
import { sendMessage } from '../../services/llm/llmService';
import { llmFetch } from '../../services/llm/llmFetch';
import { setProviderContextResolver } from '../../services/llm/providerObservation';
afterEach(() => { vi.restoreAllMocks(); });
describe('provider observations on the canonical logical ledger', () => {
    it('keeps retries as child attempts, preserves logical ordinals and schema zero', async () => {
        let clock = 0;
        const o = observe(() => ++clock), io = syntheticIO(o);
        io.begin({ deltas: ['visible'], attemptStatuses: [503, 200] });
        try {
            await llmCall(fixtureProvider(), 'private', { trackingLabel: 'director-brief' });
            expect(o.calls).toHaveLength(1);
            const c = o.calls[0];
            expect(c.inference?.logicalInvocation).toBe(1);
            expect(c.attempts.map(a => a.diagnostic)).toMatchObject([
                { logicalInvocation: '1', attemptOrdinal: 1, outcome: 'http-error', relation: 'initial', requestedRole: 'auxiliary' },
                { logicalInvocation: '1', attemptOrdinal: 2, outcome: 'success', relation: 'retry', requestedRole: 'auxiliary' },
            ]);
            expect(c.attempts[1].diagnostic?.queueWaitMs).toBeGreaterThanOrEqual(0);
            expect(c.attempts[1].diagnostic).not.toHaveProperty('actualModel');
            expect(JSON.stringify(phase0CallProjection(c))).not.toContain('diagnostic');
            expect(JSON.stringify(c.attempts.map(a => a.diagnostic))).not.toContain('private');
            expect(o.violations).toEqual([]);
        } finally { io.restore(); o.restore(); }
    });
    it('separates reasoning and visible first-token measurements without altering streamed content', async () => {
        let clock = 0;
        const o = observe(() => ++clock), io = syntheticIO(o);
        io.begin({ deltas: ['Visible ', 'story.'], reasoning: ['private reasoning'], usage: { prompt_tokens: 3, completion_tokens: 4 } });
        const chunks: string[] = [], reasons: string[] = [];
        try {
            await sendMessage(fixtureProvider(), [{ role: 'user', content: 'private prompt' }], t => chunks.push(t), () => {}, () => {}, undefined, undefined, undefined, undefined, 'story-generation', t => reasons.push(t));
            expect(chunks).toEqual(['Visible ', 'Visible story.']); // existing callbacks are cumulative
            expect(reasons.join('')).toContain('private reasoning');
            const d = o.calls[0].attempts[0].diagnostic!;
            expect(d).toMatchObject({ logicalInvocation: '1', stream: true, outcome: 'success', usage: { prompt_tokens: 3, completion_tokens: 4 } });
            expect(d.firstReasoningMs).toBeGreaterThanOrEqual(0);
            expect(d.firstVisibleMs).toBeGreaterThanOrEqual(0);
            expect(JSON.stringify(d)).not.toMatch(/private|Visible story/);
        } finally { io.restore(); o.restore(); }
    });
    it('keeps diagnostic metadata out of provider bodies and omits it when the resolver fails', async () => {
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
        const restore = setProviderContextResolver(() => { throw Error('observer failed'); });
        try {
            const body = '{"model":"model","messages":[]}';
            await llmFetch('http://provider', { method: 'POST', body, headers: { Authorization: 'secret' } });
            const envelope = JSON.parse(String(fetch.mock.calls[0][1]?.body));
            expect(envelope.body).toBe(body);
            expect(envelope.headers).toEqual({ Authorization: 'secret' });
            expect(envelope).not.toHaveProperty('observation');
        } finally { restore(); }
    });
});
