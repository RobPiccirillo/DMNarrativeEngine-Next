import { describe, expect, it } from 'vitest';
import {
    ROOT_CAMPAIGN_SCOPE, createStableId, parseDomainId, parseAuthorityOwnerId, parseFormatEpoch,
    transitionAuthority, isAuthorityTransitionState, projectAuthorityView, isAuthorityControlDocument,
    serializeAuthorityControl, validateAuthorityExpectation,
    createCompatibilityReferences, isSourceReference,
} from '../../index';
import type { AuthorityTransitionState, AuthorityTransitionOperation, DomainAuthorityLookup, MutationCommand, CommandKind } from '../../index';

const domainId = parseDomainId('future.items')!;
const oldOwner = parseAuthorityOwnerId('legacy')!;
const newOwner = parseAuthorityOwnerId('repository.items')!;
const epoch = parseFormatEpoch(0)!;
const campaignId = createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'test', key: 'c' });
const verification = { type: 'canonical' as const, kind: 'evidence', id: createStableId({ kind: 'evidence', campaign: campaignId, namespace: 'verification', key: 'report' }) };
const legacy = transition(undefined, { type: 'initialize', legacyOwner: oldOwner, formatEpoch: epoch });
function transition(state: AuthorityTransitionState | undefined, operation: AuthorityTransitionOperation): AuthorityTransitionState {
    const result = transitionAuthority(state, domainId, operation);
    if (result.status !== 'transitioned') throw Error(result.reason);
    return result.state;
}
function operation(state: AuthorityTransitionState, type: string, fields = {}) {
    const view = projectAuthorityView(state)!;
    return { type, expectedOwner: view.owner, expectedFormatEpoch: view.formatEpoch, ...fields };
}
function advance(state: AuthorityTransitionState, type: string, fields = {}) {
    return transition(state, operation(state, type, fields) as AuthorityTransitionOperation);
}
const shadow = advance(legacy, 'begin-shadow', { newOwner });
const verified = advance(shadow, 'verify', { verification });
const prepared = advance(verified, 'prepare-cutover');
const sqlite = advance(prepared, 'commit-cutover', { nextFormatEpoch: parseFormatEpoch(1)! });
const written = advance(sqlite, 'mark-new-owner-write');
const retired = advance(written, 'retire');
const stages = [legacy, shadow, verified, prepared, sqlite, written, retired];

const [compatibilityId] = createCompatibilityReferences({
    kind: 'evidence', campaign: 'legacy-c', namespace: 'test', family: 'verification', version: 'snapshot-1',
    scope: { mode: 'compatibility' },
}, ['report']);
const verificationForms = [verification, { type: 'compatibility' as const, kind: 'evidence', id: compatibilityId }];

describe.each(verificationForms)('closed Slice 5 verification: $type', reference => {
    it('accepts an exact reference through transition and serialization', () => {
        const next = advance(shadow, 'verify', { verification: reference });
        expect(isAuthorityTransitionState(next)).toBe(true);
        const serialized = serializeAuthorityControl({ schemaVersion: 1, campaignId, revision: 1, domains: [next] });
        const decoded = JSON.parse(serialized);
        expect(isAuthorityControlDocument(decoded)).toBe(true);
        expect(decoded.domains[0].verification).toEqual(reference);
    });
    it.each([
        { fictionalState: { hp: 7 } }, { cutoverApproved: true },
        { metadata: { nested: { ignored: false } } }, { extra: 42 },
    ])('rejects extended references in operations and every state %#', extra => {
        const extended = { ...reference, ...extra };
        // General Slice 4 references deliberately retain their approved permissive behavior.
        expect(isSourceReference(extended)).toBe(true);
        expect(transitionAuthority(shadow, domainId, operation(shadow, 'verify', { verification: extended })))
            .toEqual({ status: 'rejected', reason: 'malformed-operation' });
        for (const state of [shadow, verified, prepared, sqlite, written, retired]) {
            const invalid = { ...state, verification: extended };
            expect(isAuthorityTransitionState(invalid)).toBe(false);
            expect(projectAuthorityView(invalid)).toBeUndefined();
            const doc = { schemaVersion: 1 as const, campaignId, revision: 1, domains: [invalid] };
            expect(isAuthorityControlDocument(doc)).toBe(false);
            expect(() => serializeAuthorityControl(doc)).toThrow('Malformed authority control document');
        }
    });
});

