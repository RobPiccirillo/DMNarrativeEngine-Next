import { ROOT_CAMPAIGN_SCOPE, createStableId, createCompatibilityReferences, parseDomainId } from '../src/index';
import type { StableId, StableIdInput, AuthorityClass, TrustClass, DomainId } from '../src/index';
import { parseCommandKind, parseAuthorityOwnerId, parseFormatEpoch, parseContentVersion, parseIdempotencyKey } from '../src/index';
import type { CommandKind, AuthorityOwnerId, WriterId, FormatEpoch, ContentVersion, IdempotencyKey, MutationCommand, DomainAuthorityRouter, SourceReference } from '../src/index';
import { projectAuthorityView } from '../src/index';
import type { AuthorityTransitionState, AuthorityTransitionOperation, AuthorityView } from '../src/index';

const campaign: StableId<'campaign'> = createStableId({
    kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'n', key: 'c',
});
const entity: StableId<'entity'> = createStableId({ kind: 'entity', campaign, namespace: 'n', key: 'k' });
const refs = createCompatibilityReferences({
    kind: 'entity', campaign: 'c', namespace: 'legacy', family: 'npcs', version: '1',
    scope: { mode: 'snapshot', snapshot: 'snapshot-1' },
}, ['key']);
const [legacyCampaign] = createCompatibilityReferences({
    kind: 'campaign', campaign: 'legacy-campaign', namespace: 'legacy', family: 'campaigns', version: '1',
    scope: { mode: 'compatibility' },
}, ['c']);

// @ts-expect-error Canonical campaign bootstrap requires the reserved root scope.
createStableId({ kind: 'campaign', campaign: 'legacy-campaign', namespace: 'n', key: 'c' });
// @ts-expect-error A campaign cannot be scoped by another canonical campaign.
createStableId({ kind: 'campaign', campaign, namespace: 'n', key: 'c' });
// @ts-expect-error Canonical child scope cannot be a raw legacy campaign string.
createStableId({ kind: 'entity', campaign: 'legacy-campaign', namespace: 'n', key: 'k' });
// @ts-expect-error The root is only valid for campaign bootstrap, not child identities.
createStableId({ kind: 'turn', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'n', key: 'k' });
// @ts-expect-error A compatibility campaign reference cannot establish canonical ownership.
createStableId({ kind: 'entity', campaign: legacyCampaign, namespace: 'n', key: 'k' });
// @ts-expect-error Another canonical kind cannot substitute for a campaign ID.
createStableId({ kind: 'turn', campaign: entity, namespace: 'n', key: 'k' });
// @ts-expect-error A union of input kinds must preserve the bootstrap/child distinction.
const mixedInput: StableIdInput<'campaign' | 'entity'> = { kind: 'entity', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'n', key: 'k' };

// @ts-expect-error Entity and turn identities cannot be interchanged.
const turn: StableId<'turn'> = entity;
// @ts-expect-error A stable legacy reference is not canonical identity.
const canonical: StableId<'entity'> = refs[0];
// @ts-expect-error Raw persisted strings require explicit validation/construction.
const raw: StableId<'entity'> = 'legacy-id';
// @ts-expect-error Transitional legacy is a status, not authority.
const authority: AuthorityClass = 'transitional-legacy';
// @ts-expect-error Authority terminology cannot stand in for trust.
const trust: TrustClass = 'canonical-evidence';
// @ts-expect-error Derived authority cannot be assigned to tracked authority.
const tracked: Extract<AuthorityClass, 'tracked-state'> = 'derived-interpretation';
// @ts-expect-error Domain IDs must be validated before use by a future registry.
const domain: DomainId = 'future.domain';

void [turn, canonical, raw, authority, trust, tracked, domain, mixedInput, parseDomainId('future.domain')];

