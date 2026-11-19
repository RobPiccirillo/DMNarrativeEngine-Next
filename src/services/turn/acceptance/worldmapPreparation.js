import { createWorldMapRuntime } from '../../../../public/bundled-mods/worldmap/runtime.js';
import sourceBinding from './worldmapSource.json';
import { isLegacyAcceptanceCommand } from '@narrative/engine/contracts/legacyAcceptance';
const expectedSource = Object.freeze({ ...sourceBinding });

const capabilities = new WeakMap();
let binding;
let publication;
const tables = Object.freeze(['anchors', 'settings', 'visited', 'journey', 'position', 'trails', 'discoveries', 'encounters', 'exploration']);
const summaries = new Set(['mapDiscoveries', 'mapEncounter', 'mapWorldSetting']);
const locationFields = new Set(['coordinates', 'recordKind', 'knowledge', 'placement', 'placementIssue', 'terrainBiome', 'terrainRadius']);
const clone = value => structuredClone(value);
const fail = code => { throw new Error(code); };
const runtimeVersion = runtime => JSON.stringify(runtime.snapshotRuntime(), (key, value) => {
    if (['chunks', 'version', 'worldVersionByCampaign'].includes(key)) return undefined;
    return value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value.values()] : value;
});

export function pinnedWorldMapSource() { return { ...expectedSource }; }

export function createPinnedWorldMapExports(proof) {
    if (JSON.stringify(Object.entries(proof).sort()) !== JSON.stringify(Object.entries(expectedSource).sort())) fail('worldmap-source-binding-conflict');
    invalidateWorldMapBinding();
    const current = { active: false, context: null };
    const runtime = createWorldMapRuntime({ publishedMovement: () => publication?.binding === current
        && publication.store.getState().activeCampaignId === publication.campaignId
        && publication.store.getState().context === publication.context });
    binding = current;
    current.runtime = runtime;
    return { ...runtime, onActivate: async ctx => {
        if (binding !== current) fail('worldmap-binding-revoked');
        current.context = ctx; current.active = true;
        try { return await runtime.onActivate(ctx); }
        catch (error) { current.active = false; throw error; }
    } };
}

export function invalidateWorldMapBinding() {
    if (binding) binding.active = false;
    binding = undefined;
}

export function hasPreparedWorldMap() { return !!binding?.active; }

export async function captureWorldMapSolverInputs(campaignId) {
    if (!binding?.active) fail('worldmap-bundled-source-unavailable');
    const current = binding;
    await current.runtime.drain();
    if (binding !== current || !current.active) fail('worldmap-binding-revoked');
    return current.runtime.solverInputs(campaignId);
}

function checked(capability, command) {
    const scope = capabilities.get(capability);
    if (!scope || scope.command !== command || !scope.active || binding !== scope.binding || !binding.active
        || scope.liveCampaign() !== scope.campaignId || scope.store.getState().activeCampaignId !== scope.campaignId) {
        if (scope) scope.active = false;
        fail('invalid-worldmap-preparation-capability');
    }
    return scope;
}

