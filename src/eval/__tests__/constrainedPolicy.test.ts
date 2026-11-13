import { expect, it } from 'vitest';
import { inspectBaselineLocalPolicy } from './support/baselineLocalPolicy';
import { classifyInference } from './support/inferenceClassification';
import type { ModelCall } from './support/types';

const story = (): ModelCall => ({ ordinal: 1, purpose: 'story-generation', endpoint: 'story-local', turn: 1, phase: 'generating', status: 'success',
    inference: { logicalInvocation: 1, classification: classifyInference('story-generation')! },
    attempts: [{ ordinal: 1, stream: true, status: 200, error: null, request: null, usage: null }] });
const inspect = (calls: ModelCall[]) => inspectBaselineLocalPolicy(calls, [1], 'constrained-local-v1');

it('constrained normative checks reject missing/extra Story, auxiliary calls, retries, failed or unassociated execution', () => {
    expect(inspect([story()]).violations).toEqual([]);
    expect(inspect([]).violations.map(v => v.code)).toContain('required-story-count');
    const extra = { ...story(), ordinal: 2, inference: { ...story().inference!, logicalInvocation: 2 } };
    expect(inspect([story(), extra]).violations.map(v => v.code)).toContain('required-story-count');
    const auxiliary = { ...extra, purpose: 'director-brief', inference: { logicalInvocation: 2, classification: classifyInference('director-brief')! } };
    expect(inspect([story(), auxiliary]).violations.map(v => v.code)).toContain('automatic-model-work');
    const retried = story(); retried.attempts.push({ ...retried.attempts[0], ordinal: 2 });
    expect(inspect([retried]).violations.map(v => v.code)).toContain('story-attempt-count');
    const failed = story(); failed.attempts[0].status = 503;
    expect(inspect([failed]).violations.map(v => v.code)).toContain('story-attempt-failed');
    const unassociated = story(); unassociated.inference!.logicalInvocation = 99;
    expect(inspect([unassociated]).violations.map(v => v.code)).toContain('unclassified-call');
    const unknown = story(); delete unknown.inference;
    expect(inspect([unknown]).violations.map(v => v.code)).toContain('unclassified-call');
    expect(inspectBaselineLocalPolicy([retried], [1]).enforcement).toBe('diagnostic-only');
});
