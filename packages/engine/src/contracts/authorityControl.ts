import { parseStableId } from './identity.js';
import type { StableId } from './identity';
import { isAuthorityTransitionState } from './authorityTransition.js';
import type { AuthorityTransitionState } from './authorityTransition';

export interface AuthorityControlDocument {
    readonly schemaVersion: 1;
    readonly campaignId: StableId<'campaign'>;
    /** Optimistic control-file revision, separate from domain format/content versions. */
    readonly revision: number;
    readonly domains: readonly AuthorityTransitionState[];
}
export function isAuthorityControlDocument(value: unknown): value is AuthorityControlDocument {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const doc = value as Record<string, unknown>;
    if (Object.keys(doc).some(key => !['schemaVersion', 'campaignId', 'revision', 'domains'].includes(key))
        || doc.schemaVersion !== 1 || !parseStableId(doc.campaignId, 'campaign')
        || typeof doc.revision !== 'number' || !Number.isSafeInteger(doc.revision) || doc.revision < 0
        || !Array.isArray(doc.domains)) return false;
    const seen = new Set<string>();
    for (const state of doc.domains) {
        if (!isAuthorityTransitionState(state) || seen.has(state.domainId)) return false;
        seen.add(state.domainId);
    }
    return true;
}
/** Fixed field order and sorted domains; no caller key-order dependence or implicit state changes. */
export function serializeAuthorityControl(value: AuthorityControlDocument): string {
    if (!isAuthorityControlDocument(value)) throw new TypeError('Malformed authority control document');
    const ordered = (input: unknown): unknown => {
        if (Array.isArray(input)) return input.map(ordered);
        if (input !== null && typeof input === 'object') return Object.fromEntries(
            Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]),
        );
        return input;
    };
    return JSON.stringify(ordered({ ...value, domains: [...value.domains].sort((a, b) => a.domainId < b.domainId ? -1 : a.domainId > b.domainId ? 1 : 0) }), null, 2) + '\n';
}
