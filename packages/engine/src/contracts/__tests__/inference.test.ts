import { describe, expect, it } from 'vitest';
import { INFERENCE_PURPOSES, INFERENCE_ROLES, INFERENCE_TRIGGERS, isInferenceClassification } from '../inference';

const valid = { purpose: 'story', operation: 'story-generation', trigger: 'explicit-user-action', execution: 'foreground', blocking: 'visible-story', role: 'story', requirement: 'required-story-completion' };

describe('descriptive inference classification', () => {
    it.each(INFERENCE_PURPOSES)('accepts implemented purpose %s', purpose => {
        expect(isInferenceClassification({ ...valid, purpose })).toBe(true);
    });
    it.each(INFERENCE_ROLES)('accepts existing role or explicit boundary %s', role => {
        expect(isInferenceClassification({ ...valid, role })).toBe(true);
    });
    it.each(INFERENCE_TRIGGERS)('accepts trigger %s', trigger => {
        expect(isInferenceClassification({ ...valid, trigger })).toBe(true);
    });
    it.each(['purpose', 'operation', 'trigger', 'execution', 'blocking', 'role', 'requirement'])('rejects unknown %s', field => {
        expect(isInferenceClassification({ ...valid, [field]: 'unknown!' })).toBe(false);
        const missing: Record<string, unknown> = { ...valid }; delete missing[field];
        expect(isInferenceClassification(missing)).toBe(false);
    });
    it.each([null, [], 'story', {}, { ...valid, extra: true }])('rejects malformed/extended classification %j', value => {
        expect(isInferenceClassification(value)).toBe(false);
    });
    it('keeps purpose, selected role, requirement, execution and wait boundary independent', () => {
        expect(isInferenceClassification({ ...valid, purpose: 'extraction-analysis', role: 'story', requirement: 'optional', execution: 'background', blocking: 'post-turn-completion' })).toBe(true);
        expect(isInferenceClassification({ ...valid, purpose: 'planning', requirement: 'optional' })).toBe(true);
    });
});
