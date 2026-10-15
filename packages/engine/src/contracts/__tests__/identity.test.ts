import { describe, expect, it, vi } from 'vitest';
import {
    CORE_ID_KINDS, ROOT_CAMPAIGN_SCOPE, createStableId, parseStableId,
    createCompatibilityReferences, parseCompatibilityReference,
} from '../identity';
import type { CompatibilitySource } from '../identity';

const campaignInput = { kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'campaign.v1', key: 'campaign-a' } as const;
const campaignId = createStableId(campaignInput);
const input = { kind: 'entity', campaign: campaignId, namespace: 'owned.v1', key: 'explicit-1' } as const;
const source: CompatibilitySource<'entity'> = {
    kind: 'entity', campaign: 'campaign-a', namespace: 'legacy.npcs',
    family: 'npc-json', version: 'v1', scope: { mode: 'compatibility' },
};

describe('stable identities', () => {
    it('has an exact deterministic representation', () => {
        const expected = 'sid:1:c:%5B%22entity%22%2C%22' + encodeURIComponent(campaignId)
            + '%22%2C%22owned.v1%22%2C%22explicit-1%22%5D';
        expect(createStableId(input)).toBe(expected);
        expect(createStableId({ ...input })).toBe(expected);
    });

    it.each(CORE_ID_KINDS)('round-trips core kind %s', kind => {
        const id = kind === 'campaign' ? createStableId(campaignInput) : createStableId({ ...input, kind });
        expect(parseStableId(id, kind)).toBe(id);
    });

    it('accepts future explicitly named kinds', () => {
        const id = createStableId({ ...input, kind: 'future.session' });
        expect(parseStableId(id, 'future.session')).toBe(id);
    });

    it('separates kinds and checks the expected kind at parse time', () => {
        expect(createStableId({ ...input, kind: 'turn' })).not.toBe(createStableId(input));
        expect(parseStableId(createStableId(input), 'turn')).toBeUndefined();
    });

    it.each(['campaign', 'namespace', 'key'] as const)('separates %s', field => {
        const different = field === 'campaign'
            ? createStableId({ ...input, campaign: createStableId({ ...campaignInput, key: 'campaign-b' }) })
            : createStableId({ ...input, [field]: 'different' });
        expect(different).not.toBe(createStableId(input));
    });

    it('encodes delimiter-containing tuples without concatenation ambiguity', () => {
        const a = createStableId({ ...input, namespace: 'a:b', key: 'c' });
        const b = createStableId({ ...input, namespace: 'a', key: 'b:c' });
        expect(a).not.toBe(b);
        expect(parseStableId(a, 'entity')).toBe(a);
    });

    it('preserves Unicode and does not normalize spelling or whitespace', () => {
        const id = createStableId({ ...input, key: '王女 🐉 : / % "' });
        expect(parseStableId(id, 'entity')).toBe(id);
        expect(createStableId({ ...input, key: 'é' })).not.toBe(createStableId({ ...input, key: 'e\u0301' }));
        expect(createStableId({ ...input, key: ' x' })).not.toBe(createStableId({ ...input, key: 'x' }));
    });

    it.each([null, 5, '', 'legacy-id', 'sid:2:c:[]', 'sid:1:c:%', 'sid:1:c:%5B%5D',
        'sid:1:c:%5B1%2C2%2C3%2C4%5D', 'sid:1:c:["entity","c","n","k"]',
        'sid:1:c:%5B%22entity%22%2C%22%22%2C%22n%22%2C%22k%22%5D',
    ])('rejects malformed ID %j cleanly', value => {
        expect(parseStableId(value, 'entity')).toBeUndefined();
        expect(parseCompatibilityReference(value, 'entity')).toBeUndefined();
    });

    it.each(['', ' ', '\ud800'])('rejects invalid explicit text %j', key => {
        expect(() => createStableId({ ...input, key })).toThrow();
    });

    it('rejects malformed kinds', () => {
        expect(() => createStableId({ ...input, kind: 'Entity:unsafe' })).toThrow();
    });

    it('does not consume the clock or RNG or mutate legacy input records', () => {
        const records = Object.freeze([Object.freeze({ id: 'legacy-42', name: 'Mira' })]);
        const before = JSON.stringify(records);
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('ambient clock'); });
        const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('ambient RNG'); });
        try {
            expect(createStableId(campaignInput)).toBe(campaignId);
            expect(parseStableId(campaignId, 'campaign')).toBe(campaignId);
            const id = createStableId(input);
            expect(parseStableId(id, 'entity')).toBe(id);
            const refs = createCompatibilityReferences(source, records.map(record => record.id));
            expect(parseCompatibilityReference(refs[0], 'entity')).toBe(refs[0]);
            expect(clock).not.toHaveBeenCalled();
            expect(random).not.toHaveBeenCalled();
            expect(JSON.stringify(records)).toBe(before);
        } finally {
            clock.mockRestore();
            random.mockRestore();
        }
    });
});

