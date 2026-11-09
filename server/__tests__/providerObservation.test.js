import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { setProviderObserver, withProviderObservation, beginProviderAttempt, observeProviderExecution } from '../lib/providerObservation.js';
import { callLLMWithRetry, extractWitnessesLLM } from '../services/llmProxy.js';
import { createLLMProxyRouter } from '../routes/llmProxy.js';
const classification = { purpose: 'extraction-analysis', operation: 'server-witness-extract', trigger: 'automatic-post-turn', execution: 'background', blocking: 'nothing-user-visible', role: 'utility', requirement: 'optional' };
const correlation = { logicalInvocation: 'turn-1.call-1', classification };
const restorers = [];
afterEach(() => { restorers.splice(0).reverse().forEach(r => r()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function capture(resolve) { const records = []; restorers.push(setProviderObserver(record => records.push(record), resolve)); return records; }
describe('opt-in server provider observations', () => {
    it('classifies HTTP-success malformed JSON as invalid-response before retrying unchanged', async () => {
        const records = capture();
        const fetch = vi.fn().mockResolvedValueOnce(new Response('{broken', { status: 200 }))
            .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }));
        vi.stubGlobal('fetch', fetch);
        const timers = vi.spyOn(globalThis, 'setTimeout');
        const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await withProviderObservation(correlation, () => callLLMWithRetry('same prompt', { endpoint: 'http://host', model: 'model' }, { maxAttempts: 2, timeoutMs: 1000 }));
        expect(result).toBe('{"ok":true}');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
        expect(records.map(r => [r.attemptOrdinal, r.relation, r.outcome, r.reason])).toEqual([
            [1, 'initial', 'invalid-response', undefined], [2, 'retry', 'success', 'invalid-response'],
        ]);
        expect(records[0].status).toBe(200);
        expect(timers.mock.calls.filter(c => c[1] === 250)).toHaveLength(1);
        expect(timers.mock.calls.filter(c => c[1] === 1000)).toHaveLength(2);
        expect(log.mock.calls[0][0]).toBe('[LLM] attempt 1 failed:');
    });
    it('retains terminal malformed-JSON null return without another attempt/backoff', async () => {
        const records = capture();
        const fetch = vi.fn().mockResolvedValue(new Response('{broken', { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const timers = vi.spyOn(globalThis, 'setTimeout');
        expect(await withProviderObservation(correlation, () => callLLMWithRetry('same', { endpoint: 'http://host', model: 'model' }, { maxAttempts: 1, timeoutMs: 1000 }))).toBeNull();
        expect(fetch).toHaveBeenCalledOnce();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ outcome: 'invalid-response', status: 200 });
        expect(timers.mock.calls.filter(c => c[1] === 250)).toHaveLength(0);
    });
    it.each([
        ['network', 'error', 'transport-error'], ['abort', 'cancelled', 'transport-error'],
        ['regex', 'invalid-response', 'invalid-response'], ['null-shape', 'invalid-response', 'invalid-response'],
        ['content-shape', 'invalid-response', 'invalid-response'], ['non-2xx', 'http-error', 'http-error'],
    ])('preserves retry/backoff and distinguishes %s failures', async (kind, outcome, reason) => {
        const records = capture();
        const fetch = vi.fn();
        if (kind === 'network') fetch.mockRejectedValueOnce(new TypeError('network failure'));
        else if (kind === 'abort') fetch.mockRejectedValueOnce(Object.assign(Error('aborted'), { name: 'AbortError' }));
        else if (kind === 'regex') fetch.mockResolvedValueOnce(Response.json({ choices: [] }));
        else if (kind === 'null-shape') fetch.mockResolvedValueOnce(Response.json(null));
        else if (kind === 'content-shape') fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 42 } }] }));
        else fetch.mockResolvedValueOnce(new Response('{broken', { status: 502 }));
        fetch.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }));
        vi.stubGlobal('fetch', fetch);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const timers = vi.spyOn(globalThis, 'setTimeout');
        expect(await withProviderObservation(correlation, () => callLLMWithRetry('same', { endpoint: 'http://host', model: 'model' }, { maxAttempts: 2, timeoutMs: 1000 }))).toBe('{"ok":true}');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(records[0].outcome).toBe(outcome);
        expect(records[1]).toMatchObject({ relation: 'retry', reason, outcome: 'success' });
        expect(timers.mock.calls.filter(c => c[1] === 250)).toHaveLength(1);
        expect(timers.mock.calls.filter(c => c[1] === 1000)).toHaveLength(2);
    });
    it.each(['//user:secret@host/v1', 'data:text/plain,private-campaign-text', '{"private":"campaign-text"}'])('does not retain unsafe model metadata %#', model => {
        const records = capture();
        withProviderObservation(correlation, () => {
            const attempt = beginProviderAttempt({ backend: 'custom', configuredModel: model, actualModel: model });
            attempt.finish('success', { actualModel: model });
            beginProviderAttempt({ backend: 'custom', configuredModel: model + '-different' }).finish('success');
            beginProviderAttempt({ backend: 'custom', configuredModel: model + '-different' }).finish('success');
        });
        expect(records[0]).not.toHaveProperty('configuredModel');
        expect(records[0]).not.toHaveProperty('actualModel');
        expect(JSON.stringify(records)).not.toMatch(/secret|private|campaign-text/);
        expect(records.map(record => record.relation)).toEqual(['initial', 'fallback', 'retry']);
        expect(records.every(record => !('modelIdentity' in record))).toBe(true);
    });
    it('preserves HTTP requests, retry count/order and result under one logical classification', async () => {
        const records = capture();
        const fetch = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 503 }))
            .mockResolvedValueOnce(Response.json({ model: 'actual/model', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 4 } }));
        vi.stubGlobal('fetch', fetch);
        const config = { endpoint: 'http://localhost:9999', model: 'configured/model', apiKey: 'sk-private' };
        const result = await withProviderObservation(correlation, () => callLLMWithRetry('private prompt', config, { maxAttempts: 2, timeoutMs: 1000 }));
        expect(result).toBe('{"ok":true}');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls.map(c => c[1].body)).toEqual([JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'private prompt' }], temperature: 0.1, stream: false }), fetch.mock.calls[0][1].body]);
        expect(fetch.mock.calls[0][0]).toBe('http://localhost:9999/v1/chat/completions');
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-private');
        expect(records.map(r => [r.logicalInvocation, r.attemptOrdinal, r.relation, r.outcome])).toEqual([
            ['turn-1.call-1', 1, 'initial', 'http-error'], ['turn-1.call-1', 2, 'retry', 'success'],
        ]);
        expect(records[1]).toMatchObject({ actualModel: 'actual/model', configuredModel: 'configured/model', reason: 'rate-limit', usage: { prompt_tokens: 4 }, executionClass: 'unknown' });
        expect(JSON.stringify(records)).not.toMatch(/private|localhost|apiKey|Authorization/);
    });
    it('resolves a recognizable raw server operation once through the supplied logical ledger', async () => {
        const resolve = vi.fn(() => correlation);
        const records = capture(resolve);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"witnesses":[],"mentioned":[]}' } }] })));
        expect(await extractWitnessesLLM(['Name'], 'private', 'private', { endpoint: 'http://host', model: 'm' })).toEqual({ witnesses: [], mentioned: [] });
        expect(resolve).toHaveBeenCalledExactlyOnceWith('server-witness-extract');
        expect(records).toHaveLength(1);
    });
    it('represents fallback model/backend changes as attempts, without inventing another logical call', async () => {
        const records = capture();
        const value = { ok: true };
        await withProviderObservation(correlation, async () => {
            const a = beginProviderAttempt({ backend: 'ollama', configuredModel: 'local-model' });
            a.finish('error');
            expect(await observeProviderExecution({ backend: 'future-api', configuredModel: 'other-model' }, async () => value)).toBe(value);
        });
        expect(records.map(r => r.relation)).toEqual(['initial', 'fallback']);
        expect(records[1]).toMatchObject({ logicalInvocation: correlation.logicalInvocation, attemptOrdinal: 2, reason: 'backend-or-model-changed' });
    });
    it.each(['AbortError', 'Error'])('preserves native failure identity and cancellation %s', async name => {
        const records = capture();
        const error = Object.assign(Error('private error'), { name });
        await expect(withProviderObservation(correlation, () => observeProviderExecution({ backend: 'transformers', executionClass: 'local', configuredModel: 'org/model' }, async () => { throw error; }))).rejects.toBe(error);
        expect(records[0].outcome).toBe(name === 'AbortError' ? 'cancelled' : 'error');
        expect(records[0].executionClass).toBe('local');
        expect(JSON.stringify(records)).not.toContain('private');
    });
    it('does not retain anything outside a supplied scope; failed observers cannot affect execution', async () => {
        const records = capture();
        expect(await observeProviderExecution({ backend: 'custom' }, async () => 7)).toBe(7);
        expect(records).toEqual([]);
        restorers.push(setProviderObserver(() => { throw Error('observer failed'); }));
        expect(await withProviderObservation(correlation, () => observeProviderExecution({ backend: 'custom' }, async () => 9))).toBe(9);
        restorers.push(setProviderObserver(async () => { throw Error('async observer failed'); }));
        expect(await withProviderObservation(correlation, () => observeProviderExecution({ backend: 'custom' }, async () => 11))).toBe(11);
    });
    it('keeps concurrent logical contexts and ordinals independent', async () => {
        const records = capture();
        await Promise.all(['a', 'b'].map(logicalInvocation => withProviderObservation({ ...correlation, logicalInvocation }, async () => {
            await observeProviderExecution({ backend: 'custom' }, async () => 1);
            await observeProviderExecution({ backend: 'custom' }, async () => 2);
        })));
        for (const id of ['a', 'b']) expect(records.filter(r => r.logicalInvocation === id).map(r => r.attemptOrdinal)).toEqual([1, 2]);
    });
    it.each([false, true])('preserves proxy stream/body/headers with observation (stream %s)', async stream => {
        const records = capture();
        const text = stream ? 'data: {"choices":[{"delta":{"reasoning_content":"thinking","content":"visible"}}]}\n\ndata: [DONE]\n\n' : '{"model":"actual","choices":[]}';
        const upstream = vi.fn(async () => new Response(text, { headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' } }));
        const app = express(); app.use(express.json()); app.use(createLLMProxyRouter({ fetchImpl: upstream }));
        const body = JSON.stringify({ model: 'model-name', stream, messages: [{ role: 'user', content: 'private prompt' }] });
        const res = await supertest(app).post('/api/llm/proxy').send({ target: 'http://localhost:11434/api/chat?key=secret', method: 'POST', headers: { Authorization: 'Bearer secret' }, body, observation: correlation });
        expect(res.status).toBe(200);
        expect(stream ? res.text : JSON.stringify(res.body)).toBe(text);
        expect(upstream.mock.calls[0][1]).toMatchObject({ body, headers: { Authorization: 'Bearer secret' } });
        expect(upstream.mock.calls[0][1]).not.toHaveProperty('observation');
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ logicalInvocation: correlation.logicalInvocation, attemptOrdinal: 1, stream, backend: 'ollama', outcome: 'success', executionClass: 'unknown' });
        expect(records[0]).not.toHaveProperty('actualModel'); // relay does not parse the stream/body
        expect(JSON.stringify(records)).not.toMatch(/thinking|visible|secret|prompt|localhost/);
    });
});
