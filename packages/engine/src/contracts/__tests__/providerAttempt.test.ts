import { describe, expect, it } from 'vitest';
import { parseProviderBackendId, safeModelIdentifier, providerAttemptProjection, isProviderCorrelation } from '../providerAttempt';
import type { ProviderAttemptDiagnostic } from '../providerAttempt';
const base: ProviderAttemptDiagnostic = { logicalInvocation: 'turn-1.call-2', attemptOrdinal: 1, requestedRole: 'story', backend: parseProviderBackendId('future.backend')!, executionClass: 'unknown', stream: true, relation: 'initial', outcome: 'success' };
describe('provider-neutral diagnostic vocabulary', () => {
    it.each(['ollama', 'openai-compatible', 'google', 'anthropic', 'future.provider-v2'])('accepts open backend %s', id => expect(parseProviderBackendId(id)).toBe(id));
    it.each(['', 'Bad', 'https://key@host', 'a b', null, 1])('rejects malformed backend %s', id => expect(parseProviderBackendId(id)).toBeUndefined());
    it.each(['vendor/model:Q4_K_M', 'model-2026-01', 'org/model@revision'])('preserves model identity %s', id => expect(safeModelIdentifier(id)).toBe(id));
    it.each([
        'gemma-4-26B-A4B-it-heretic-GGUF:Q4_K_M', 'qwen3.6:27b-q4_K_M',
        'vendor/model.v2_Q4-K.gguf', 'org/model@revision-2.1',
    ])('preserves realistic compact model name %s', id => {
        expect(safeModelIdentifier(id)).toBe(id);
        expect(providerAttemptProjection({ ...base, configuredModel: id, actualModel: id }))
            .toMatchObject({ configuredModel: id, actualModel: id });
    });
    it.each([
        '//user:secret@host/v1', '//host/v1', 'http://host/model', 'https://host/model',
        'data:text/plain,private-campaign-text', 'data:private-campaign-text',
        '{"private":"campaign-text"}', '["private-campaign-text"]',
        'model?key=secret', 'model#private', 'user:secret@host', 'Authorization:secret',
        'api_key:secret', 'sk-private', 'ghp_private', 'Bearer-secret',
        'Content-Type:text', 'Set-Cookie:secret', 'hf_private',
        'private campaign prose', 'model\nprivate', 'model\u0000private', 'model\u007fprivate',
        'example.com/v1/model', '127.0.0.1/model', 'localhost/model', 'm'.repeat(257),
    ])('omits unsafe model text from both diagnostic fields %#', id => {
        expect(safeModelIdentifier(id)).toBeUndefined();
        const safe = providerAttemptProjection({ ...base, configuredModel: id, actualModel: id });
        expect(safe).not.toHaveProperty('configuredModel');
        expect(safe).not.toHaveProperty('actualModel');
        expect(safe).toEqual(base);
    });
    it.each(['https://user:secret@host/model?key=secret', 'sk-secret', 'Bearer token', 'personal prose', '', '\nprivate'])('omits unsafe identity %s', id => expect(safeModelIdentifier(id)).toBeUndefined());
    it.each(['success', 'http-error', 'error', 'cancelled', 'invalid-response', 'running'] as const)('retains outcome %s without fabricated data', outcome => {
        expect(providerAttemptProjection({ ...base, outcome })).toEqual({ ...base, outcome });
    });
    it('projects only safe dimensions and measurable nonnegative timing/usage', () => {
        const input = { ...base, queueWaitMs: 4, providerMs: 9, firstReasoningMs: 2, firstVisibleMs: 6,
            firstChunkMs: NaN, status: 200, actualModel: 'vendor/actual', configuredModel: 'vendor/requested',
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, reasoning_tokens: -1, secret: 'key' },
            headers: { Authorization: 'secret' }, prompt: 'private', response: 'private', endpoint: 'http://key@host?key=secret' };
        const safe = providerAttemptProjection(input);
        expect(safe.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
        expect(safe).not.toHaveProperty('firstChunkMs');
        expect(safe).toMatchObject({ actualModel: 'vendor/actual', configuredModel: 'vendor/requested', firstReasoningMs: 2, firstVisibleMs: 6 });
        expect(JSON.stringify(safe)).not.toMatch(/secret|private|Authorization|endpoint/);
    });
    it('requires one existing logical classification/correlation, not a new taxonomy', () => {
        const c = { logicalInvocation: '1', classification: { purpose: 'story', operation: 'story-generation', trigger: 'explicit-user-action', execution: 'foreground', blocking: 'visible-story', role: 'story', requirement: 'required-story-completion' } };
        expect(isProviderCorrelation(c)).toBe(true);
        expect(isProviderCorrelation({ ...c, logicalInvocation: 'http://secret' })).toBe(false);
        expect(isProviderCorrelation({ ...c, attemptOrdinal: 0 })).toBe(false);
        expect(isProviderCorrelation({ ...c, classification: { ...c.classification, purpose: 'new-taxonomy' } })).toBe(false);
    });
});
