import { parseDomainId } from './domain';
import type { DomainId } from './domain';
import { getStableIdCampaign, parseStableId, parseCompatibilityReference } from './identity';
import type { StableId, CompatibilityReference } from './identity';
import {
    parseCommandKind, parseAuthorityOwnerId, parseWriterId, parseFormatEpoch,
    parseContentVersion, parseIdempotencyKey,
} from './mutationVocabulary';
import type { CommandKind, AuthorityOwnerId, WriterId, FormatEpoch, VersionPrecondition, Idempotency } from './mutationVocabulary';

export type SourceReference<K extends string = string> =
    | { readonly type: 'canonical'; readonly kind: K; readonly id: StableId<K> }
    | { readonly type: 'compatibility'; readonly kind: K; readonly id: CompatibilityReference<K> };

export const MUTATION_ORIGINS = [
    'current-user-action', 'trusted-meta-direction', 'deterministic-engine', 'model-derived',
    'import', 'recovery-repair', 'migration', 'extension-mod', 'background-processing',
] as const;
export type MutationOrigin = typeof MUTATION_ORIGINS[number];
/** Metadata describes origin, never grants write authority or elevates trust. */
export interface MutationProvenance {
    readonly origin: MutationOrigin;
    readonly actor?: SourceReference;
    readonly source?: SourceReference;
    readonly writerId?: WriterId;
    readonly turn?: SourceReference<'turn'>;
    readonly message?: SourceReference<'message'>;
    readonly modelCall?: SourceReference<'model-call'>;
    readonly importSource?: SourceReference;
    readonly correction?: SourceReference;
    /** Caller-supplied UTC ISO instant, YYYY-MM-DDTHH:mm:ss.sssZ. Never synthesized. */
    readonly timestamp?: string;
}
export interface MutationCommand<K extends CommandKind, P> {
    readonly commandId: StableId<'command'>;
    readonly campaignId: StableId<'campaign'>;
    readonly domainId: DomainId;
    readonly kind: K;
    readonly provenance: MutationProvenance;
    readonly expectedOwner: AuthorityOwnerId;
    readonly expectedFormatEpoch: FormatEpoch;
    readonly expectedVersion: VersionPrecondition;
    readonly idempotency: Idempotency;
    readonly sources?: readonly SourceReference[];
    readonly evidence?: readonly SourceReference<'evidence'>[];
    readonly payload: P;
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isSourceReference(value: unknown, kind?: string): value is SourceReference {
    if (!record(value) || typeof value.kind !== 'string' || (kind !== undefined && value.kind !== kind)) return false;
    return value.type === 'canonical' ? parseStableId(value.id, value.kind) !== undefined
        : value.type === 'compatibility' && parseCompatibilityReference(value.id, value.kind) !== undefined;
}
export function isMutationProvenance(value: unknown): value is MutationProvenance {
    if (!record(value) || !MUTATION_ORIGINS.some(origin => origin === value.origin)) return false;
    if ('writerId' in value && parseWriterId(value.writerId) === undefined) return false;
    if ('timestamp' in value) {
        if (typeof value.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.timestamp)) return false;
        const time = new Date(value.timestamp);
        if (!Number.isFinite(time.getTime()) || time.toISOString() !== value.timestamp) return false;
    }
    for (const field of ['actor', 'source', 'importSource', 'correction'] as const) {
        if (field in value && !isSourceReference(value[field])) return false;
    }
    for (const [field, kind] of [['turn', 'turn'], ['message', 'message'], ['modelCall', 'model-call']] as const) {
        if (field in value && !isSourceReference(value[field], kind)) return false;
    }
    return true;
}
export function isVersionPrecondition(value: unknown): value is VersionPrecondition {
    if (!record(value)) return false;
    return value.mode === 'exact' ? parseContentVersion(value.version) !== undefined
        : (value.mode === 'none' || value.mode === 'create-if-absent') && !('version' in value);
}
export function isIdempotency(value: unknown): value is Idempotency {
    if (!record(value)) return false;
    return value.mode === 'caller-key' ? parseIdempotencyKey(value.key) !== undefined
        : value.mode === 'command-id' && !('key' in value);
}
/** Validate untrusted envelopes with a caller-owned kind-specific payload guard. No ambient inputs or IO. */
export function isMutationCommand<K extends CommandKind, P>(
    value: unknown, kind: K, isPayload: (payload: unknown) => payload is P,
): value is MutationCommand<K, P> {
    if (!record(value) || parseCommandKind(kind) === undefined || value.kind !== kind) return false;
    const campaign = parseStableId(value.campaignId, 'campaign');
    const command = parseStableId(value.commandId, 'command');
    if (!campaign || !command || getStableIdCampaign(command) !== campaign) return false;
    if (parseDomainId(value.domainId) === undefined || parseAuthorityOwnerId(value.expectedOwner) === undefined
        || parseFormatEpoch(value.expectedFormatEpoch) === undefined || !isVersionPrecondition(value.expectedVersion)
        || !isIdempotency(value.idempotency) || !isMutationProvenance(value.provenance)) return false;
    for (const field of ['sources', 'evidence'] as const) {
        if (!(field in value)) continue;
        const refs = value[field];
        if (!Array.isArray(refs)) return false;
        // Array iteration visits holes too, so sparse reference lists cannot validate accidentally.
        for (const ref of refs) if (!isSourceReference(ref, field === 'evidence' ? 'evidence' : undefined)) return false;
    }
    return 'payload' in value && isPayload(value.payload);
}