export async function createWorldMapPreparation(command, inputs, store, frozen, liveCampaign = () => store.getState().activeCampaignId) {
    if (!binding?.active) fail('worldmap-bundled-source-unavailable');
    if (!isLegacyAcceptanceCommand(command) || command.payload?.campaignInstance !== command.campaignInstance
        || command.payload?.revisionId !== frozen.revisionId || command.payload?.hash !== frozen.hash
        || !Number.isSafeInteger(inputs?.now) || !inputs.worldSeed || !inputs.journeyId) fail('invalid-worldmap-preparation-binding');
    const current = binding;
    await current.runtime.drain();
    const snapshot = current.runtime.snapshotRuntime();
    const originalRuntimeVersion = runtimeVersion(current.runtime);
    const campaignId = store.getState().activeCampaignId;
    const capability = Object.freeze({ toJSON: () => fail('nonserializable-worldmap-capability') });
    const scope = { active: true, command, campaignId, binding: current, store, liveCampaign };
    capabilities.set(capability, scope);
    const originals = clone(frozen.tables), working = clone(frozen.tables), changes = {}, routes = [];
    const runtime = createWorldMapRuntime({ snapshot, inputs: clone(inputs), isolated: true });
    if (frozen.runtimeInput) {
        if (frozen.runtimeInput.campaignId !== campaignId) fail('worldmap-solver-input-binding-conflict');
        runtime.restoreSolverInputs(clone(frozen.runtimeInput));
    }
    const check = () => checked(capability, command);
    const context = () => {
        check();
        const state = store.getState();
        return { data: { campaignId, context: clone(state.context), loreChunks: clone(frozen.loreChunks),
            location: { ...clone(state.context), ledger: clone(state.locationLedger) } },
        refresh: async () => context(),
        table: {
            read: async name => { check(); if (![...tables, 'roads'].includes(name)) fail('unsupported-worldmap-read'); return clone(working[name] ?? null); },
            write: async (name, value) => { check(); if (!tables.includes(name)) fail('unsupported-worldmap-write');
                working[name] = clone(value); changes[name] = clone(value); },
        },
        write: {
            setLocationLedger: rows => {
                check(); const previous = store.getState().locationLedger;
                if (!Array.isArray(rows) || rows.length !== previous.length || rows.some((row, index) => row.id !== previous[index].id
                    || [...new Set([...Object.keys(row), ...Object.keys(previous[index])])].some(key => !locationFields.has(key)
                        && JSON.stringify(row[key]) !== JSON.stringify(previous[index][key])))) fail('unsupported-worldmap-location-write');
                store.getState().setLocationLedger(clone(rows));
            },
            updateContext: patch => { check(); if (Object.keys(patch).some(key => !summaries.has(key))) fail('unsupported-worldmap-context-write'); store.getState().updateContext(clone(patch)); },
        } };
    };
    try { await runtime.hydrate(context()); }
    catch (error) { scope.active = false; throw error; }
    const invoke = async (cap, boundCommand, work, complete = false) => {
        try { checked(cap, boundCommand); return await work(); }
        catch (error) { scope.active = false; throw error; }
        finally { if (complete) scope.active = false; }
    };
    return {
        capability,
        route: (cap, boundCommand, payload) => invoke(cap, boundCommand, async () => {
            if (payload.campaignId !== campaignId || payload.fromId !== store.getState().context.currentPlaceId
                || payload.worldDay !== store.getState().context.worldDay) fail('invalid-worldmap-route-binding');
            const result = await runtime.storyRoute(context(), clone(payload)); routes.push({ request: clone(payload), result: clone(result) }); return result; }),
        movement: (cap, boundCommand) => invoke(cap, boundCommand, async () => { await runtime.movementConsequences(context()); await runtime.drain(); }),
        finish: (cap, boundCommand) => invoke(cap, boundCommand, async () => {
            checked(cap, boundCommand); await runtime.drain(); check();
            if (runtimeVersion(current.runtime) !== originalRuntimeVersion) fail('worldmap-runtime-source-version-conflict');
            return JSON.parse(JSON.stringify({ format: 'worldmap-accepted-movement-v1', commandId: command.commandId, campaignInstance: command.campaignInstance,
                revisionId: frozen.revisionId, hash: frozen.hash, inputs, tables: Object.fromEntries(Object.entries(changes).filter(([name, value]) => JSON.stringify(value) !== JSON.stringify(originals[name]))),
                routes, solverAfter: runtime.solverInputs(campaignId),
            }));
        }, true),
        close: async () => { scope.active = false; await Promise.allSettled([runtime.drain()]); },
    };
}

export function installWorldMapPublication(command, outcome, store, state, tables, install) {
    if (publication) fail('worldmap-publication-in-progress');
    if (!isLegacyAcceptanceCommand(command) || outcome.revisionId !== command.payload.revisionId || outcome.hash !== command.payload.hash
        || !outcome.head || !state.messages.some(message => message.id === command.payload.assistantMessageId && message.acceptanceBinding?.commandId === command.commandId)) fail('invalid-worldmap-publication');
    const campaignId = store.getState().activeCampaignId;
    if (outcome.worldmapProjection) binding?.runtime.installRecordedProjection(campaignId,
        Object.fromEntries(Object.entries(tables).filter(([name]) => name.startsWith('mod.worldmap.')).map(([name, value]) => [name.slice('mod.worldmap.'.length), value])), outcome.worldmapProjection);
    publication = { binding, command, campaignId, context: state.context, store };
    try { return install(); } finally { publication = undefined; }
}
