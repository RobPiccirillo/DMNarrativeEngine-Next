import { lifecycleReference } from '../services/draftLifecycleService.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorldMapRuntime } from '../../public/bundled-mods/worldmap/runtime.js';
import { createPinnedWorldMapExports, createWorldMapPreparation, invalidateWorldMapBinding, pinnedWorldMapSource, installWorldMapPublication } from '../../src/services/turn/acceptance/worldmapPreparation.js';
import { departMultiHop, advance, mergeUpserts } from '../../src/services/turn/travelState';

vi.mock('../../public/bundled-mods/worldmap/renderer.js', async original => ({ ...await original(), mountMapRenderer: () => () => {} }));

afterEach(() => { invalidateWorldMapBinding(); vi.restoreAllMocks(); });
const clone = value => structuredClone(value);
const place = (id, x) => ({ id, name: id.toUpperCase(), aliases: '', kind: 'place', coordinates: { x, y: 500 }, features: [],
    connections: [{ toId: id === 'a' ? 'b' : 'a', band: 'regional' }], description: '', knowledge: 'known' });
const inputs = { now: 1700000000000, worldSeed: 'recorded-world-seed', journeyId: 'recorded-journey', transitIds: ['transit-one', 'transit-two'] };
const ref = (kind, locator = kind) => lifecycleReference('instance-one', kind, locator);
const source = kind => ({ type: 'compatibility', kind, id: ref(kind) });
const command = { binding: 'legacy-compatibility-v1', kind: 'story.accept', domainId: 'narrative-evidence', commandId: ref('command'), campaignInstance: 'instance-one', campaign: source('campaign'),
    expectedOwner: 'legacy-runtime', expectedFormatEpoch: 1, expectedVersion: { mode: 'exact', version: 'head' }, idempotency: { mode: 'command-id' }, sources: [], evidence: [],
    provenance: { origin: 'current-user-action', writerId: 'host.acceptance', turn: source('turn'), message: source('message'), source: source('revision') },
    payload: { campaignInstance: 'instance-one', revisionId: ref('revision'), setId: ref('draft'), turnReference: ref('turn'), sourceMessageId: 'user', assistantMessageId: 'assistant',
        archivedUserText: 'Wait.', expectedSelectionVersion: 'selection', expectedHead: 'head', hash: 'story-visible-v1:sha256:' + 'a'.repeat(64) } };
const payload = { campaignId: 'synthetic-worldmap', fromId: 'a', toId: 'b', worldDay: 1, mode: 'flying', expiresAt: inputs.now + 8000 };

function view(tables = {}, context = {}) {
    const writes = [], notifications = [], subscriptions = new Set(), windows = new Map();
    const state = { activeCampaignId: payload.campaignId, context: { currentPlaceId: 'a', currentFeature: null, worldDay: 1, travel: null, travelMode: 'flying', ...clone(context) },
        locationLedger: [place('a', 500), place('b', 520)] };
    state.setLocationLedger = rows => { const changed = JSON.stringify(state.locationLedger) !== JSON.stringify(rows); state.locationLedger = clone(rows); writes.push('locations'); if (changed) for (const listener of subscriptions) listener(); };
    state.updateContext = patch => { const changed = ['currentPlaceId', 'currentFeature', 'worldDay', 'travel', 'travelMode'].some(key => Object.hasOwn(patch, key) && JSON.stringify(patch[key]) !== JSON.stringify(state.context[key]));
        Object.assign(state.context, clone(patch)); writes.push('context'); if (changed) for (const listener of subscriptions) listener(); };
    const tableState = clone(tables);
    const contextView = () => ({ data: { campaignId: state.activeCampaignId, context: clone(state.context), loreChunks: [],
        location: { ...clone(state.context), ledger: clone(state.locationLedger) } }, refresh: async () => contextView(),
        table: { read: async name => clone(tableState[name] ?? null), write: async (name, value) => { tableState[name] = clone(value); writes.push(name); }, subscribe: () => () => {} },
        write: { setLocationLedger: state.setLocationLedger, updateContext: state.updateContext }, subscribe: (key, listener) => { if (key === 'location') subscriptions.add(listener); return () => subscriptions.delete(listener); },
        mounts: { window: options => { windows.set(options.id, options); return { open: () => notifications.push('open') }; }, header: () => {} }, events: { on: () => {}, emit: () => notifications.push('event') }, log: vi.fn() });
    return { state, store: { getState: () => state }, contextView, tables: tableState, writes, notifications, windows, subscriptions };
}

