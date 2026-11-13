import type { AppSettings } from '../../types';

/** Transitional operational overlay; never rewrites campaign or provider settings. */
export type TransitionalLocalProfileId = 'current' | 'constrained-local-v1';
export type InferenceFeature = 'story' | 'automatic-model' | 'semantic-search' | 'tools' | 'automatic-retry';
export interface ConstrainedLocalPreset {
    readonly id: TransitionalLocalProfileId;
    readonly constrained: boolean;
    readonly maxStoryAttempts: number;
}
const current: ConstrainedLocalPreset = Object.freeze({ id: 'current', constrained: false, maxStoryAttempts: 3 });
const constrained: ConstrainedLocalPreset = Object.freeze({ id: 'constrained-local-v1', constrained: true, maxStoryAttempts: 1 });

export function normalizeInferenceProfileId(value: unknown): TransitionalLocalProfileId {
    if (value === undefined || value === 'current') return 'current';
    if (value === 'constrained-local-v1') return value;
    console.warn('[InferencePolicy] Invalid inference profile; using current');
    return 'current';
}

export function resolveInferencePolicy(settings: Pick<AppSettings, 'inferenceProfileId'>): ConstrainedLocalPreset {
    return normalizeInferenceProfileId(settings.inferenceProfileId) === 'constrained-local-v1' ? constrained : current;
}

export function effectiveFeatureEnabled(policy: ConstrainedLocalPreset, feature: InferenceFeature, legacyDecision: boolean): boolean {
    return legacyDecision && (!policy.constrained || feature === 'story');
}

let settingsSource: (() => Pick<AppSettings, 'inferenceProfileId'>) | undefined;
let activationPending = false;
/** Composition-root seam for old queued closures; pure helpers still take explicit settings. */
export function setInferencePolicySource(source: () => Pick<AppSettings, 'inferenceProfileId'>): void { settingsSource = source; }
export function setInferenceActivationPending(pending: boolean): void { activationPending = pending; }
export function isInferenceActivationPending(): boolean { return activationPending; }
export function automaticModelWorkAllowed(snapshot: Pick<AppSettings, 'inferenceProfileId'> = {}): boolean {
    return !activationPending && !resolveInferencePolicy(snapshot).constrained && !resolveInferencePolicy(settingsSource?.() ?? {}).constrained;
}
