import { useAppStore } from '../../../store/useAppStore';
import { normalizeInventoryItem } from '../../../types';
import type { ChatMessage, GameContext, NPCEntry, LocationEntry, LocationSuggestion, NpcSuggestion, ArchiveIndexEntry, ArchiveChapter } from '../../../types';
import type { TurnState, TurnCallbacks } from '../turnOrchestrator';
import type { TurnEffectAdapter } from './effectAdapter';
import { normalizeRelations } from '../../npc/relationDedupe';
import { dedupeNPCLedger } from '../../../store/slices/campaignSlice';
import { createTableSlice } from '../../tables/genericAccessor';
import { locationTableDescriptor } from '../../tables/locationTable';
import { backgroundQueue } from '../../infrastructure/backgroundQueue';
import { api } from '../../llm/apiClient';
import { runPostTurnPipeline } from '../postTurnPipeline';
import { buildHostFacade, hasHostModelRole } from '../hostFacade';
import { classifySceneStakes } from '../sceneStakesTag';
import { tierAllows } from '../aiTier';
import { resolveInferencePolicy } from '../../inference/inferencePolicy';
import { shouldCondense, computeTrimIndex, getCondenseBudgetRatio } from '../../archive-memory/condenser';
import { createWorldMapPreparation, hasPreparedWorldMap } from './worldmapPreparation.js';
import type { WorldMapInputs, WorldMapPreparation } from './worldmapPreparation.js';
import { movementPositionKey } from '../storyMovement';
import { recordedTurnInputs } from './recordedTurnInputs';

type StoreState = ReturnType<typeof useAppStore.getState>;
export interface AcceptancePreparation {
    ticketId: string;
    command: import('@narrative/engine/contracts/legacyAcceptance').LegacyAcceptanceCommand;
    preview: { sceneId: string; block: string; index: ArchiveIndexEntry[]; chapters: ArchiveChapter[] };
    chapterSeal: { sealedChapter: ArchiveChapter; newOpenChapter: ArchiveChapter } | null;
    state: { context: GameContext; messages: ChatMessage[]; condenser: StoreState['condenser']; bookkeepingTurnCounter?: number;
        npcSuggestions?: StoreState['npcSuggestions']; locationSuggestions?: StoreState['locationSuggestions'] };
    npcs: NPCEntry[];
    locations: LocationEntry[];
    timeline: StoreState['timeline'];
    divergence: StoreState['divergenceRegister'];
    relationships: { npcToMc: StoreState['relationshipMemoriesNpcToMc']; npcToNpc: StoreState['relationshipMemoriesNpcToNpc'] };
    modTables: Record<string, unknown>;
    worldmapInputs: WorldMapInputs;
    loreChunks: StoreState['loreChunks'];
    runtimeInput?: unknown;
    resumed?: boolean;
    generationPosition?: string | null;
    turnInputs?: import('./recordedTurnInputs').RecordedTurnInputs;
}

