import { ROOT_CAMPAIGN_SCOPE, createStableId, createCompatibilityReferences, parseDomainId } from '../src/index';
import type { StableId, StableIdInput, AuthorityClass, TrustClass, DomainId } from '../src/index';

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
