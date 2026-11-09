import { isInferenceClassification } from '@narrative/engine';
import type { ModelCall } from './types';

export type BaselineLocalViolationCode = 'unclassified-call' | 'required-story-count'
    | 'required-non-story' | 'automatic-model-work' | 'story-blocking-auxiliary';
export interface BaselineLocalPolicyReport {
    readonly profile: 'single-serialized-endpoint-baseline';
    readonly enforcement: 'diagnostic-only';
    readonly logicalCalls: number;
    readonly providerAttempts: number;
    readonly violations: readonly { readonly turn: number; readonly code: BaselineLocalViolationCode; readonly ordinals: readonly number[] }[];
}

/** Roadmap 003 Phase 1 diagnostic only, using 002 §21's baseline assumptions.
 * The caller explicitly identifies normal turns, excluding standalone manual tools/setup.
 * No proven isolated endpoint/cancellation is assumed: automatic model work is reported, including
 * optional background work. Later Phase 1L owns opt-in policy and measured exceptions.
 * This is not a settings mutator, scheduler, full policy proof or second call ledger.
 */
export function inspectBaselineLocalPolicy(calls: readonly ModelCall[], normalTurns: readonly number[]): BaselineLocalPolicyReport {
    const turns = new Set(normalTurns);
    const selected = calls.filter(call => turns.has(call.turn));
    const violations: { turn: number; code: BaselineLocalViolationCode; ordinals: number[] }[] = [];
    for (const turn of turns) {
        const turnCalls = selected.filter(call => call.turn === turn);
        const story: number[] = [];
        for (const call of turnCalls) {
            const c = call.inference?.classification;
            if (!isInferenceClassification(c) || call.inference?.logicalInvocation !== call.ordinal) {
                violations.push({ turn, code: 'unclassified-call', ordinals: [call.ordinal] });
                continue;
            }
            const requiredStory = c.purpose === 'story' && c.execution === 'foreground' && c.requirement === 'required-story-completion';
            if (requiredStory) story.push(call.ordinal);
            if (c.purpose !== 'story' && c.requirement === 'required-story-completion') violations.push({ turn, code: 'required-non-story', ordinals: [call.ordinal] });
            if (!requiredStory && ['mandatory-foreground-turn', 'automatic-foreground', 'automatic-post-turn'].includes(c.trigger)) violations.push({ turn, code: 'automatic-model-work', ordinals: [call.ordinal] });
            if (c.purpose !== 'story' && c.blocking === 'visible-story') violations.push({ turn, code: 'story-blocking-auxiliary', ordinals: [call.ordinal] });
        }
        if (story.length !== 1) violations.push({ turn, code: 'required-story-count', ordinals: story });
    }
    return { profile: 'single-serialized-endpoint-baseline', enforcement: 'diagnostic-only',
        logicalCalls: selected.length, providerAttempts: selected.reduce((n, call) => n + call.attempts.length, 0), violations };
}