const clone = <T>(value: T): T => structuredClone(value);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export async function prepareTurnEffects(preparation: AcceptancePreparation, original: TurnState, messages: ChatMessage[], story: string) {
    const live = useAppStore.getState(), initialMessages = clone(preparation.state.messages), notifications: (() => void)[] = [];
    if (!equal(preparation.state.context, live.context)) throw new Error('acceptance-live-context-source-conflict');
    const readLiveVersion = () => {
        const current = useAppStore.getState();
        return JSON.stringify([current.activeCampaignId, current.context, current.messages, current.locationLedger, current.npcLedger,
            current.loreChunks, current.modTables, current.settings]);
    };
    const liveVersion = readLiveVersion();
    const recorded = preparation.turnInputs ? recordedTurnInputs(preparation.turnInputs) : undefined;
    let revoked = false;
    let requiredWriterFailure: Error | undefined;
    const jobs: Promise<void>[] = [], jobStatus: { label: string; status: string }[] = [];
    const data = { ...live, context: clone(preparation.state.context), messages: clone(initialMessages), npcLedger: clone(preparation.npcs),
        locationLedger: clone(preparation.locations), modTables: clone(preparation.modTables), archiveIndex: clone(original.archiveIndex),
        timeline: clone(preparation.timeline), chapters: clone(original.chapters), divergenceRegister: clone(preparation.divergence ?? live.divergenceRegister),
        condenser: clone(preparation.state.condenser), bookkeepingTurnCounter: preparation.state.bookkeepingTurnCounter ?? live.bookkeepingTurnCounter,
        relationshipMemoriesNpcToMc: clone(preparation.relationships.npcToMc), relationshipMemoriesNpcToNpc: clone(preparation.relationships.npcToNpc),
        relationshipMemoryFaults: clone(live.relationshipMemoryFaults), npcSuggestions: clone(preparation.state.npcSuggestions ?? live.npcSuggestions), locationSuggestions: clone(preparation.state.locationSuggestions ?? live.locationSuggestions),
    };
    const check = () => { if (revoked) throw new Error('acceptance-preparation-revoked'); };
    const locations = createTableSlice<LocationEntry[]>(locationTableDescriptor, []);
    // Hydration normalizes legacy data before the checked starting-state save.
    // Preparing a patch must not run migration again and allocate dice/item IDs.
    const updateContext = (patch: Partial<GameContext>) => { check(); data.context = { ...data.context, ...clone(patch) }; };
    const updateNPC = (id: string, patch: Partial<NPCEntry>) => {
        check();
        const next = patch.relations && Object.keys(patch.relations).length ? { ...patch, relations: normalizeRelations(patch.relations, data.npcLedger, data.playerCharacter?.id) } : patch;
        data.npcLedger = data.npcLedger.map(npc => npc.id === id ? { ...npc, ...clone(next) } : npc);
    };
    const mutations: Partial<StoreState> = {
        updateContext, updateNPC,
        setModTable: (name, value) => {
            check();
            if (!Object.hasOwn(preparation.modTables, name) || name.startsWith('mod.worldmap.')) {
                requiredWriterFailure = new Error(`unscoped-acceptance-table:${name}`); throw requiredWriterFailure;
            }
            data.modTables = { ...data.modTables, [name]: clone(value) };
        },
        addMessage: message => { check(); data.messages.push(clone(message)); },
        updateLastAssistant: content => { check(); const message = [...data.messages].reverse().find(message => message.role === 'assistant'); if (message) message.content = content; },
        updateLastMessage: patch => { check(); Object.assign(data.messages.at(-1) ?? {}, clone(patch)); },
        updateLastAssistantMessage: patch => { check(); Object.assign([...data.messages].reverse().find(message => message.role === 'assistant') ?? {}, clone(patch)); },
        addNPC: npc => { check(); data.npcLedger = dedupeNPCLedger([...data.npcLedger, clone(npc)], data.playerCharacter?.id); },
        archiveNPC: (id, turn, reason) => updateNPC(id, { archived: true, archivedAtTurn: turn, archivedReason: reason }),
        restoreNPC: id => updateNPC(id, { archived: false, archivedAtTurn: undefined, archivedReason: undefined }),
        setOnStageNpcIds: ids => { check(); data.onStageNpcIds = [...ids]; },
        setArchiveIndex: index => { check(); data.archiveIndex = clone(index); },
        setTimeline: timeline => { check(); data.timeline = clone(timeline); },
        setChapters: chapters => { check(); data.chapters = clone(chapters); },
        setDivergenceRegister: register => { check(); data.divergenceRegister = clone(register); },
        setLocationLedger: ledger => { check(); data.locationLedger = locations.set(data.locationLedger, clone(ledger)).field; },
        addLocation: location => { check(); data.locationLedger = locations.add(data.locationLedger, clone(location)).field; },
        updateLocation: (id, patch) => { check(); data.locationLedger = locations.update(data.locationLedger, id, clone(patch)).field; },
        updatePlayerCharacter: patch => { check(); if (data.playerCharacter) { data.playerCharacter = { ...data.playerCharacter, ...clone(patch) }; updateContext({ playerCharacter: data.playerCharacter }); } },
        setCharacterProfileData: profile => { check(); data.characterProfileData = clone(profile); updateContext({ characterProfileData: profile }); },
        setInventoryItems: items => { check(); const normalized = items.map(normalizeInventoryItem); data.inventoryItems = normalized; updateContext({ inventoryItems: normalized }); },
        incrementBookkeepingTurnCounter: () => { check(); return ++data.bookkeepingTurnCounter; },
        resetBookkeepingTurnCounter: () => { check(); data.bookkeepingTurnCounter = 0; },
        setCondensed: index => { check(); data.condenser = { ...data.condenser, condensedUpToIndex: index }; },
        addNpcSuggestions: (names, context) => {
            check(); const known = new Set(data.npcSuggestions.map(suggestion => suggestion.name.toLowerCase())); const now = recorded?.now ?? Date.now();
            const fresh: NpcSuggestion[] = [];
            for (const raw of names) {
                const name = raw.trim(), key = name.toLowerCase();
                if (!name || known.has(key) || data.npcLedger.some(npc => [npc.name, ...(npc.aliases ?? '').split(',')].some(alias => {
                    const lower = alias.trim().toLowerCase(); return lower === key || lower.startsWith(key + ' ') || lower.endsWith(' ' + key);
                }))) continue;
                known.add(key); fresh.push({ name, context, firstSeen: now });
            }
            data.npcSuggestions.push(...fresh);
        },
        addLocationSuggestions: suggestions => {
            check(); const known = new Set([...data.locationSuggestions.map(suggestion => suggestion.name.toLowerCase()),
                ...data.locationLedger.flatMap(location => [location.name.toLowerCase(), ...location.aliases.split(',').map(alias => alias.trim().toLowerCase())])]);
            const fresh: LocationSuggestion[] = [];
            for (const suggestion of suggestions) { const name = suggestion.name.trim(), key = name.toLowerCase(); if (!name || known.has(key)) continue; known.add(key); fresh.push({ ...suggestion, name }); }
            data.locationSuggestions.push(...fresh);
        },
        setPipelinePhase: () => {}, setLastPayloadTrace: () => {},
    };
    const stateView = new Proxy(data, { get(target, key: keyof StoreState) {
        if (Object.hasOwn(mutations, key)) return mutations[key];
        const value = target[key];
        if (typeof value === 'function' && !String(key).startsWith('getActive')) return () => {
            requiredWriterFailure = new Error(`unscoped-acceptance-method:${String(key)}`); throw requiredWriterFailure;
        };
        return value;
    } }) as StoreState;
    const effectStore = { getState: () => stateView, setState: (patch: Partial<StoreState>) => { check(); Object.assign(data, clone(patch)); }, subscribe: () => () => {} } as TurnEffectAdapter['store'];
    let index = clone(preparation.preview.index), chapters = clone(preparation.preview.chapters);
    const io: typeof api = { ...api, archive: { ...api.archive,
        append: async (_id, _user, _story, importance) => { check(); if (importance !== undefined) index[index.length - 1].importance = importance; return { sceneId: preparation.preview.sceneId }; },
        getIndex: async () => clone(index),
        patchEvents: async (_id, patches) => { check(); index = index.map(entry => { const patch = patches.find(patch => patch.sceneId === entry.sceneId); return patch ? { ...entry, events: patch.events } : entry; }); },
        patchWitnesses: async (_id, patches) => { check(); index = index.map(entry => { const patch = patches.find(patch => patch.sceneId === entry.sceneId); return patch ? { ...entry, ...patch, witnessSource: patch.witnessSource as ArchiveIndexEntry['witnessSource'] } : entry; }); },
        fetchScenes: async (id, sceneIds) => [...await api.archive.fetchScenes(id, sceneIds.filter(scene => scene !== preparation.preview.sceneId)),
            ...(sceneIds.includes(preparation.preview.sceneId) ? [{ sceneId: preparation.preview.sceneId, content: preparation.preview.block }] : [])],
    }, timeline: { ...api.timeline, get: async () => clone(data.timeline) }, chapters: { ...api.chapters,
        list: async () => clone(chapters), update: async (_id, chapterId, patch) => { check(); chapters = chapters.map(chapter => chapter.chapterId === chapterId ? { ...chapter, ...clone(patch) } : chapter); return clone(chapters.find(chapter => chapter.chapterId === chapterId)); },
        seal: async () => { check(); const result = preparation.chapterSeal; if (!result) return undefined;
            chapters = chapters.map(chapter => chapter.chapterId === result.sealedChapter.chapterId ? clone(result.sealedChapter) : chapter); chapters.push(clone(result.newOpenChapter)); return clone(result); },
    } };
    const adapter: TurnEffectAdapter = {
        recorded,
        generationPosition: preparation.generationPosition,
        ...(preparation.resumed ? { modelCall: async () => {
            jobStatus.push({ label: 'interrupted-acceptance-model-work', status: 'incomplete' });
            throw new Error('optional-acceptance-work-interrupted');
        } } : {}),
        watch: (promises, required = true) => { for (const promise of promises) jobs.push(promise.catch(error => {
            if (required) requiredWriterFailure = error;
            else jobStatus.push({ label: 'optional-post-commit-track', status: 'incomplete' });
        })); },
        failRequiredWriter: writer => { requiredWriterFailure = new Error(`unsupported-required-acceptance-writer:${writer}`); throw requiredWriterFailure; },
        store: effectStore, api: io, notify: notification => notifications.push(notification),
        enqueue: (label, work, model) => {
            if (preparation.resumed && model) { jobStatus.push({ label, status: 'incomplete' }); return Promise.resolve(); }
            const status = { label, status: 'dispatched' }; jobStatus.push(status);
            const promise = (model ? backgroundQueue.pushModel(label, work) : backgroundQueue.push(label, work))
                .then(() => { status.status = 'produced'; }, error => { status.status = 'incomplete'; throw error; });
            jobs.push(promise); return promise;
        },
        readRelationships: () => data,
        writeRelationships: patch => { check(); Object.assign(data, clone(patch)); },
        saveRelationships: async (_id, value) => { check(); data.relationshipMemoriesNpcToMc = clone(value.npcToMc); data.relationshipMemoriesNpcToNpc = clone(value.npcToNpc); },
        saveDivergence: async (_id, value) => { check(); data.divergenceRegister = clone(value); },
    };
    const callbacks = Object.fromEntries(Object.entries(mutations).map(([key, value]) => [key, value])) as unknown as TurnCallbacks;
    Object.assign(callbacks, { onCheckingNotes: () => {}, setStreaming: () => {}, getFreshLocationState: () => ({ activeCampaignId: data.activeCampaignId, context: data.context, locationLedger: data.locationLedger }) });
    const state: TurnState = { ...original, context: data.context, npcLedger: data.npcLedger, effectAdapter: adapter, messages: clone(messages), getMessages: () => clone(messages),
        getFreshContext: () => data.context, setChapters: stateView.setChapters, incrementBookkeepingTurnCounter: stateView.incrementBookkeepingTurnCounter,
        resetBookkeepingTurnCounter: stateView.resetBookkeepingTurnCounter };
    const facade = buildHostFacade(state, callbacks, { reactiveStore: effectStore, modelCall: adapter.modelCall });
    let worldmap: WorldMapPreparation | undefined;
    if (hasPreparedWorldMap()) {
        worldmap = await createWorldMapPreparation(preparation.command, preparation.worldmapInputs, effectStore, {
            revisionId: preparation.command.payload.revisionId, hash: preparation.command.payload.hash,
            tables: Object.fromEntries(Object.entries(preparation.modTables).filter(([name]) => name.startsWith('mod.worldmap.')).map(([name, value]) => [name.slice('mod.worldmap.'.length), value])),
            loreChunks: preparation.loreChunks, runtimeInput: preparation.runtimeInput,
        }, () => useAppStore.getState().activeCampaignId);
        let idIndex = 0;
        adapter.movement = {
            route: (context, toId, mode) => worldmap!.route(worldmap!.capability, preparation.command, { campaignId: data.activeCampaignId!, fromId: context.currentPlaceId ?? null,
                toId, mode, worldDay: context.worldDay ?? 1, expiresAt: preparation.worldmapInputs.now + 8000 }),
            recorded: { now: preparation.worldmapInputs.now, newId: () => {
                const id = preparation.worldmapInputs.transitIds[idIndex++]; if (!id) throw new Error('recorded-transit-ids-exhausted'); return id;
            } },
        };
    }
    const selected = preparation.command.payload, revision = live.draftLifecycle?.document?.sets.find(set => set.id === selected.setId)?.revisions.find(revision => revision.id === selected.revisionId);
    let stakes = revision?.metadata?.sceneStakes ?? 'calm';
    if (!preparation.resumed && !revision?.metadata?.tagPresent && !resolveInferencePolicy(state.settings).constrained && tierAllows(state.settings.aiTier, 'sceneStakesClassify') && hasHostModelRole(facade, 'utility')) {
        try { const recent = messages.slice(-3).map(message => `[${message.role === 'assistant' ? 'GM' : message.role.toUpperCase()}]: ${(message.content ?? '').slice(0, 500)}`).join('\n\n');
            stakes = await classifySceneStakes(undefined, recent + '\n\n' + story.slice(0, 1000), (prompt, request) => facade.model.call('utility', { prompt, ...request }).then(result => result.content));
        } catch { stakes = revision?.metadata?.sceneStakes ?? 'calm'; }
    }
    updateContext({ lastSceneStakes: stakes });
    try {
        const result = await runPostTurnPipeline(state, callbacks, story, messages);
        if (requiredWriterFailure) throw requiredWriterFailure;
        if (!result.archived) throw new Error('private-archive-preparation-failed');
        let count = 0;
        while (count < jobs.length) { const pending = jobs.slice(count); count = jobs.length; await Promise.allSettled(pending); }
        if (requiredWriterFailure) throw requiredWriterFailure;
        if (worldmap && (movementPositionKey(preparation.state.context) !== movementPositionKey(data.context) || !equal(preparation.locations, data.locationLedger))) {
            await worldmap.movement(worldmap.capability, preparation.command);
        }
        const worldmapResult = worldmap ? await worldmap.finish(worldmap.capability, preparation.command) : undefined;
        if (state.settings.autoCondenseEnabled && shouldCondense(messages, state.settings.contextLimit, state.condenser.condensedUpToIndex, getCondenseBudgetRatio(state.settings.condenseAggressiveness ?? 'smart'))) {
            stateView.setCondensed(computeTrimIndex(messages, state.condenser.condensedUpToIndex));
        }
        const contextPatch = Object.fromEntries(Object.entries(data.context).filter(([key, value]) => !equal(value, preparation.state.context[key as keyof GameContext])));
        if (readLiveVersion() !== liveVersion) throw new Error('acceptance-working-input-source-conflict');
        const bundle = JSON.parse(JSON.stringify({ groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'],
            contextPatch, index, chapters, bookkeepingTurnCounter: data.bookkeepingTurnCounter, onStageNpcIds: data.onStageNpcIds, condenser: data.condenser,
            ...(equal(data.npcLedger, preparation.npcs) ? {} : { npcs: data.npcLedger }), ...(equal(data.locationLedger, preparation.locations) ? {} : { locations: data.locationLedger }),
            ...(equal(data.divergenceRegister, preparation.divergence ?? live.divergenceRegister) ? {} : { divergence: data.divergenceRegister }),
            ...(equal(data.relationshipMemoriesNpcToMc, preparation.relationships.npcToMc) ? {} : { relationshipNpcToMc: data.relationshipMemoriesNpcToMc }),
            ...(equal(data.relationshipMemoriesNpcToNpc, preparation.relationships.npcToNpc) ? {} : { relationshipNpcToNpc: data.relationshipMemoriesNpcToNpc }),
            modTables: Object.fromEntries(Object.entries(data.modTables).filter(([key, value]) => !equal(value, preparation.modTables[key]))),
            messages: data.messages.filter(message => !initialMessages.some(original => original.id === message.id)),
            npcSuggestions: data.npcSuggestions, locationSuggestions: data.locationSuggestions, optionalWork: jobStatus,
            ...(worldmapResult ? { worldmap: worldmapResult } : {}) }));
        return { bundle, notifications };
    } finally {
        revoked = true;
        await worldmap?.close();
        let settled = 0;
        while (settled < jobs.length) { const pending = jobs.slice(settled); settled = jobs.length; await Promise.allSettled(pending); }
    }
}