describe('authority transition policy', () => {
    it.each(stages)('validates and projects %s', state => {
        expect(isAuthorityTransitionState(JSON.parse(JSON.stringify(state)))).toBe(true);
        const view = projectAuthorityView(state)!;
        expect(Object.keys(view).sort()).toEqual(['formatEpoch', 'owner', 'writable']);
        expect(view).toEqual({ owner: ['legacy', 'shadow'].includes(state.stage) ? oldOwner : newOwner,
            formatEpoch: state.formatEpoch, writable: state !== prepared });
    });
    it('keeps input immutable and deterministic with caller-owned verification', () => {
        const before = JSON.stringify(stages);
        Object.freeze(verified);
        expect(advance(verified, 'prepare-cutover')).toEqual(prepared);
        expect(JSON.stringify(stages)).toBe(before);
        expect(projectAuthorityView(shadow)?.owner).toBe(oldOwner);
    });
    it.each([shadow, verified, prepared])('permits abort before cutover %s', state => {
        expect(advance(state, 'abort')).toEqual(legacy);
    });
    it('permits true rollback before first new-owner write without decreasing the epoch', () => {
        const rolled = advance(sqlite, 'rollback', { nextFormatEpoch: parseFormatEpoch(2)! });
        expect(rolled).toEqual({ ...legacy, formatEpoch: 2 });
        expect(projectAuthorityView(rolled)).toEqual({ owner: oldOwner, formatEpoch: 2, writable: true });
        expect(advance(rolled, 'begin-shadow', { newOwner }).formatEpoch).toBe(2);
    });
    it('latches monotonically and forbids rollback after authoritative write or retirement', () => {
        expect(written.firstNewOwnerWrite).toBe(true);
        expect(advance(written, 'mark-new-owner-write')).toEqual(written);
        for (const state of [written, retired]) {
            expect(transitionAuthority(state, domainId, operation(state, 'rollback', { nextFormatEpoch: 3 })))
                .toEqual({ status: 'rejected', reason: 'rollback-prohibited' });
            expect(transitionAuthority(state, domainId, operation(state, 'abort')).status).toBe('rejected');
        }
    });
    it.each([
        [undefined, { type: 'verify', expectedOwner: oldOwner, expectedFormatEpoch: epoch }, 'malformed-operation'],
        [undefined, { type: 'abort', expectedOwner: oldOwner, expectedFormatEpoch: epoch }, 'uninitialized-domain'],
        [legacy, { type: 'initialize', legacyOwner: oldOwner, formatEpoch: epoch }, 'duplicate-initialization'],
        [legacy, operation(legacy, 'begin-shadow', { newOwner: oldOwner }), 'owner-mismatch'],
        [legacy, operation(legacy, 'abort'), 'wrong-stage'],
        [shadow, operation(shadow, 'prepare-cutover'), 'verification-required'],
        [shadow, operation(shadow, 'commit-cutover', { nextFormatEpoch: 1 }), 'wrong-stage'],
        [prepared, operation(prepared, 'verify', { verification }), 'wrong-stage'],
        [sqlite, operation(sqlite, 'retire'), 'wrong-stage'],
        [sqlite, operation(sqlite, 'begin-shadow', { newOwner }), 'wrong-stage'],
        [legacy, operation(legacy, 'abort', { expectedOwner: newOwner }), 'owner-mismatch'],
        [legacy, operation(legacy, 'abort', { expectedFormatEpoch: 1 }), 'epoch-mismatch'],
        [prepared, operation(prepared, 'commit-cutover', { nextFormatEpoch: 0 }), 'illegal-epoch'],
        [sqlite, operation(sqlite, 'rollback', { nextFormatEpoch: 0 }), 'illegal-epoch'],
        [sqlite, operation(sqlite, 'rollback', { nextFormatEpoch: 1 }), 'illegal-epoch'],
        [legacy, null, 'malformed-operation'], [legacy, { type: 'force' }, 'malformed-operation'],
        [legacy, operation(legacy, 'abort', { type: { toString: () => 'abort' } }), 'malformed-operation'],
        [legacy, operation(legacy, 'abort', { firstNewOwnerWrite: false }), 'malformed-operation'],
    ])('rejects illegal transition %#', (state, request, reason) => {
        expect(transitionAuthority(state as AuthorityTransitionState | undefined, domainId, request)).toEqual({ status: 'rejected', reason });
    });
    it.each([
        null, {}, { ...legacy, stage: 'verification' }, { ...legacy, legacyOwner: 'Bad' },
        { ...legacy, domainId: 'bad domain' }, { ...legacy, formatEpoch: -1 },
        { ...legacy, firstNewOwnerWrite: true }, { ...legacy, newOwner },
        { ...shadow, newOwner: oldOwner }, { ...shadow, firstNewOwnerWrite: true },
        { ...shadow, cutoverPrepared: true }, { ...sqlite, verification: null },
        { ...retired, firstNewOwnerWrite: false }, { ...sqlite, legacyAuthoritative: true },
    ])('fails closed on malformed/contradictory state %#', value => {
        expect(isAuthorityTransitionState(value)).toBe(false);
        expect(projectAuthorityView(value)).toBeUndefined();
        expect(transitionAuthority(value as AuthorityTransitionState, domainId, operation(legacy, 'abort')))
            .toEqual({ status: 'rejected', reason: 'malformed-state' });
    });
    it('allows only the documented transition matrix', () => {
        const allowed = [
            ['begin-shadow'], ['verify', 'abort'], ['verify', 'prepare-cutover', 'abort'], ['commit-cutover', 'abort'],
            ['mark-new-owner-write', 'rollback'], ['mark-new-owner-write', 'retire'], [],
        ];
        const types = ['begin-shadow', 'verify', 'prepare-cutover', 'commit-cutover', 'mark-new-owner-write', 'abort', 'rollback', 'retire'];
        stages.forEach((state, i) => types.forEach(type => {
            const fields = type === 'begin-shadow' ? { newOwner } : type === 'verify' ? { verification }
                : ['commit-cutover', 'rollback'].includes(type) ? { nextFormatEpoch: parseFormatEpoch(3)! } : {};
            expect(transitionAuthority(state, domainId, operation(state, type, fields)).status, `${i}:${type}`)
                .toBe(allowed[i].includes(type) ? 'transitioned' : 'rejected');
        }));
    });
});