const canonicalTuple = (kind: string, campaign: string) =>
    'sid:1:c:' + encodeURIComponent(JSON.stringify([kind, campaign, 'n', 'k']));

describe('canonical campaign scope', () => {
    it('bootstraps a root campaign with an exact nonrecursive representation', () => {
        expect(campaignId).toBe('sid:1:c:%5B%22campaign%22%2C%22root%3Acampaign%22%2C%22campaign.v1%22%2C%22campaign-a%22%5D');
        expect(JSON.parse(decodeURIComponent(campaignId.slice('sid:1:c:'.length))))
            .toEqual(['campaign', ROOT_CAMPAIGN_SCOPE, 'campaign.v1', 'campaign-a']);
        expect(parseStableId(campaignId, 'campaign')).toBe(campaignId);
        expect(parseStableId(ROOT_CAMPAIGN_SCOPE, 'campaign')).toBeUndefined();
    });

    it.each(['legacy-campaign', campaignId, createStableId(input)])('rejects non-root campaign bootstrap scope %s', scope => {
        // @ts-expect-error Runtime validation must also reject external non-root campaign scopes.
        expect(() => createStableId({ ...campaignInput, campaign: scope })).toThrow('root scope');
        expect(parseStableId(canonicalTuple('campaign', scope), 'campaign')).toBeUndefined();
    });

    it('accepts canonical campaign identity as child scope and round-trips', () => {
        const entity = createStableId(input);
        expect(parseStableId(entity, 'entity')).toBe(entity);
        expect(JSON.parse(decodeURIComponent(entity.slice('sid:1:c:'.length)))[1]).toBe(campaignId);
    });

    it('separates identical child namespaces and keys under different campaigns', () => {
        const other = createStableId({ ...campaignInput, key: 'campaign-b' });
        expect(createStableId({ ...input, campaign: other })).not.toBe(createStableId(input));
    });

    it.each([
        'legacy-campaign', ROOT_CAMPAIGN_SCOPE, createStableId(input),
        canonicalTuple('campaign', 'legacy-campaign'),
        canonicalTuple('campaign', campaignId),
        campaignId.replace('%5B', '%5b'), 'sid:1:c:%',
        'sid:1:c:["campaign","root:campaign","n","k"]',
    ])('rejects invalid canonical child scope %s in construction and parsing', scope => {
        // @ts-expect-error External strings must not silently establish canonical child ownership.
        expect(() => createStableId({ ...input, campaign: scope })).toThrow('canonical campaign ID');
        expect(parseStableId(canonicalTuple('entity', scope), 'entity')).toBeUndefined();
    });

    it('rejects compatibility references as child scope without requiring a canonical legacy mapping', () => {
        const [ref] = createCompatibilityReferences({ ...source, kind: 'campaign' }, ['legacy-campaign']);
        expect(parseCompatibilityReference(ref, 'campaign')).toBe(ref);
        // @ts-expect-error A campaign compatibility reference is not a canonical campaign ID.
        expect(() => createStableId({ ...input, campaign: ref })).toThrow('canonical campaign ID');
        expect(parseStableId(canonicalTuple('entity', ref), 'entity')).toBeUndefined();
    });
});

