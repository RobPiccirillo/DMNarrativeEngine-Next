import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { isProviderCorrelation, parseProviderBackendId, providerAttemptProjection, safeModelIdentifier } from '@narrative/engine/contracts/providerAttempt';

const scope = new AsyncLocalStorage();
let observer;
let logicalResolver;
/** Opt-in callback, no retained ledger/content. Callback failures cannot affect providers. */
export function setProviderObserver(next, resolveLogical) {
    const previous = observer;
    const previousResolver = logicalResolver;
    observer = next;
    logicalResolver = resolveLogical;
    return () => { observer = previous; logicalResolver = previousResolver; };
}
/** Tooling resolves operation names through the one inventory into its existing logical ledger.
 * No IDs/classifications are invented here. Missing/dynamic contexts stay unverified.
 */
export function withProviderOperation(operation, work) {
    if (!observer || scope.getStore()) return work();
    let correlation;
    try { correlation = logicalResolver?.(operation); } catch { /* observer isolation */ }
    return withProviderObservation(correlation, work);
}
export function withProviderObservation(correlation, work) {
    if (!observer || !isProviderCorrelation(correlation)) return work();
    const safeCorrelation = { logicalInvocation: correlation.logicalInvocation, classification: { ...correlation.classification } };
    return scope.run({ correlation: safeCorrelation, ordinal: (correlation.attemptOrdinal ?? 1) - 1 }, work);
}
export function beginProviderAttempt({ backend, configuredModel, actualModel, stream = false, executionClass = 'unknown' }) {
    const current = scope.getStore();
    if (!current || !observer) return { finish() {}, chunk() {} };
    // Private, non-exported equality token preserves target-change detection without retaining text.
    const modelIdentity = typeof configuredModel === 'string' ? createHash('sha256').update(configuredModel).digest('hex') : undefined;
    // Do not retain rejected model text in the attempt closure or retry-comparison metadata.
    configuredModel = safeModelIdentifier(configuredModel);
    actualModel = safeModelIdentifier(actualModel);
    const sink = observer;
    const started = performance.now();
    const ordinal = ++current.ordinal;
    const changed = current.previous && (current.previous.backend !== backend || current.previous.modelIdentity !== modelIdentity);
    const base = {
        logicalInvocation: current.correlation.logicalInvocation, requestedRole: current.correlation.classification.role,
        attemptOrdinal: ordinal, backend: parseProviderBackendId(backend) ?? parseProviderBackendId('unknown'),
        configuredModel, actualModel, stream, executionClass, relation: changed ? 'fallback' : ordinal === 1 ? 'initial' : 'retry',
        ...(changed ? { reason: 'backend-or-model-changed' } : current.previous?.reason ? { reason: current.previous.reason } : {}),
    };
    let firstChunkMs;
    let finished = false;
    return {
        chunk() { if (firstChunkMs === undefined) firstChunkMs = performance.now() - started; },
        finish(outcome, metadata = {}) {
            if (finished) return;
            finished = true;
            const safe = providerAttemptProjection({ ...base, ...metadata, outcome, providerMs: performance.now() - started, firstChunkMs });
            current.previous = { backend, modelIdentity,
                reason: outcome === 'invalid-response' ? 'invalid-response'
                    : outcome === 'http-error' ? ([429, 503, 529].includes(metadata.status) ? 'rate-limit' : 'http-error')
                        : outcome === 'error' || outcome === 'cancelled' ? 'transport-error' : undefined };
            try {
                const delivered = sink(safe);
                if (delivered && typeof delivered.then === 'function') void Promise.resolve(delivered).catch(() => {});
            } catch { /* diagnostics are never provider policy */ }
        },
    };
}
/** Native execution helper: exactly one execution; same value/error, no retries or buffering. */
export function observeProviderExecution(metadata, work) {
    if (!scope.getStore() || !observer) return work();
    return (async () => {
        const attempt = beginProviderAttempt(metadata);
        try {
            const result = await work();
            attempt.finish('success');
            return result;
        } catch (error) {
            attempt.finish(error?.name === 'AbortError' ? 'cancelled' : 'error');
            throw error;
        }
    })();
}
