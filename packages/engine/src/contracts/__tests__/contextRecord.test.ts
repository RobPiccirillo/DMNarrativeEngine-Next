import { describe, expect, it } from 'vitest';
import {
    ROOT_CAMPAIGN_SCOPE, createStableId, createCompatibilityReferences, isContextRecord,
    parseContentVersion, parseStableId, parseDomainId, parseAuthorityOwnerId, parseFormatEpoch,
    transitionAuthority, projectAuthorityView, validateAuthorityExpectation,
} from '../../index';
import type { AuthorityTransitionState, AuthorityTransitionOperation, ContextRecord, MutationCommand, CommandKind } from '../../index';

const campaign = createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'closure', key: 'campaign' });
const entity = createStableId({ kind: 'entity', campaign, namespace: 'closure', key: 'entity' });
const [compatibility] = createCompatibilityReferences({
    kind: 'entity', campaign: 'legacy-c', namespace: 'closure', family: 'entities', version: 'immutable-import-1', scope: { mode: 'compatibility' },
}, ['entity']);
const classification = { authority: 'tracked-state', trust: 'tracked-state', legacyStatus: 'transitional-legacy' } as const;
const contentGuard = (value: unknown): value is { hp: number } => typeof value === 'object' && value !== null && 'hp' in value && typeof value.hp === 'number';
const compatibilityRecord: ContextRecord<'entity', { hp: number }> = {
    reference: { type: 'compatibility', kind: 'entity', id: compatibility },
    sourceVersion: parseContentVersion('source-head-1')!, classification, content: { hp: 7 },
};

describe('versioned read-only context contract integration', () => {
    it.each([
        compatibilityRecord,
        { ...compatibilityRecord, reference: { type: 'canonical', kind: 'entity', id: entity } },
    ])('accepts classified source projections without upgrading compatibility identity %#', value => {
        const decoded: unknown = JSON.parse(JSON.stringify(value));
        if (!isContextRecord(decoded, 'entity', contentGuard)) throw Error('invalid projection');
        const hp: number = decoded.content.hp;
        expect(hp).toBe(7);
        expect(decoded.sourceVersion).toBe('source-head-1');
        expect(parseStableId(decoded.reference.id, 'entity')).toBe(decoded.reference.type === 'canonical' ? entity : undefined);
    });
    it.each([undefined, '', null, 1])('requires an explicit valid source version %#', sourceVersion => {
        expect(isContextRecord({ ...compatibilityRecord, sourceVersion }, 'entity', contentGuard)).toBe(false);
    });
    it('rejects a missing citation, raw identity or invalid payload/classification', () => {
        const { sourceVersion: _version, ...uncited } = compatibilityRecord;
        void _version;
        expect(isContextRecord(uncited, 'entity', contentGuard)).toBe(false);
        for (const invalid of [
            { ...compatibilityRecord, reference: { type: 'canonical', kind: 'entity', id: 'legacy-id' } },
            { ...compatibilityRecord, reference: { type: 'canonical', kind: 'entity', id: compatibility } },
            { ...compatibilityRecord, classification: { ...classification, trust: 'canonical-evidence' } },
            { ...compatibilityRecord, content: { hp: '7' } },
        ]) expect(isContextRecord(invalid, 'entity', contentGuard)).toBe(false);
    });
    it('keeps a cited compatibility projection read-only metadata across an ownership cutover', () => {
        const domainId = parseDomainId('future.character')!;
        const legacyOwner = parseAuthorityOwnerId('legacy')!;
        const newOwner = parseAuthorityOwnerId('future.repository')!;
        const initial = transitionAuthority(undefined, domainId, { type: 'initialize', legacyOwner, formatEpoch: parseFormatEpoch(0)! });
        if (initial.status !== 'transitioned') throw Error('invalid initialization');
        let state: AuthorityTransitionState = initial.state;
        const before = JSON.stringify(compatibilityRecord);
        for (const operation of [
            { type: 'begin-shadow', newOwner },
            { type: 'verify', verification: compatibilityRecord.reference },
            { type: 'prepare-cutover' }, { type: 'commit-cutover', nextFormatEpoch: parseFormatEpoch(1)! },
        ]) {
            const view = projectAuthorityView(state)!;
            const next = transitionAuthority(state, domainId, { ...operation, expectedOwner: view.owner, expectedFormatEpoch: view.formatEpoch } as AuthorityTransitionOperation);
            if (next.status !== 'transitioned') throw Error(next.reason);
            state = next.state;
        }
        const view = projectAuthorityView(state)!;
        const prepared = { expectedOwner: legacyOwner, expectedFormatEpoch: parseFormatEpoch(0)! } as MutationCommand<CommandKind, never>;
        expect(validateAuthorityExpectation(prepared, view)?.status).toBe('owner-mismatch');
        expect(validateAuthorityExpectation({ ...prepared, expectedOwner: newOwner }, view)?.status).toBe('invalid-transition');
        expect(isContextRecord(compatibilityRecord, 'entity', contentGuard)).toBe(true);
        expect(JSON.stringify(compatibilityRecord)).toBe(before);
        expect(parseStableId(compatibilityRecord.reference.id, 'entity')).toBeUndefined();
    });
});