async function fixture(change = () => {}) {
    const live = view({ settings: { worldSeed: inputs.worldSeed, climateGradient: 0.5 } });
    const runtime = createPinnedWorldMapExports(pinnedWorldMapSource()); await runtime.onActivate(live.contextView());
    await runtime.drain();
    change(live);
    const privateView = view(live.tables, live.state.context); privateView.state.locationLedger = clone(live.state.locationLedger);
    live.writes.length = 0;
    const scope = await createWorldMapPreparation(command, inputs, privateView.store, {
        revisionId: command.payload.revisionId, hash: command.payload.hash, tables: clone(live.tables), loreChunks: [],
    });
    return { live, privateView, scope, runtime };
}

it('real shared operation uses warm private runtime with no live writes, notifications or timers', async () => {
    const { live, scope, runtime } = await fixture();
    const before = runtime.snapshotRuntime();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
        const route = await scope.route(scope.capability, command, payload);
        expect(route).toBeTruthy();
        const result = await scope.finish(scope.capability, command);
        expect(result.tables.journey.id).toBe(inputs.journeyId);
        expect(result.routes[0].result).toEqual(route);
        expect(live.writes).toEqual([]); expect(live.notifications).toEqual([]);
        expect(runtime.snapshotRuntime()).toEqual(before); expect(timers).not.toHaveBeenCalled();
    } finally { await scope.close(); }
    await expect(scope.finish(scope.capability, command)).rejects.toThrow('invalid-worldmap-preparation-capability');
});

it.each([false, true])('exact private publication avoids duplicate native consequences with map open=%s', async open => {
    const { live, scope, runtime } = await fixture();
    await scope.close();
    let dispose;
    if (open) dispose = live.windows.get('map-canvas').mount(document.createElement('div'), live.contextView());
    await runtime.drain(); await Promise.resolve();
    const published = { context: { ...live.state.context, currentPlaceId: 'b', worldDay: 10, travel: null }, messages: [
        { id: 'assistant', acceptanceBinding: { commandId: command.commandId } },
    ] };
    live.writes.length = 0;
    installWorldMapPublication(command, { head: 'accepted-head', revisionId: command.payload.revisionId, hash: command.payload.hash }, live.store, published, {}, () => {
        live.state.context = published.context;
        for (const listener of [...(live.subscriptions ?? [])]) listener();
    });
    await runtime.drain(); expect(live.writes).toEqual([]);
    live.state.updateContext({ worldDay: 11 });
    await runtime.drain(); expect(live.writes).toContain('anchors');
    dispose?.();
});

it.each(['settings-absent', 'placement', 'multi-hop', 'same-day', 'blocked', 'terrain-rejection', 'missing-destination'])('prepares the actual shared route for %s without live publication', async kind => {
    const { scope, live, privateView } = await fixture(target => {
        if (kind === 'settings-absent') delete target.tables.settings;
        if (kind === 'placement') { delete target.state.locationLedger[1].coordinates; target.state.locationLedger[1].placement = { preferredBiomes: ['plains'], biomePolicy: 'preferred' }; }
        if (kind === 'multi-hop') {
            target.state.locationLedger = [place('a', 500), place('c', 520), place('b', 540)];
            target.state.locationLedger[0].connections = [{ toId: 'c', band: 'regional' }];
            target.state.locationLedger[1].connections = [{ toId: 'a', band: 'regional' }, { toId: 'b', band: 'regional' }];
            target.state.locationLedger[2].connections = [{ toId: 'c', band: 'regional' }];
        }
        if (kind === 'same-day') target.state.locationLedger[0].connections = [{ toId: 'b', band: 'regional', passage: 'portal' }];
        if (kind === 'blocked') target.state.context.travel = { toId: 'b', leg: 1, totalLegs: 3 };
        if (kind === 'terrain-rejection') target.tables.visited = [{ x: 500, y: 500, biome: 'mountain' }, { x: 520, y: 500, biome: 'mountain' }];
    });
    const request = { ...payload, ...(kind === 'missing-destination' ? { toId: 'missing' } : {}), ...(kind === 'terrain-rejection' ? { mode: 'cart' } : {}) };
    try {
        const route = await scope.route(scope.capability, command, request);
        if (['blocked', 'terrain-rejection', 'missing-destination'].includes(kind)) expect(route).toBeNull();
        else expect(route?.length).toBeGreaterThan(0);
        if (kind === 'multi-hop') expect(route).toHaveLength(2);
        if (kind === 'same-day') expect(route[0].durationMinutes).toBe(0);
        const result = await scope.finish(scope.capability, command);
        if (kind === 'settings-absent') expect(result.tables.settings.worldSeed).toBe(inputs.worldSeed);
        if (kind === 'placement') expect(privateView.state.locationLedger[1].coordinates).toBeTruthy();
        expect(live.writes).toEqual([]); expect(live.notifications).toEqual([]);
    } finally { await scope.close(); }
});