describe('control document and Slice 4 projection', () => {
    const doc = { schemaVersion: 1 as const, campaignId, revision: 0, domains: stages.slice(0, 1) };
    it('roundtrips deterministically without a replay or fictional-state field', () => {
        const other = { ...legacy, domainId: parseDomainId('another.domain')! };
        const a = serializeAuthorityControl({ ...doc, domains: [legacy, other] });
        const b = serializeAuthorityControl({ ...doc, domains: [other, legacy] });
        expect(a).toBe(b);
        expect(isAuthorityControlDocument(JSON.parse(a))).toBe(true);
        expect(serializeAuthorityControl(JSON.parse(a))).toBe(a);
    });
    it.each([
        { ...doc, schemaVersion: 2 }, { ...doc, campaignId: 'raw' }, { ...doc, revision: -1 },
        { ...doc, domains: [legacy, legacy] }, { ...doc, domains: new Array(1) },
        { ...doc, domains: {} }, { ...doc, replay: [] }, { ...doc, domains: [{ ...legacy, stage: 'unknown' }] },
    ])('rejects invalid control schema %#', value => expect(isAuthorityControlDocument(value)).toBe(false));
    it.each(stages)('supports lookup and unseen command checks for %s', state => {
        const lookup: DomainAuthorityLookup = { inspect: (campaign, domain) => campaign === campaignId && domain === domainId ? projectAuthorityView(state) : undefined };
        const view = lookup.inspect(campaignId, domainId)!;
        // This helper consumes only routing expectations, not a production handler or replay store.
        const command = { expectedOwner: view.owner, expectedFormatEpoch: view.formatEpoch } as MutationCommand<CommandKind, never>;
        expect(validateAuthorityExpectation(command, view)?.status).toBe(state === prepared ? 'invalid-transition' : undefined);
        expect(validateAuthorityExpectation({ ...command, expectedOwner: view.owner === oldOwner ? newOwner : oldOwner }, view)?.status).toBe('owner-mismatch');
        expect(validateAuthorityExpectation({ ...command, expectedFormatEpoch: parseFormatEpoch(99)! }, view)?.status).toBe('invalid-transition');
        expect(lookup.inspect(campaignId, parseDomainId('unadopted')!)).toBeUndefined();
    });
});
