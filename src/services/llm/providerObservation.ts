import type { ProviderCorrelation } from '@narrative/engine';
import { isProviderCorrelation, safeModelIdentifier } from '@narrative/engine';

let resolver: (() => ProviderCorrelation | undefined) | undefined;
let responseObserver: ((model: unknown) => unknown) | undefined;
export function setProviderResponseObserver(next: typeof responseObserver): () => void {
    const previous = responseObserver;
    responseObserver = next;
    return () => { responseObserver = previous; };
}
/** Metadata only; deliberately no response object or text crosses this seam. */
export function reportProviderModel(model: unknown): void {
    try {
        if (!responseObserver) return;
        const safeModel = safeModelIdentifier(model);
        if (safeModel === undefined) return;
        const delivered = responseObserver(safeModel);
        if (delivered != null && typeof (delivered as { then?: unknown }).then === 'function') {
            void Promise.resolve(delivered).catch(() => {});
        }
    } catch { /* diagnostics cannot change inference */ }
}
/** Development observer supplies the existing ledger context; no new logical ID allocator or ledger. */
export function setProviderContextResolver(next: typeof resolver): () => void {
    const previous = resolver;
    resolver = next;
    return () => { resolver = previous; };
}
export function providerContext(): ProviderCorrelation | undefined {
    try {
        const value = resolver?.();
        return isProviderCorrelation(value) ? {
            logicalInvocation: value.logicalInvocation, classification: { ...value.classification },
            ...(value.attemptOrdinal ? { attemptOrdinal: value.attemptOrdinal } : {}),
        } : undefined;
    } catch { return undefined; }
}
