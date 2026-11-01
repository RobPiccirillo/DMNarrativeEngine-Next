import { describe, expect, it } from 'vitest';
import {
    ROOT_CAMPAIGN_SCOPE, createStableId, createCompatibilityReferences, getStableIdCampaign,
    parseDomainId, parseCommandKind, parseAuthorityOwnerId, parseWriterId, parseFormatEpoch,
    parseContentVersion, parseIdempotencyKey, MUTATION_ORIGINS, isMutationProvenance,
    isSourceReference, isVersionPrecondition, isIdempotency, isMutationCommand,
    matchesVersion, validateAuthorityExpectation,
} from '../../index';
import type {
    MutationCommand, MutationResult, DomainAuthorityRouter, DomainAuthorityLookup,
    AuthorityView, ContentVersion, SourceReference,
} from '../../index';

const campaignId = createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'test', key: 'c' });
const kind = parseCommandKind('fixture.item.add')!;
const domainId = parseDomainId('fixture.inventory')!;
const owner = parseAuthorityOwnerId('fixture.owner')!;
const epoch = parseFormatEpoch(1)!;
const v1 = parseContentVersion('revision:1')!;
type Payload = { amount: number };
type Command = MutationCommand<typeof kind, Payload>;
function child<K extends string>(kind: K, key = 'one') {
    return createStableId({ kind, campaign: campaignId, namespace: 'test', key });
}
function canonical<K extends string>(kind: K): SourceReference<K> {
    return { type: 'canonical', kind, id: child(kind) };
}
function isPayload(value: unknown): value is Payload {
    return typeof value === 'object' && value !== null && 'amount' in value
        && typeof value.amount === 'number' && Number.isSafeInteger(value.amount);
}
function command(overrides: Partial<Command> = {}): Command {
    return {
        commandId: child('command'), campaignId, domainId, kind,
        provenance: { origin: 'current-user-action' }, expectedOwner: owner,
        expectedFormatEpoch: epoch, expectedVersion: { mode: 'none' },
        idempotency: { mode: 'command-id' }, payload: { amount: 2 }, ...overrides,
    };
}
const valid = (value: unknown) => isMutationCommand(value, kind, isPayload);

describe('mutation vocabulary', () => {
    it.each([parseCommandKind, parseAuthorityOwnerId, parseWriterId])('validates extensible identifiers %s', parse => {
        expect(parse('future.repository-2.patch')).toBe('future.repository-2.patch');
        for (const bad of ['', ' ', 'Upper', '.bad', 'a..b', 'a_b', 1, null, undefined, '\ud800']) expect(parse(bad)).toBeUndefined();
    });
    it.each([0, 1, Number.MAX_SAFE_INTEGER])('round trips ordered format epoch %s', value => {
        expect(parseFormatEpoch(JSON.parse(JSON.stringify(value)))).toBe(value);
    });
    it.each([-1, -0, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null, undefined])('rejects malformed epoch %s', value => {
        expect(parseFormatEpoch(value)).toBeUndefined();
    });
    it('compares epochs independently from opaque content versions', () => {
        expect(parseFormatEpoch(2)! > epoch).toBe(true);
        expect(parseContentVersion('owner-defined:abc/2')).toBe('owner-defined:abc/2');
    });
    it.each([parseContentVersion, parseIdempotencyKey])('preserves explicit tokens without allocating/normalizing %s', parse => {
        expect(parse(' caller token ')).toBe(' caller token ');
        for (const bad of ['', ' ', 1, null, undefined, '\ud800']) expect(parse(bad)).toBeUndefined();
    });
});