const commandId = createStableId({ kind: 'command', campaign, namespace: 'n', key: 'cmd' });
const commandKind = parseCommandKind('future.patch')!;
const owner = parseAuthorityOwnerId('future.owner')!;
const mutation: MutationCommand<typeof commandKind, { count: number }> = {
    commandId, campaignId: campaign, domainId: parseDomainId('future.domain')!, kind: commandKind,
    provenance: { origin: 'deterministic-engine' }, expectedOwner: owner, expectedFormatEpoch: parseFormatEpoch(1)!,
    expectedVersion: { mode: 'exact', version: parseContentVersion('r1')! },
    idempotency: { mode: 'caller-key', key: parseIdempotencyKey('explicit')! }, payload: { count: 1 },
};
// @ts-expect-error Command IDs cannot stand in for campaigns.
const commandAsCampaign: StableId<'campaign'> = commandId;
// @ts-expect-error Campaign IDs cannot stand in for commands.
const campaignAsCommand: StableId<'command'> = campaign;
// @ts-expect-error Entity IDs cannot stand in for commands.
const entityAsCommand: StableId<'command'> = entity;
// @ts-expect-error Commands cannot stand in for entities.
const commandAsEntity: StableId<'entity'> = commandId;
// @ts-expect-error Owner identifiers are independent from record authority classes.
const ownerAsAuthority: AuthorityClass = owner;
// @ts-expect-error Record authority does not identify a permitted writer.
const authorityAsOwner: AuthorityOwnerId = 'tracked-state' as AuthorityClass;
// @ts-expect-error Domains and authority owners are independent.
const domainAsOwner: AuthorityOwnerId = mutation.domainId;
// @ts-expect-error Owner identifiers do not identify domains.
const ownerAsDomain: DomainId = owner;
// @ts-expect-error Command kinds and domains are independent brands.
const kindAsDomain: DomainId = commandKind;
// @ts-expect-error A validated domain cannot substitute for a validated command kind.
const domainAsKind: CommandKind = mutation.domainId;
// @ts-expect-error A raw kind is not a validated kind.
const rawKind: CommandKind = 'future.patch';
// @ts-expect-error A writer is not automatically an authority owner.
const ownerAsWriter: WriterId = owner;
// @ts-expect-error An epoch is validated, not an arbitrary numeric value.
const rawEpoch: FormatEpoch = 1;
// @ts-expect-error Content versions are validated equality tokens.
const rawVersion: ContentVersion = 'v1';
// @ts-expect-error Caller keys are validated explicit tokens.
const rawKey: IdempotencyKey = 'key';
// @ts-expect-error Compatibility references cannot enter a canonical source reference.
const legacyAsCanonicalSource: SourceReference<'entity'> = { type: 'canonical', kind: 'entity', id: refs[0] };
// @ts-expect-error Generic payload field retains its numeric type.
const wrongPayload: MutationCommand<typeof commandKind, { count: number }> = { ...mutation, payload: { count: '1' } };
// @ts-expect-error Canonical campaign fields reject compatibility references.
const wrongCampaign: typeof mutation = { ...mutation, campaignId: legacyCampaign };
// @ts-expect-error Command fields reject entity IDs.
const wrongCommandId: typeof mutation = { ...mutation, commandId: entity };
// @ts-expect-error Version none cannot carry a contradictory exact version.
const contradictoryVersion: typeof mutation = { ...mutation, expectedVersion: { mode: 'none', version: parseContentVersion('v1')! } };
// @ts-expect-error Caller-key mode requires a key.
const missingKey: typeof mutation = { ...mutation, idempotency: { mode: 'caller-key' } };

async function checkRouter(router: DomainAuthorityRouter<typeof commandKind, { count: number }, { changed: boolean }>) {
    const result = await router.route(mutation);
    if (result.status === 'accepted' || result.status === 'duplicate') {
        const changed: boolean = result.value.changed;
        // @ts-expect-error Router result generic preserves boolean, not string.
        const text: string = result.value.changed;
        void [changed, text];
    }
    // @ts-expect-error Router input generic preserves payload type.
    await router.route({ ...mutation, payload: { count: 'wrong' } });
    // @ts-expect-error A router cannot promise an incompatible result shape.
    const wrongRouter: DomainAuthorityRouter<typeof commandKind, { count: number }, { changed: string }> = router;
    void wrongRouter;
}
void [commandAsCampaign, campaignAsCommand, entityAsCommand, commandAsEntity, ownerAsAuthority,
    authorityAsOwner, domainAsOwner, ownerAsDomain, kindAsDomain, domainAsKind, rawKind, ownerAsWriter,
    rawEpoch, rawVersion, rawKey, legacyAsCanonicalSource, wrongPayload, wrongCampaign, wrongCommandId,
    contradictoryVersion, missingKey, checkRouter];

const legacyTransition: AuthorityTransitionState = {
    stage: 'legacy', domainId: mutation.domainId, legacyOwner: owner,
    formatEpoch: parseFormatEpoch(0)!, firstNewOwnerWrite: false,
};
const projected = projectAuthorityView(legacyTransition)!;
// @ts-expect-error A policy state is not its routing projection.
const stateAsView: AuthorityView = legacyTransition;
// @ts-expect-error Routing projections omit transition/latch data.
const viewAsState: AuthorityTransitionState = projected;
// @ts-expect-error Legacy authority cannot have an authoritative new-owner write.
const invalidLegacy: AuthorityTransitionState = { ...legacyTransition, firstNewOwnerWrite: true };
// @ts-expect-error A legacy state has no candidate owner.
const candidate = legacyTransition.newOwner;
// @ts-expect-error Migration initiation needs an explicit candidate owner.
const missingCandidate: AuthorityTransitionOperation = { type: 'begin-shadow', expectedOwner: owner, expectedFormatEpoch: parseFormatEpoch(0)! };
// @ts-expect-error Cutover cannot omit the explicit next epoch.
const missingEpoch: AuthorityTransitionOperation = { type: 'commit-cutover', expectedOwner: owner, expectedFormatEpoch: parseFormatEpoch(0)! };
// @ts-expect-error No generic latch reset operation exists.
const resetLatch: AuthorityTransitionOperation = { type: 'reset-latch', expectedOwner: owner, expectedFormatEpoch: parseFormatEpoch(0)! };
void [stateAsView, viewAsState, invalidLegacy, candidate, missingCandidate, missingEpoch, resetLatch];