describe('noncanonical legacy references', () => {
    it('is repeatable but distinguishable from canonical identity', () => {
        const [ref] = createCompatibilityReferences(source, ['legacy-42']);
        expect(createCompatibilityReferences(source, ['legacy-42'])).toEqual([ref]);
        expect(ref.startsWith('sid:1:r:')).toBe(true);
        expect(parseStableId(ref, 'entity')).toBeUndefined();
        expect(parseCompatibilityReference(createStableId(input), 'entity')).toBeUndefined();
        expect(parseCompatibilityReference(ref, 'turn')).toBeUndefined();
    });

    it.each(['kind', 'campaign', 'namespace', 'family', 'version'] as const)('separates source %s', field => {
        expect(createCompatibilityReferences({ ...source, [field]: 'other' }, ['42']))
            .not.toEqual(createCompatibilityReferences(source, ['42']));
    });

    it.each(['family', 'namespace', 'version', 'campaign'] as const)('requires unambiguous %s', field => {
        expect(() => createCompatibilityReferences({ ...source, [field]: '' }, ['42'])).toThrow();
    });

    it('requires explicit valid scope and nonempty snapshot identity', () => {
        expect(() => createCompatibilityReferences({ ...source, scope: { mode: 'snapshot', snapshot: '' } }, ['42'])).toThrow();
        // @ts-expect-error Unvalidated external source must still fail at runtime.
        expect(() => createCompatibilityReferences({ ...source, scope: { mode: 'unknown' } }, ['42'])).toThrow();
    });

    it('separates snapshot generations without claiming continuity across them', () => {
        const a = createCompatibilityReferences({ ...source, scope: { mode: 'snapshot', snapshot: 'a' } }, ['42']);
        const b = createCompatibilityReferences({ ...source, scope: { mode: 'snapshot', snapshot: 'b' } }, ['42']);
        expect(a).not.toEqual(b);
        expect(a).not.toEqual(createCompatibilityReferences(source, ['42']));
        expect(parseCompatibilityReference(a[0], 'entity')).toBe(a[0]);
    });

    it('rejects duplicate legacy keys instead of merging or assigning array positions', () => {
        expect(() => createCompatibilityReferences(source, ['duplicate', 'duplicate'])).toThrow('Ambiguous duplicate legacy locator');
        expect(() => createCompatibilityReferences(source, new Array<string>(2))).toThrow();
    });

    it('does not use input order to allocate references', () => {
        const [a, b] = createCompatibilityReferences(source, ['a', 'b']);
        expect(createCompatibilityReferences(source, ['b', 'a'])).toEqual([b, a]);
    });

    it('round-trips Unicode/delimiters and rejects malformed reference fields', () => {
        const [ref] = createCompatibilityReferences({ ...source, family: 'a:b/雪' }, ['🦉:%/']);
        expect(parseCompatibilityReference(ref, 'entity')).toBe(ref);
        const malformed = (parts: unknown[]) => 'sid:1:r:' + encodeURIComponent(JSON.stringify(parts));
        for (const parts of [
            ['entity', 'c', 'n', '', 'v1', 'compatibility', '', '42'],
            ['entity', 'c', 'n', 'f', 'v1', 'snapshot', '', '42'],
            ['entity', 'c', 'n', 'f', 'v1', 'compatibility', 'unexpected', '42'],
            ['entity', 'c', 'n', 'f', 'v1', 'unknown', '', '42'],
        ]) expect(parseCompatibilityReference(malformed(parts), 'entity')).toBeUndefined();
    });
});