describe('mutation envelopes and provenance', () => {
    it('validates typed construction and serialized roundtrip without changing input', () => {
        const input = command({ sources: [canonical('revision')], evidence: [canonical('evidence')] });
        const before = JSON.stringify(input);
        expect(valid(input)).toBe(true);
        const decoded: unknown = JSON.parse(before);
        if (!isMutationCommand(decoded, kind, isPayload)) throw Error('invalid fixture');
        const amount: number = decoded.payload.amount;
        expect(amount).toBe(2);
        expect(JSON.stringify(input)).toBe(before);
        expect(input.provenance).not.toHaveProperty('timestamp');
    });
    it.each(MUTATION_ORIGINS)('preserves distinct origin %s', origin => {
        const provenance = { origin, writerId: parseWriterId('fixture.writer')! };
        expect(valid(command({ provenance }))).toBe(true);
        expect(JSON.parse(JSON.stringify(provenance))).toEqual(provenance);
    });
    it('supports explicit identities, references and caller timestamp', () => {
        expect(isMutationProvenance({
            origin: 'model-derived', actor: canonical('entity'), source: canonical('revision'),
            turn: canonical('turn'), message: canonical('message'), modelCall: canonical('model-call'),
            importSource: canonical('evidence'), correction: canonical('annotation'),
            writerId: parseWriterId('fixture.writer'), timestamp: '2026-11-01T12:34:56.000Z',
        })).toBe(true);
    });
    it.each([
        null, {}, 'user', { origin: 'other' }, { origin: 'import', writerId: '' },
        { origin: 'import', timestamp: undefined }, { origin: 'import', timestamp: 'yesterday' },
        { origin: 'import', timestamp: '2026-02-30T00:00:00.000Z' },
        { origin: 'import', timestamp: '2026-11-01T00:00:00Z' },
        { origin: 'import', turn: canonical('entity') }, { origin: 'import', message: canonical('turn') },
        { origin: 'import', modelCall: canonical('entity') },
        ...['actor', 'source', 'importSource', 'correction'].map(field => ({ origin: 'import', [field]: 'raw' })),
    ])('rejects malformed provenance %#', value => expect(isMutationProvenance(value)).toBe(false));
    it('retains compatibility references without promoting them to canonical IDs', () => {
        const [id] = createCompatibilityReferences({
            kind: 'evidence', campaign: 'old-c', namespace: 'legacy', family: 'archive', version: 'snapshot-1',
            scope: { mode: 'compatibility' },
        }, ['row-1']);
        const ref = { type: 'compatibility' as const, kind: 'evidence' as const, id };
        expect(valid(command({ evidence: [ref] }))).toBe(true);
        expect(isSourceReference({ ...ref, type: 'canonical' })).toBe(false);
        expect(isSourceReference({ ...canonical('evidence'), type: 'compatibility' })).toBe(false);
    });
    it('reads validated child campaign scope without treating root campaigns as children', () => {
        expect(getStableIdCampaign(child('command'))).toBe(campaignId);
        expect(getStableIdCampaign(campaignId)).toBeUndefined();
    });
    it.each([
        ['commandId', 'raw'], ['commandId', child('entity')], ['commandId', campaignId],
        ['campaignId', child('command')], ['campaignId', 'legacy-c'], ['domainId', 'bad domain'],
        ['kind', 'bad kind'], ['kind', 'another.kind'], ['expectedOwner', 'bad owner'],
        ['expectedFormatEpoch', '1'], ['expectedVersion', undefined], ['provenance', {}],
        ['idempotency', undefined], ['payload', { amount: '2' }], ['sources', [canonical('turn'), null]],
        ['sources', new Array(1)], ['sources', 'raw'], ['evidence', [canonical('entity')]],
        ['evidence', undefined],
    ])('rejects malformed envelope field %s %#', (field, value) => {
        expect(valid({ ...command(), [field]: value })).toBe(false);
    });
    it('rejects missing fields, nonobjects and foreign campaign command identity', () => {
        for (const field of Object.keys(command())) {
            const value: Record<string, unknown> = { ...command() };
            delete value[field];
            expect(valid(value), field).toBe(false);
        }
        for (const value of [null, [], 'raw', 0]) expect(valid(value)).toBe(false);
        const other = createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'test', key: 'other' });
        expect(valid(command({ campaignId: other }))).toBe(false);
    });
});

describe('version and idempotency semantics', () => {
    it.each([
        [{ mode: 'none' }, null, true], [{ mode: 'none' }, v1, true],
        [{ mode: 'exact', version: v1 }, v1, true], [{ mode: 'exact', version: v1 }, null, false],
        [{ mode: 'exact', version: v1 }, parseContentVersion('v2'), false],
        [{ mode: 'create-if-absent' }, null, true], [{ mode: 'create-if-absent' }, v1, false],
    ] as const)('matches explicit precondition %#', (expected, actual, result) => {
        expect(isVersionPrecondition(expected)).toBe(true);
        expect(matchesVersion(expected, actual!)).toBe(result);
    });
    it.each([null, {}, { mode: 'force' }, { mode: 'exact' }, { mode: 'exact', version: 1 },
        { mode: 'exact', version: '' }, { mode: 'none', version: v1 },
        { mode: 'create-if-absent', version: undefined }])('rejects malformed/contradictory version %#', value => {
        expect(isVersionPrecondition(value)).toBe(false);
        expect(valid({ ...command(), expectedVersion: value })).toBe(false);
    });
    it.each([{ mode: 'command-id' }, { mode: 'caller-key', key: parseIdempotencyKey('explicit-key')! }])('accepts protected idempotency %#', value => {
        expect(isIdempotency(value)).toBe(true);
    });
    it.each([null, {}, { mode: 'non-idempotent' }, { mode: 'caller-key' }, { mode: 'caller-key', key: '' },
        { mode: 'caller-key', key: 1 }, { mode: 'command-id', key: 'ignored' }])('rejects unprotected/contradictory idempotency %#', value => {
        expect(isIdempotency(value)).toBe(false);
        expect(valid({ ...command(), idempotency: value })).toBe(false);
    });
});