it('revokes on completion and failed route binding, including retained references', async () => {
    const first = await fixture();
    await first.scope.finish(first.scope.capability, command);
    await expect(first.scope.route(first.scope.capability, command, payload)).rejects.toThrow('invalid-worldmap-preparation-capability');
    await first.scope.close();
    const second = await fixture();
    await expect(second.scope.route(second.scope.capability, command, { ...payload, campaignId: 'forged-campaign' })).rejects.toThrow('invalid-worldmap-route-binding');
    await expect(second.scope.finish(second.scope.capability, command)).rejects.toThrow('invalid-worldmap-preparation-capability');
    await second.scope.close();
});

it('cancellation settles private queues, rejects retained work and never serializes authority', async () => {
    const { scope, live } = await fixture();
    expect(() => JSON.stringify(scope.capability)).toThrow('nonserializable-worldmap-capability');
    expect(() => structuredClone(scope.capability)).toThrow();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const started = scope.route(scope.capability, command, payload);
    const closed = scope.close();
    const result = await Promise.allSettled([started, closed]);
    expect(result[0].status).toBe('rejected'); expect(result[1].status).toBe('fulfilled');
    await expect(scope.finish(scope.capability, command)).rejects.toThrow('invalid-worldmap-preparation-capability');
    expect(live.writes).toEqual([]); expect(timers).not.toHaveBeenCalled();
});

it('detects changed warm solver inputs before returning any publishable result', async () => {
    const { scope, runtime, live } = await fixture();
    runtime.restoreSolverInputs({ campaignId: payload.campaignId, transects: [], preference: 'safest' });
    try { await expect(scope.finish(scope.capability, command)).rejects.toThrow('worldmap-runtime-source-version-conflict'); }
    finally { await scope.close(); }
    expect(live.writes).toEqual([]);
});

it.each(['forged', 'cloned', 'wrong-command', 'disabled', 'switched', 'closed'])('rejects %s capabilities', async kind => {
    const { scope, privateView } = await fixture();
    let cap = scope.capability, bound = command;
    if (kind === 'forged') cap = {};
    if (kind === 'cloned') cap = { ...cap };
    if (kind === 'wrong-command') bound = clone(command);
    if (kind === 'disabled') invalidateWorldMapBinding();
    if (kind === 'switched') privateView.state.activeCampaignId = 'another-campaign';
    if (kind === 'closed') await scope.close();
    try { await expect(scope.route(cap, bound, payload)).rejects.toThrow('invalid-worldmap-preparation-capability'); }
    finally { await scope.close(); }
});

it('rejects module impersonation without installing a native preparation boundary', () => {
    expect(() => createPinnedWorldMapExports({ ...pinnedWorldMapSource(), 'runtime.js': 'shadow-module' })).toThrow('worldmap-source-binding-conflict');
});

it.each(['depart', 'continue', 'arrival', 'relocation', 'halt'])('matches ordinary shared persistent consequences for %s', async action => {
    const { scope, privateView, runtime, live } = await fixture();
    const ordinaryView = view(live.tables, live.state.context); ordinaryView.state.locationLedger = clone(live.state.locationLedger);
    const ordinary = createWorldMapRuntime({ snapshot: runtime.snapshotRuntime(), inputs }); await ordinary.hydrate(ordinaryView.contextView());
    const ordinaryRoute = await ordinary.storyRoute(ordinaryView.contextView(), payload);
    try {
        const route = await scope.route(scope.capability, command, payload);
        expect(route).toEqual(ordinaryRoute);
        for (const target of [ordinaryView, privateView]) {
            let nextId = 0;
            const result = departMultiHop({ fromId: 'a', toId: 'b', mode: payload.mode, hops: route, ledger: target.state.locationLedger,
                currentWorldDay: 1, recorded: { now: inputs.now, newId: () => inputs.transitIds[nextId++] } });
            if (result.ledgerUpsert) target.state.setLocationLedger(mergeUpserts(target.state.locationLedger, result.ledgerUpsert));
            target.state.updateContext(result.contextPatch);
            if (action === 'continue' || action === 'arrival') {
                do { if (!target.state.context.travel) break; target.state.updateContext(advance(target.state.context.travel, target.state.context.worldDay).contextPatch); }
                while (action === 'arrival' && target.state.context.travel);
            }
            if (action === 'relocation' || action === 'halt') target.state.updateContext({ currentPlaceId: action === 'relocation' ? 'b' : 'a', travel: null });
        }
        await ordinary.movementConsequences(ordinaryView.contextView()); await ordinary.drain();
        await scope.movement(scope.capability, command);
        const result = await scope.finish(scope.capability, command);
        for (const [name, value] of Object.entries(result.tables)) expect(value, name).toEqual(ordinaryView.tables[name]);
        expect(privateView.state.context).toEqual(ordinaryView.state.context);
        expect(privateView.state.locationLedger).toEqual(ordinaryView.state.locationLedger);
        expect(live.writes).toEqual([]);
    } finally { await scope.close(); }
});
