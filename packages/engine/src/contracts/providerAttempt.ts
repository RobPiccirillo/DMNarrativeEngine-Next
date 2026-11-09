import { isInferenceClassification } from './inference.js';
import type { InferenceClassification, InferenceRole } from './inference';

declare const backendBrand: unique symbol;
/** Protocol/runtime family, not a vendor catalog or an endpoint authorization. */
export type ProviderBackendId = string & { readonly [backendBrand]: true };
export function parseProviderBackendId(value: unknown): ProviderBackendId | undefined {
    return typeof value === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value) ? value as ProviderBackendId : undefined;
}
export interface ProviderCorrelation {
    readonly logicalInvocation: string;
    readonly classification: InferenceClassification;
    readonly attemptOrdinal?: number;
}
export function isProviderCorrelation(value: unknown): value is ProviderCorrelation {
    if (!value || typeof value !== 'object') return false;
    const c = value as Record<string, unknown>;
    return typeof c.logicalInvocation === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(c.logicalInvocation)
        && isInferenceClassification(c.classification)
        && (c.attemptOrdinal === undefined || (Number.isSafeInteger(c.attemptOrdinal) && Number(c.attemptOrdinal) > 0));
}
export interface ProviderAttemptDiagnostic {
    readonly logicalInvocation: string;
    readonly attemptOrdinal: number;
    readonly requestedRole: InferenceRole;
    readonly backend: ProviderBackendId;
    /** Only an in-process runtime proves local here; URL shape does not establish locality/trust. */
    readonly executionClass: 'local' | 'remote' | 'unknown';
    readonly stream: boolean;
    readonly relation: 'initial' | 'retry' | 'fallback';
    readonly reason?: 'rate-limit' | 'http-error' | 'transport-error' | 'invalid-response' | 'backend-or-model-changed';
    readonly configuredModel?: string;
    readonly actualModel?: string;
    readonly outcome: 'running' | 'success' | 'http-error' | 'error' | 'cancelled' | 'invalid-response';
    readonly status?: number;
    readonly queueWaitMs?: number;
    readonly providerMs?: number;
    readonly firstChunkMs?: number;
    readonly firstVisibleMs?: number;
    readonly firstReasoningMs?: number;
    readonly usage?: Readonly<Partial<Record<'prompt_tokens' | 'completion_tokens' | 'input_tokens' | 'output_tokens' | 'total_tokens' | 'reasoning_tokens', number>>>;
}
/** Conservative compact identifiers only: namespace/name plus an optional tag OR revision.
 * Uncertain URL/credential/header/structured values are omitted, never normalized or retained.
 */
export function safeModelIdentifier(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256
        || /[^\x21-\x7e]/.test(value)) return undefined; // Printable ASCII, no whitespace/control text.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*(?:[:@][A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(value)) return undefined;
    if (/^(?:https?|data|file|javascript|ftp|mailto|blob|ssh|wss?):/i.test(value)
        || /^(?:sk[-_]|gh[pousr]_|github_pat_|hf_|AKIA|ASIA|AIza|eyJ|bearer|basic|(?:authorization|proxy-authorization|content-type|content-length|user-agent|accept|cookie|set-cookie|x-[a-z0-9-]+|api[-_]?key|access[-_]?token|token|password|passwd|secret):)/i.test(value)
        || /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?:\/|:|$)/i.test(value)
        || /^(?:[a-z0-9-]+\.)+[a-z]{2,}\//i.test(value)) return undefined;
    return value;
}
/** Explicit allowlist projection: never copies request/response text, URLs, headers or errors. */
export function providerAttemptProjection(input: ProviderAttemptDiagnostic): ProviderAttemptDiagnostic {
    const output: ProviderAttemptDiagnostic = {
        logicalInvocation: input.logicalInvocation, attemptOrdinal: input.attemptOrdinal, requestedRole: input.requestedRole,
        backend: input.backend, executionClass: input.executionClass, stream: input.stream,
        relation: input.relation, outcome: input.outcome,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(safeModelIdentifier(input.configuredModel) ? { configuredModel: input.configuredModel } : {}),
        ...(safeModelIdentifier(input.actualModel) ? { actualModel: input.actualModel } : {}),
        ...(Number.isInteger(input.status) && input.status! >= 100 && input.status! <= 599 ? { status: input.status } : {}),
    };
    const times: Record<string, number> = {};
    for (const key of ['queueWaitMs', 'providerMs', 'firstChunkMs', 'firstVisibleMs', 'firstReasoningMs'] as const) {
        const value = input[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) times[key] = value;
    }
    const usage: Record<string, number> = {};
    for (const key of ['prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens', 'total_tokens', 'reasoning_tokens'] as const) {
        const value = input.usage?.[key];
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[key] = value;
    }
    return { ...output, ...times, ...(Object.keys(usage).length ? { usage } : {}) };
}