/** TEST ONLY: one typed capability, no writer inventory, handlers, IO or production routing table.
 * Fixed fixture payload/result and canonicalized JSON comparisons are not a production replay store.
 */
function fixture() {
    let view: AuthorityView = { owner, formatEpoch: epoch, writable: true };
    let version: ContentVersion | null = null;
    let applications = 0;
    const seen = new Map<string, {
        logicalIdentity: readonly string[]; fingerprint: string;
        appliedOwner: AuthorityView['owner']; appliedFormatEpoch: AuthorityView['formatEpoch'];
        value: { total: number }; version: ContentVersion;
    }>();
    const lookup: DomainAuthorityLookup = { inspect: (campaign, domain) => campaign === campaignId && domain === domainId ? view : undefined };
    const router: DomainAuthorityRouter<typeof kind, Payload, { total: number }> = {
        async route(input): Promise<MutationResult<{ total: number }>> {
            if (!valid(input)) return { status: 'malformed-command', reason: 'invalid-envelope' };
            const identity = input.idempotency.mode === 'command-id' ? input.commandId : input.idempotency.key;
            const logicalIdentity = [input.campaignId, input.domainId, input.idempotency.mode, identity];
            const key = JSON.stringify(logicalIdentity);
            const semantic = {
                ...input, expectedOwner: undefined, expectedFormatEpoch: undefined,
                commandId: input.idempotency.mode === 'command-id' ? input.commandId : undefined,
            };
            const fingerprint = JSON.stringify(semantic, (_, value: unknown) => {
                if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
                return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
            });
            const previous = seen.get(key);
            if (previous) return previous.fingerprint === fingerprint
                ? { status: 'duplicate', value: previous.value, version: previous.version }
                : { status: 'malformed-command', reason: 'idempotency-key-reused' };
            const rejection = validateAuthorityExpectation(input, lookup.inspect(input.campaignId, input.domainId));
            if (rejection) return rejection;
            if (!matchesVersion(input.expectedVersion, version)) return { status: 'version-conflict', actualVersion: version };
            applications++;
            version = parseContentVersion(`fixture:${applications}`)!;
            const value = { total: input.payload.amount };
            seen.set(key, { logicalIdentity, fingerprint, appliedOwner: view.owner, appliedFormatEpoch: view.formatEpoch, value, version });
            return { status: 'accepted', value, version };
        },
    };
    return { router, applications: () => applications, history: () => [...seen.values()], setView: (next: AuthorityView) => { view = next; } };
}

