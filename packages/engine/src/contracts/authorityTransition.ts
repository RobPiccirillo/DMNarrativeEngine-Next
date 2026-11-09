import { parseDomainId } from './domain.js';
import type { DomainId } from './domain';
import { isSourceReference } from './mutation.js';
import type { SourceReference } from './mutation';
import { parseAuthorityOwnerId, parseFormatEpoch } from './mutationVocabulary.js';
import type { AuthorityOwnerId, FormatEpoch } from './mutationVocabulary';
import type { AuthorityView } from './authorityRouter';

interface TransitionBase {
    readonly domainId: DomainId;
    readonly legacyOwner: AuthorityOwnerId;
    readonly formatEpoch: FormatEpoch;
}
export type AuthorityTransitionState = TransitionBase & (
    | { readonly stage: 'legacy'; readonly firstNewOwnerWrite: false }
    | { readonly stage: 'shadow'; readonly newOwner: AuthorityOwnerId; readonly firstNewOwnerWrite: false;
        readonly verification: SourceReference | null; readonly cutoverPrepared: boolean }
    | { readonly stage: 'sqlite'; readonly newOwner: AuthorityOwnerId; readonly firstNewOwnerWrite: boolean;
        readonly verification: SourceReference }
    | { readonly stage: 'retired'; readonly newOwner: AuthorityOwnerId; readonly firstNewOwnerWrite: true;
        readonly verification: SourceReference }
);
type Expectation = { readonly expectedOwner: AuthorityOwnerId; readonly expectedFormatEpoch: FormatEpoch };
export type AuthorityTransitionOperation =
    | { readonly type: 'initialize'; readonly legacyOwner: AuthorityOwnerId; readonly formatEpoch: FormatEpoch }
    | (Expectation & (
        | { readonly type: 'begin-shadow'; readonly newOwner: AuthorityOwnerId }
        | { readonly type: 'verify'; readonly verification: SourceReference }
        | { readonly type: 'prepare-cutover' }
        | { readonly type: 'commit-cutover'; readonly nextFormatEpoch: FormatEpoch }
        | { readonly type: 'mark-new-owner-write' }
        | { readonly type: 'abort' }
        | { readonly type: 'rollback'; readonly nextFormatEpoch: FormatEpoch }
        | { readonly type: 'retire' }
    ));
export type TransitionRejectionReason = 'malformed-state' | 'malformed-operation' | 'duplicate-initialization'
    | 'uninitialized-domain' | 'wrong-stage' | 'owner-mismatch' | 'epoch-mismatch'
    | 'illegal-epoch' | 'verification-required' | 'rollback-prohibited';
export type AuthorityTransitionResult =
    | { readonly status: 'transitioned'; readonly state: AuthorityTransitionState }
    | { readonly status: 'rejected'; readonly reason: TransitionRejectionReason };

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
    return Object.keys(value).every(key => allowed.includes(key));
}
/** Slice 5-owned reference schema: exactly three serializable own fields, no embedded metadata.
 * The reference cites caller-supplied material; it does not prove verification was executed.
 * General Slice 4 SourceReference validation remains permissive outside this control plane.
 */
function isVerificationReference(value: unknown): value is SourceReference {
    return record(value) && Reflect.ownKeys(value).length === 3
        && ['type', 'kind', 'id'].every(key => Object.prototype.propertyIsEnumerable.call(value, key))
        && isSourceReference(value);
}
/** Strict control schema: unknown/contradictory policy fields fail closed. */
export function isAuthorityTransitionState(value: unknown): value is AuthorityTransitionState {
    if (!record(value) || !parseDomainId(value.domainId) || !parseAuthorityOwnerId(value.legacyOwner)
        || parseFormatEpoch(value.formatEpoch) === undefined) return false;
    const base = ['domainId', 'legacyOwner', 'formatEpoch', 'stage', 'firstNewOwnerWrite'];
    if (value.stage === 'legacy') return value.firstNewOwnerWrite === false && keys(value, base);
    if (!parseAuthorityOwnerId(value.newOwner) || value.newOwner === value.legacyOwner) return false;
    if (value.stage === 'shadow') return value.firstNewOwnerWrite === false
        && typeof value.cutoverPrepared === 'boolean'
        && (value.verification === null || isVerificationReference(value.verification))
        && (!value.cutoverPrepared || value.verification !== null)
        && keys(value, [...base, 'newOwner', 'verification', 'cutoverPrepared']);
    return (value.stage === 'sqlite' || value.stage === 'retired')
        && typeof value.firstNewOwnerWrite === 'boolean' && (value.stage !== 'retired' || value.firstNewOwnerWrite)
        && isVerificationReference(value.verification) && keys(value, [...base, 'newOwner', 'verification']);
}
/** Invalid input never projects a writable fallback. Missing entries need an explicit legacy policy. */
export function projectAuthorityView(value: unknown): AuthorityView | undefined {
    if (!isAuthorityTransitionState(value)) return undefined;
    return {
        owner: value.stage === 'legacy' || value.stage === 'shadow' ? value.legacyOwner : value.newOwner,
        formatEpoch: value.formatEpoch,
        writable: value.stage !== 'shadow' || !value.cutoverPrepared,
    };
}
export function isAuthorityTransitionOperation(value: unknown): value is AuthorityTransitionOperation {
    if (!record(value) || typeof value.type !== 'string') return false;
    if (value.type === 'initialize') return !!parseAuthorityOwnerId(value.legacyOwner)
        && parseFormatEpoch(value.formatEpoch) !== undefined && keys(value, ['type', 'legacyOwner', 'formatEpoch']);
    if (!parseAuthorityOwnerId(value.expectedOwner) || parseFormatEpoch(value.expectedFormatEpoch) === undefined) return false;
    const base = ['type', 'expectedOwner', 'expectedFormatEpoch'];
    if (value.type === 'begin-shadow') return !!parseAuthorityOwnerId(value.newOwner) && keys(value, [...base, 'newOwner']);
    if (value.type === 'verify') return isVerificationReference(value.verification) && keys(value, [...base, 'verification']);
    if (value.type === 'commit-cutover' || value.type === 'rollback') return parseFormatEpoch(value.nextFormatEpoch) !== undefined
        && keys(value, [...base, 'nextFormatEpoch']);
    return ['prepare-cutover', 'mark-new-owner-write', 'abort', 'retire'].includes(value.type) && keys(value, base);
}
/** Pure policy only. Future writers must durably set the latch with their authoritative application.
 * This control state never namespaces logical replay identity or stores committed mutation outcomes.
 */
