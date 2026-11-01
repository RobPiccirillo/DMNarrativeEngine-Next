/** Descriptive observations of existing inference, never scheduling or routing policy. */
export const INFERENCE_PURPOSES = ['story', 'planning', 'extraction-analysis', 'summarization', 'npc', 'relationship-knowledge', 'embedding', 'vision-media', 'extension', 'utility'] as const;
export const INFERENCE_TRIGGERS = ['explicit-user-action', 'mandatory-foreground-turn', 'automatic-foreground', 'automatic-post-turn', 'manual-utility', 'extension-action'] as const;
export const INFERENCE_EXECUTION = ['foreground', 'background'] as const;
export const INFERENCE_BLOCKING = ['visible-story', 'turn-commit', 'post-turn-completion', 'nothing-user-visible'] as const;
export const INFERENCE_ROLES = ['story', 'auxiliary', 'utility', 'summariser', 'raw-auxiliary', 'raw-summariser', 'embedding', 'media', 'caller-selected'] as const;
export const INFERENCE_REQUIREMENTS = ['required-story-completion', 'optional'] as const;
export type ModelCallPurpose = typeof INFERENCE_PURPOSES[number];
export type InferenceRole = typeof INFERENCE_ROLES[number];

export interface InferenceClassification {
    readonly purpose: ModelCallPurpose;
    /** Stable descriptive family, not a provider/model identifier. */
    readonly operation: string;
    readonly trigger: typeof INFERENCE_TRIGGERS[number];
    readonly execution: typeof INFERENCE_EXECUTION[number];
    readonly blocking: typeof INFERENCE_BLOCKING[number];
    readonly role: typeof INFERENCE_ROLES[number];
    readonly requirement: typeof INFERENCE_REQUIREMENTS[number];
}

export function isInferenceClassification(value: unknown): value is InferenceClassification {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const c = value as Record<string, unknown>;
    const fields = ['purpose', 'operation', 'trigger', 'execution', 'blocking', 'role', 'requirement'];
    if (Reflect.ownKeys(c).length !== fields.length || !fields.every(k => Object.hasOwn(c, k))) return false;
    return typeof c.operation === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(c.operation)
        && INFERENCE_PURPOSES.some(v => v === c.purpose)
        && INFERENCE_TRIGGERS.some(v => v === c.trigger)
        && INFERENCE_EXECUTION.some(v => v === c.execution)
        && INFERENCE_BLOCKING.some(v => v === c.blocking)
        && INFERENCE_ROLES.some(v => v === c.role)
        && INFERENCE_REQUIREMENTS.some(v => v === c.requirement);
}