describe('test-only authority router contract', () => {
    it('accepts a typed command/result with the expected owner', async () => {
        const f = fixture();
        const result = await f.router.route(command());
        if (result.status !== 'accepted') throw Error('fixture rejected');
        const total: number = result.value.total;
        expect(total).toBe(2);
        expect(f.applications()).toBe(1);
    });
    it('rejects owner mismatch', async () => {
        expect(await fixture().router.route(command({ expectedOwner: parseAuthorityOwnerId('another.owner')! })))
            .toEqual({ status: 'owner-mismatch', actualOwner: owner });
    });
    it('returns unsupported domain or campaign without consulting a registry', async () => {
        expect((await fixture().router.route(command({ domainId: parseDomainId('future.domain')! }))).status).toBe('unsupported-domain');
        const other = createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'test', key: 'other' });
        const commandId = createStableId({ kind: 'command', campaign: other, namespace: 'test', key: 'one' });
        expect((await fixture().router.route(command({ campaignId: other, commandId }))).status).toBe('unsupported-domain');
    });
    it.each([false, true])('rejects unavailable transition/epoch (writable %s)', async writable => {
        const f = fixture();
        f.setView({ owner, formatEpoch: parseFormatEpoch(2)!, writable });
        expect(await f.router.route(command())).toEqual({
            status: 'invalid-transition', reason: writable ? 'format-epoch-mismatch' : 'writes-disabled', actualFormatEpoch: 2,
        });
        expect(f.applications()).toBe(0);
    });
    it('returns exact-version conflict on absent data without throwing', async () => {
        expect(await fixture().router.route(command({ expectedVersion: { mode: 'exact', version: v1 } })))
            .toEqual({ status: 'version-conflict', actualVersion: null });
    });
    it('returns conflict when creating existing data, then accepts the current exact version', async () => {
        const f = fixture();
        const result = await f.router.route(command({ expectedVersion: { mode: 'create-if-absent' } }));
        if (result.status !== 'accepted') throw Error('fixture rejected');
        expect(await f.router.route(command({ commandId: child('command', 'two'), expectedVersion: { mode: 'create-if-absent' } })))
            .toEqual({ status: 'version-conflict', actualVersion: result.version });
        expect(await f.router.route(command({ commandId: child('command', 'wrong-version'), expectedVersion: { mode: 'exact', version: v1 } })))
            .toEqual({ status: 'version-conflict', actualVersion: result.version });
        expect((await f.router.route(command({ commandId: child('command', 'three'), expectedVersion: { mode: 'exact', version: result.version } }))).status)
            .toBe('accepted');
    });
    it('replays command identity before rechecking an obsolete create precondition', async () => {
        const f = fixture();
        const input = command({ expectedVersion: { mode: 'create-if-absent' } });
        const original = await f.router.route(input);
        expect(await f.router.route(JSON.parse(JSON.stringify(input)))).toEqual({ ...original, status: 'duplicate' });
        expect(f.applications()).toBe(1);
    });
    it('replays caller keys across command IDs, preserving the original result', async () => {
        const f = fixture();
        const input = command({ idempotency: { mode: 'caller-key', key: parseIdempotencyKey('caller-1')! } });
        const original = await f.router.route(input);
        expect(await f.router.route({ ...input, commandId: child('command', 'retry') })).toEqual({ ...original, status: 'duplicate' });
        expect(f.applications()).toBe(1);
    });
    it.each(['command-id', 'caller-key'] as const)('rejects key reuse with changed request semantics (%s)', async mode => {
        const f = fixture();
        const input = command({
            idempotency: mode === 'command-id' ? { mode } : { mode, key: parseIdempotencyKey('key')! },
            sources: [canonical('revision')], evidence: [canonical('evidence')],
        });
        await f.router.route(input);
        // Rebind to the new view too: changed semantics must not become a fresh namespace.
        const nextOwner = parseAuthorityOwnerId('next.owner')!;
        const nextEpoch = parseFormatEpoch(2)!;
        f.setView({ owner: nextOwner, formatEpoch: nextEpoch, writable: true });
        for (const override of [
            { payload: { amount: 3 } }, { provenance: { origin: 'import' as const } },
            { expectedVersion: { mode: 'create-if-absent' as const } },
            { sources: [canonical('turn')] }, { evidence: [] },
        ]) {
            for (const routing of [{}, { expectedOwner: nextOwner, expectedFormatEpoch: nextEpoch }]) {
                expect(await f.router.route({ ...input, ...routing, ...override }))
                    .toEqual({ status: 'malformed-command', reason: 'idempotency-key-reused' });
            }
        }
        expect(f.applications()).toBe(1);
    });
    describe.each(['command-id', 'caller-key'] as const)('transition-safe %s replay', mode => {
        const idempotency = mode === 'command-id' ? { mode } : { mode, key: parseIdempotencyKey('transition-key')! };
        const nextOwner = parseAuthorityOwnerId('next.owner')!;
        const nextEpoch = parseFormatEpoch(2)!;
        const transitions = [
            ['owner cutover', { owner: nextOwner, formatEpoch: epoch, writable: true }],
            ['epoch advancement', { owner, formatEpoch: nextEpoch, writable: true }],
            ['owner and epoch cutover', { owner: nextOwner, formatEpoch: nextEpoch, writable: true }],
            ['writes disabled', { owner: nextOwner, formatEpoch: nextEpoch, writable: false }],
        ] as const;
        it.each(transitions)('recovers original outcome after %s', async (_, view) => {
            const f = fixture();
            const input = command({ idempotency, expectedVersion: { mode: 'create-if-absent' } });
            const original = await f.router.route(input);
            expect(original.status).toBe('accepted');
            f.setView(view);
            const retry = mode === 'caller-key' ? { ...input, commandId: child('command', 'retry') } : input;
            expect(await f.router.route(retry)).toEqual({ ...original, status: 'duplicate' });
            expect(f.applications()).toBe(1);
        });
        it('recovers history when routing expectations alone are rebound', async () => {
            const f = fixture();
            const input = command({ idempotency });
            const original = await f.router.route(input);
            if (original.status !== 'accepted') throw Error('fixture rejected');
            f.setView({ owner: nextOwner, formatEpoch: nextEpoch, writable: true });
            expect(await f.router.route({ ...input, expectedOwner: nextOwner, expectedFormatEpoch: nextEpoch }))
                .toEqual({ ...original, status: 'duplicate' });
            expect(f.applications()).toBe(1);
            expect(f.history()).toEqual([{
                logicalIdentity: [campaignId, domainId, mode, mode === 'command-id' ? input.commandId : input.idempotency.key],
                fingerprint: expect.any(String), appliedOwner: owner, appliedFormatEpoch: epoch,
                value: original.value, version: original.version,
            }]);
        });
        it('survives a permitted A/1 to B/2 to A/1 policy projection', async () => {
            const f = fixture();
            const input = command({ idempotency });
            const original = await f.router.route(input);
            expect(original.status).toBe('accepted');
            for (const view of [
                { owner: nextOwner, formatEpoch: nextEpoch, writable: true },
                { owner, formatEpoch: epoch, writable: true },
            ]) {
                f.setView(view);
                expect(await f.router.route(input)).toEqual({ ...original, status: 'duplicate' });
                expect(await f.router.route({ ...input, expectedOwner: view.owner, expectedFormatEpoch: view.formatEpoch }))
                    .toEqual({ ...original, status: 'duplicate' });
            }
            expect(f.applications()).toBe(1);
        });
        it('recovers A/V1 after distinct B advances the record to V2', async () => {
            const f = fixture();
            const input = command({ idempotency, expectedVersion: { mode: 'create-if-absent' } });
            const original = await f.router.route(input);
            if (original.status !== 'accepted') throw Error('fixture rejected A');
            const later = await f.router.route(command({
                commandId: child('command', 'later'), payload: { amount: 9 },
                expectedVersion: { mode: 'exact', version: original.version },
                idempotency: mode === 'command-id' ? { mode } : { mode, key: parseIdempotencyKey('later-key')! },
            }));
            if (later.status !== 'accepted') throw Error('fixture rejected B');
            expect(later.version).not.toBe(original.version);
            expect(later.value).not.toEqual(original.value);
            expect(await f.router.route(input)).toEqual({ ...original, status: 'duplicate' });
            expect(f.applications()).toBe(2);
        });
        it('retains stale owner/epoch protection for unseen logical identities', async () => {
            const f = fixture();
            const input = command({ idempotency });
            const original = await f.router.route(input);
            expect(original.status).toBe('accepted');
            f.setView({ owner: nextOwner, formatEpoch: nextEpoch, writable: true });
            const fresh = command({
                commandId: child('command', 'fresh'),
                idempotency: mode === 'command-id' ? { mode } : { mode, key: parseIdempotencyKey('fresh-key')! },
            });
            expect((await f.router.route(fresh)).status).toBe('owner-mismatch');
            expect((await f.router.route({ ...fresh, expectedOwner: nextOwner })).status).toBe('invalid-transition');
            expect(f.applications()).toBe(1);
            expect((await f.router.route({ ...fresh, expectedOwner: nextOwner, expectedFormatEpoch: nextEpoch })).status).toBe('accepted');
            expect(f.applications()).toBe(2);
            // Historical A still recovers after a new application under B/2.
            expect(await f.router.route(input)).toEqual({ ...original, status: 'duplicate' });
            expect(f.applications()).toBe(2);
        });
    });
    it('returns typed malformed-command for untrusted runtime input', async () => {
        // Simulate data crossing an untyped boundary; production callers must validate too.
        const input = JSON.parse('{"payload":{"amount":2}}') as Command;
        expect(await fixture().router.route(input)).toEqual({ status: 'malformed-command', reason: 'invalid-envelope' });
    });
});
