import { describe, expect, it } from 'vitest';
import { isInferenceClassification } from '@narrative/engine';
import { scenarioIds, phase0CallProjection } from './support/types';
import type { ModelCall } from './support/types';
import { inspectBaselineLocalPolicy } from './support/baselineLocalPolicy';
import { classifyInference } from './support/inferenceClassification';
import { runScenario } from './support/runScenario';
import { scenario } from './fixtures/scenarios';

function call(operation: string, ordinal: number): ModelCall {
    const classification = classifyInference(operation);
    return { ordinal, purpose: operation, turn: 1, phase: 'generation', endpoint: 'story-local', status: 'success', attempts: [],
        ...(classification ? { inference: { logicalInvocation: ordinal, classification } } : {}) };
}
describe('Phase 1 diagnostic-only local acceptance report', () => {
    it('allows one required Story call and explicit optional manual work without changing the ledger', () => {
        const calls = [call('story-generation', 1), call('unlabelled-manual-utilities', 2)];
        const before = JSON.stringify(calls);
        expect(inspectBaselineLocalPolicy(calls, [1])).toMatchObject({ enforcement: 'diagnostic-only', logicalCalls: 2, violations: [] });
        expect(JSON.stringify(calls)).toBe(before);
    });
    it('reports existing automatic/story-blocking auxiliary work, including optional work', () => {
        const calls = [call('story-generation', 1), call('director-brief', 2)];
        const report = inspectBaselineLocalPolicy(calls, [1]);
        expect(report.violations).toEqual([
            { turn: 1, code: 'automatic-model-work', ordinals: [2] },
            { turn: 1, code: 'story-blocking-auxiliary', ordinals: [2] },
        ]);
        expect(calls).toHaveLength(2);
    });
    it.each([{ calls: [] }, { calls: [call('story-generation', 1), call('story-generation', 2)] }])('reports missing/extra required Story calls %#', ({ calls }) => {
        expect(inspectBaselineLocalPolicy(calls, [1]).violations.some(v => v.code === 'required-story-count')).toBe(true);
    });
    it('fails diagnostic classification closed and never invents a purpose', () => {
        const unknown = call('unknown', 2);
        expect(inspectBaselineLocalPolicy([call('story-generation', 1), unknown], [1]).violations)
            .toContainEqual({ turn: 1, code: 'unclassified-call', ordinals: [2] });
    });
    it('reports required non-Story work without suppressing it', () => {
        const auxiliary = call('director-brief', 2);
        auxiliary.inference!.classification = { ...auxiliary.inference!.classification, requirement: 'required-story-completion' };
        expect(inspectBaselineLocalPolicy([call('story-generation', 1), auxiliary], [1]).violations)
            .toContainEqual({ turn: 1, code: 'required-non-story', ordinals: [2] });
    });
    it('limits normal-turn checks to explicit caller scope', () => {
        expect(inspectBaselineLocalPolicy([call('director-brief', 1)], []).violations).toEqual([]);
    });
});
describe('Phase 1 cross-slice canonical ledger acceptance', () => {
    it.each(scenarioIds)('preserves classifications, attempt correlation and schema zero: %s', async id => {
        const observed = await runScenario(scenario(id));
        expect(observed.calls.length).toBeGreaterThan(0);
        for (const call of observed.calls) {
            expect(isInferenceClassification(call.inference?.classification)).toBe(true);
            expect(call.inference?.logicalInvocation).toBe(call.ordinal);
            for (const attempt of call.attempts) {
                expect(attempt.diagnostic).toMatchObject({ logicalInvocation: String(call.ordinal), attemptOrdinal: attempt.ordinal,
                    requestedRole: call.inference!.classification.role });
                expect(phase0CallProjection(call).attempts[attempt.ordinal - 1]).not.toHaveProperty('diagnostic');
            }
        }
        expect(observed.baselineLocalPolicy.logicalCalls).toBe(observed.calls.filter(call => call.turn > 0).length);
        expect(observed.baselineLocalPolicy.providerAttempts).toBe(observed.calls.filter(call => call.turn > 0).reduce((n, call) => n + call.attempts.length, 0));
        if (id === 'call-ledger-pro') expect(observed.baselineLocalPolicy.violations.some(v => v.code === 'automatic-model-work')).toBe(true);
        expect(JSON.stringify(observed.result)).not.toContain('baselineLocalPolicy');
    });
});