export function transitionAuthority(
    current: AuthorityTransitionState | undefined, domainId: DomainId, operation: unknown,
): AuthorityTransitionResult {
    const reject = (reason: TransitionRejectionReason): AuthorityTransitionResult => ({ status: 'rejected', reason });
    if (!parseDomainId(domainId) || (current !== undefined && (!isAuthorityTransitionState(current) || current.domainId !== domainId))) return reject('malformed-state');
    if (!isAuthorityTransitionOperation(operation)) return reject('malformed-operation');
    if (operation.type === 'initialize') return current ? reject('duplicate-initialization') : {
        status: 'transitioned', state: { stage: 'legacy', domainId, legacyOwner: operation.legacyOwner,
            formatEpoch: operation.formatEpoch, firstNewOwnerWrite: false },
    };
    if (!current) return reject('uninitialized-domain');
    const view = projectAuthorityView(current)!;
    if (view.owner !== operation.expectedOwner) return reject('owner-mismatch');
    if (view.formatEpoch !== operation.expectedFormatEpoch) return reject('epoch-mismatch');
    const legacy = (formatEpoch: FormatEpoch): AuthorityTransitionState => ({
        stage: 'legacy', domainId, legacyOwner: current.legacyOwner, formatEpoch, firstNewOwnerWrite: false,
    });
    let next: AuthorityTransitionState;
    switch (operation.type) {
        case 'begin-shadow':
            if (current.stage !== 'legacy') return reject('wrong-stage');
            if (operation.newOwner === current.legacyOwner) return reject('owner-mismatch');
            next = { ...current, stage: 'shadow', newOwner: operation.newOwner, verification: null, cutoverPrepared: false };
            break;
        case 'verify':
            if (current.stage !== 'shadow' || current.cutoverPrepared) return reject('wrong-stage');
            next = { ...current, verification: operation.verification };
            break;
        case 'prepare-cutover':
            if (current.stage !== 'shadow' || current.cutoverPrepared) return reject('wrong-stage');
            if (!current.verification) return reject('verification-required');
            next = { ...current, cutoverPrepared: true };
            break;
        case 'commit-cutover':
            if (current.stage !== 'shadow' || !current.cutoverPrepared || !current.verification) return reject('wrong-stage');
            if (operation.nextFormatEpoch <= current.formatEpoch) return reject('illegal-epoch');
            next = { stage: 'sqlite', domainId, legacyOwner: current.legacyOwner, newOwner: current.newOwner,
                verification: current.verification, formatEpoch: operation.nextFormatEpoch, firstNewOwnerWrite: false };
            break;
        case 'mark-new-owner-write':
            if (current.stage !== 'sqlite') return reject('wrong-stage');
            next = { ...current, firstNewOwnerWrite: true };
            break;
        case 'abort':
            if (current.stage !== 'shadow') return reject('wrong-stage');
            next = legacy(current.formatEpoch);
            break;
        case 'rollback':
            if (current.firstNewOwnerWrite) return reject('rollback-prohibited');
            if (current.stage !== 'sqlite') return reject('wrong-stage');
            if (operation.nextFormatEpoch <= current.formatEpoch) return reject('illegal-epoch');
            next = legacy(operation.nextFormatEpoch);
            break;
        case 'retire':
            if (current.stage !== 'sqlite') return reject('wrong-stage');
            if (!current.firstNewOwnerWrite) return reject('wrong-stage');
            next = { ...current, stage: 'retired', firstNewOwnerWrite: true };
            break;
    }
    return { status: 'transitioned', state: next };
}
