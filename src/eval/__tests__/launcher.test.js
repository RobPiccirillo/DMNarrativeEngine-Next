import { describe, expect, it } from 'vitest';
import { exitFor, knownTargetViolations, summarizeReports, validateKnownViolationProvenance } from '../../../scripts/run-eval.mjs';

describe('eval command exit policy', () => {
    it('succeeds for behavioral review with a valid baseline', () => {
        const status = summarizeReports([{ incomplete: false, normative: [{ status: 'PASS' }], behavioral: { status: 'REVIEW_REQUIRED' } }]);
        expect(status).toBe('REVIEW_REQUIRED');
        expect(exitFor('compare', status, true, 'VALID')).toBe(0);
    });
    it('fails for normative violations and incomplete runs', () => {
        for (const report of [
            { incomplete: false, normative: [{ status: 'FAIL' }], behavioral: { status: 'MATCH' } },
            { incomplete: true, normative: [], behavioral: { status: 'MATCH' } },
        ]) expect(exitFor('record', summarizeReports([report]), true, 'UNPINNED')).toBe(1);
    });
    it('fails compare without a reviewed baseline and fails unstable runs', () => {
        expect(exitFor('compare', 'MATCH', true, 'UNPINNED')).toBe(1);
        expect(exitFor('verify-determinism', 'MATCH', false, 'VALID')).toBe(1);
    });
    it('permits matched known target violations without hiding their status', () => {
        const status = summarizeReports([{ incomplete: false, normative: [{ status: 'KNOWN_TARGET_VIOLATION' }], behavioral: { status: 'MATCH' } }]);
        expect(status).toBe('KNOWN_TARGET_VIOLATION');
        expect(exitFor('record', status, true, 'UNPINNED')).toBe(0);
    });
    it('invalidates baseline comparison for edited disposition metadata/provenance', () => {
        const baseline = { knownTargetViolations: structuredClone(knownTargetViolations) };
        expect(() => validateKnownViolationProvenance(baseline)).not.toThrow();
        baseline.knownTargetViolations.violations[0].rationale = 'Changed without disposition review';
        expect(() => validateKnownViolationProvenance(baseline)).toThrow('provenance changed');
        expect(() => validateKnownViolationProvenance(undefined, baseline.knownTargetViolations)).toThrow('changed without review');
    });
    it('does not let behavioral acceptance clear a normative failure', () => {
        expect(summarizeReports([{ incomplete: false, normative: [{ status: 'FAIL' }], behavioral: { status: 'MATCH' } }])).toBe('FAIL');
    });
});
