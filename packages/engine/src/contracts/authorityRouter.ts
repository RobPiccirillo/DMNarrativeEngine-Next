import type { DomainId } from './domain';
import type { StableId } from './identity';
import type { MutationCommand } from './mutation';
import type { AuthorityOwnerId, CommandKind, ContentVersion, FormatEpoch, VersionPrecondition } from './mutationVocabulary';

/** Ephemeral projection supplied by future transition policy; no state machine or persistence schema. */
export interface AuthorityView {
    readonly owner: AuthorityOwnerId;
    readonly formatEpoch: FormatEpoch;
    readonly writable: boolean;
}
export interface DomainAuthorityLookup {
    inspect(campaignId: StableId<'campaign'>, domainId: DomainId): AuthorityView | undefined;
}
export type AuthorityRejection =
    | { readonly status: 'unsupported-domain' }
    | { readonly status: 'owner-mismatch'; readonly actualOwner: AuthorityOwnerId }
    | { readonly status: 'invalid-transition'; readonly reason: 'writes-disabled' | 'format-epoch-mismatch'; readonly actualFormatEpoch: FormatEpoch };
export type MutationResult<R> = AuthorityRejection
    | { readonly status: 'accepted'; readonly value: R; readonly version: ContentVersion }
    | { readonly status: 'duplicate'; readonly value: R; readonly version: ContentVersion }
    | { readonly status: 'version-conflict'; readonly actualVersion: ContentVersion | null }
    | { readonly status: 'malformed-command'; readonly reason: 'invalid-envelope' | 'idempotency-key-reused' };

/** One future typed handler capability; implementations own atomic version checks and replay protection.
 * Logical replay identity is campaign/domain/mode plus commandId or caller key, never owner/epoch.
 * Cutover, epoch advancement and permitted rollback must never enable reapplication of that identity.
 * Historical outcomes retain the identity, exact semantic request, applied owner/epoch and original
 * result/content version. Applied owner/epoch are execution metadata, not a replay namespace.
 * After basic envelope validation, historical lookup/semantic verification precedes current
 * domain support, owner/epoch, writability and version checks. Exact retries recover the original
 * result/version without dispatch or reapplication, even if current authority/content has changed.
 * Historical comparison uses the originally recorded semantics, not the current owner's schema;
 * old payloads must never be reinterpreted or executed against the new owner for recovery.
 * expectedOwner/expectedFormatEpoch may be rebound on a retry: neither changes mutation semantics.
 * Caller-key retries may also change commandId. All other request semantics (including kind,
 * payload, provenance, content precondition and source/evidence references) must match or return
 * idempotency-key-reused. No serialized fingerprint or replay persistence schema is specified here.
 * Unseen identities still require a valid envelope, supported campaign/domain, current expected
 * owner/epoch, writability and content precondition before selecting/applying the owner capability.
 * expectedOwner remains the authority owner this prepared request expects for a new application;
 * expectedFormatEpoch protects new applications against an unexpected schema/transition epoch.
 * Lookup/envelope validation is necessary but does not itself authorize/commit a write.
 */
export interface DomainAuthorityRouter<K extends CommandKind, P, R> {
    route(command: MutationCommand<K, P>): Promise<MutationResult<R>>;
}
export function validateAuthorityExpectation<K extends CommandKind, P>(
    command: MutationCommand<K, P>, view: AuthorityView | undefined,
): AuthorityRejection | undefined {
    if (!view) return { status: 'unsupported-domain' };
    if (view.owner !== command.expectedOwner) return { status: 'owner-mismatch', actualOwner: view.owner };
    if (!view.writable || view.formatEpoch !== command.expectedFormatEpoch) return {
        status: 'invalid-transition', reason: view.writable ? 'format-epoch-mismatch' : 'writes-disabled',
        actualFormatEpoch: view.formatEpoch,
    };
    return undefined;
}
/** null means absent. None permits either state; create-if-absent permits only absence. */
export function matchesVersion(expected: VersionPrecondition, actual: ContentVersion | null): boolean {
    return expected.mode === 'none' || (expected.mode === 'exact' ? expected.version === actual : actual === null);
}
