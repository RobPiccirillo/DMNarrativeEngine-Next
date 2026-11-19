import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acceptanceCandidate } from '@narrative/engine/contracts/draftLifecycle';
import { isLegacyAcceptanceCommand } from '@narrative/engine/contracts/legacyAcceptance';
import { CAMPAIGNS_DIR, DATA_DIR, validateCampaignId } from '../lib/fileStore.js';
import { readExact, readStrictJson, byteVersion } from '../lib/durablePublication.js';
import { withCampaignLock } from '../lib/writeLock.js';
import { createLegacyAcceptanceJournal, semanticBytes } from './legacyAcceptanceJournal.js';
import { createLegacyDraftRepository } from './legacyDraftRepository.js';
import { lifecycleReference } from './draftLifecycleService.js';
import { prepareLegacyArchive, prepareLegacyChapterSeal } from './legacyArchivePreparation.js';
import { validateWorldmapMovement } from './worldmapAcceptedMovement.js';

const fail = code => { throw Object.assign(new Error(code), { code, statusCode: 409 }); };
const suffixes = Object.freeze({ archive: '.archive.md', index: '.archive.index.json', entities: '.entities.json', chapters: '.archive.chapters.json',
    state: '.state.json', npcs: '.npcs.json', locations: '.locations.json', drafts: '.drafts.json', divergence: '.divergence.json',
    timeline: '.timeline.json', relationshipNpcToMc: '.relationship-memory.npc-to-mc.json', relationshipNpcToNpc: '.relationship-memory.npc-to-npc.json' });
const protectedFields = ['pendingCommit', 'commitFailed', 'sceneId', 'draftSetId', 'selectedRevisionId', 'displayedRevisionId', 'draftHash', 'draftStatus', 'acceptanceBinding', 'swipeSet', 'swipeActiveIndex'];

export function createAcceptanceCoordinator({ directory = CAMPAIGNS_DIR, authorityDirectory = path.join(DATA_DIR, 'authority'), modTargets = () => ({}), boundary = () => {}, dispatchArchiveEmbedding } = {}) {
    const tickets = new Map();
    const file = (id, suffix) => { validateCampaignId(id); return path.join(directory, id + suffix); };
    function open(id) {
        const raw = readStrictJson(file(id, '.acceptance.json'));
        if (!raw) fail('missing-acceptance-journal');
        const storage = readStrictJson(file(id, '.drafts.json'))?.storageGuard;
        if (!storage || storage.phase !== 'ready' || storage.storageId !== id) fail('lifecycle-storage-scope-unready');
        const retainedTargets = Object.assign({}, ...raw.commands.map(command => command.frozen?.targetRegistry ?? {}));
        const targetRegistry = { ...suffixes, ...retainedTargets, ...modTargets() };
        for (const [name, suffix] of Object.entries(targetRegistry)) {
            if (Object.hasOwn(suffixes, name) && suffixes[name] !== suffix) fail('invalid-built-in-effect-target');
            if (!Object.hasOwn(suffixes, name) && (!name.startsWith('mod.') || typeof suffix !== 'string' || !/^\.mod-[a-zA-Z0-9_.-]+\.json$/.test(suffix))) fail('invalid-mod-effect-target');
        }
        const journal = createLegacyAcceptanceJournal({ directory, storageId: id, campaignInstance: raw.campaignInstance, targets: targetRegistry, allowDraftTarget: true, boundary });
        return { journal, document: journal.load(), instance: raw.campaignInstance, targetRegistry, storage };
    }
    function authority(id) {
        if (readStrictJson(path.join(authorityDirectory, id + '.authority.json')) !== null) fail('unsupported-acceptance-authority');
    }
    async function validateCandidate(id, requested, opened) {
        if (!requested || requested.campaignInstance !== opened.instance) fail('invalid-candidate-binding');
        const loaded = await createLegacyDraftRepository({ directory, storageId: id, campaignInstance: opened.instance }).load();
        if (loaded.status !== 'loaded' || loaded.document.conflicts.length) fail('draft-recovery-required');
        const set = loaded.document.sets.find(set => set.id === requested.setId);
        if (!set || set.id !== loaded.document.activeSetId) fail('stale-draft-set');
        const saved = readStrictJson(file(id, '.state.json'));
        const messages = saved?.messages?.filter(message => message.id === set.assistantMessageId) ?? [];
        const users = saved?.messages?.filter(message => message.id === set.sourceMessageId && message.role === 'user') ?? [];
        if (messages.length !== 1 || messages[0].role !== 'assistant' || users.length !== 1 || (users[0].displayContent ?? users[0].content) !== set.archivedUserText) fail('candidate-message-binding-conflict');
        const exact = acceptanceCandidate(set, messages[0].content);
        if (semanticBytes(exact) !== semanticBytes(requested)) fail('stale-selection');
        if (opened.document.head !== exact.expectedHead) fail('version-conflict');
        authority(id);
        return { set, revision: set.revisions.find(revision => revision.id === exact.revisionId), saved, drafts: loaded.document };
    }
    const historical = (opened, candidate) => opened.document.commands.find(command => semanticBytes(command.frozen.candidate) === semanticBytes(candidate));
    const result = command => ({ status: command.status === 'completed' ? 'duplicate' : 'in-progress', logicalKey: command.logicalKey, outcome: command.outcome, command: command.frozen.command });

    const preflight = (id, candidate, storageToken) => withCampaignLock(id, async () => {
        const opened = open(id), previous = historical(opened, candidate);
        if (previous) {
            if (previous.status === 'completed' || previous.effectGroup) return result(previous);
            const saved = previous.frozen.preparation;
            if (!saved) fail('missing-frozen-preparation');
            for (const [name, version] of Object.entries(saved.versions)) if (byteVersion(readExact(file(id, saved.targetRegistry[name]))) !== version) fail('prepared-source-version-conflict');
            tickets.set(saved.ticketId, { ...saved, id, command: previous.frozen.command });
            if (byteVersion(readExact(file(id, '.lore.json'))) !== saved.loreVersion) fail('prepared-source-version-conflict');
            const read = (target, fallback) => readStrictJson(file(id, saved.targetRegistry[target])) ?? fallback;
            return { status: 'prepare', resumed: true, ticketId: saved.ticketId, command: previous.frozen.command, versions: saved.versions, preview: saved.preview, worldmapInputs: saved.worldmapInputs, turnInputs: saved.turnInputs, generationPosition: saved.generationPosition,
                chapterSeal: prepareLegacyChapterSeal(saved.preview.chapters, saved.preview.timestamp), state: read('state', null), npcs: read('npcs', []), locations: read('locations', []), timeline: read('timeline', []), divergence: read('divergence', null),
                relationships: { npcToMc: read('relationshipNpcToMc', []), npcToNpc: read('relationshipNpcToNpc', []) },
                modTables: Object.fromEntries(Object.keys(saved.targetRegistry).filter(name => name.startsWith('mod.')).map(name => [name, read(name, null)])),
                loreChunks: readStrictJson(file(id, '.lore.json')) ?? [], runtimeInput: previous.preparation?.worldmapRuntime ?? null };
        }
        if (storageToken !== opened.storage.token) fail('stale-storage-scope');
        if (opened.document.commands.some(command => command.status !== 'completed')) fail('unresolved-acceptance');
        const validated = await validateCandidate(id, candidate, opened);
        if (!validated.revision.generationPosition && /📍|<!--\s*MOVEMENT\b/i.test(validated.revision.text)) fail('generation-movement-context-unavailable-regenerate');
        const commandId = lifecycleReference(opened.instance, 'command'), source = (kind, locator) => ({ type: 'compatibility', kind, id: lifecycleReference(opened.instance, kind, locator) });
        const command = { binding: 'legacy-compatibility-v1', campaignInstance: opened.instance,
            campaign: source('campaign', opened.instance), commandId, domainId: 'narrative-evidence', kind: 'story.accept',
            provenance: { origin: 'current-user-action', writerId: 'host.acceptance', turn: { type: 'compatibility', kind: 'turn', id: candidate.turnReference },
                message: source('message', candidate.sourceMessageId), source: { type: 'compatibility', kind: 'revision', id: candidate.revisionId } },
            expectedOwner: 'legacy-runtime', expectedFormatEpoch: 1, expectedVersion: { mode: 'exact', version: candidate.expectedHead }, idempotency: { mode: 'command-id' },
            sources: [source('message', candidate.sourceMessageId)], evidence: [], payload: candidate };
        if (!isLegacyAcceptanceCommand(command)) fail('invalid-host-acceptance-command');
        const versions = Object.fromEntries(Object.entries(opened.targetRegistry).map(([name, suffix]) => [name, byteVersion(readExact(file(id, suffix)))]));
        const read = (target, fallback) => readStrictJson(file(id, opened.targetRegistry[target])) ?? fallback;
        const preview = prepareLegacyArchive({ sceneNumber: opened.document.highWater + 1, timestamp: Date.now(), userContent: candidate.archivedUserText,
            assistantContent: validated.revision.text, index: read('index', []), entities: read('entities', []), chapters: read('chapters', []), commandId,
            revisionId: candidate.revisionId, hash: candidate.hash });
        const ticketId = randomUUID();
        const worldmapInputs = { now: preview.timestamp, worldSeed: randomUUID().replaceAll('-', ''), journeyId: randomUUID(), transitIds: Array.from({ length: 64 }, () => randomUUID()) };
        const turnInputs = { format: 'legacy-turn-preparation-input-v1', now: preview.timestamp, seed: randomUUID(), ids: Array.from({ length: 256 }, () => randomUUID()) };
        const generationPosition = validated.revision.generationPosition ?? null;
        const response = { status: 'prepare', ticketId, command, versions, preview, worldmapInputs, turnInputs, generationPosition,
            chapterSeal: prepareLegacyChapterSeal(preview.chapters, preview.timestamp), state: validated.saved,
            npcs: read('npcs', []), locations: read('locations', []), timeline: read('timeline', []), divergence: read('divergence', null),
            relationships: { npcToMc: read('relationshipNpcToMc', []), npcToNpc: read('relationshipNpcToNpc', []) },
            modTables: Object.fromEntries(Object.keys(opened.targetRegistry).filter(name => name.startsWith('mod.')).map(name => [name, read(name, null)])),
            loreChunks: readStrictJson(file(id, '.lore.json')) ?? [] };
        const ticket = { id, command, versions, preview, worldmapInputs, turnInputs, generationPosition, loreVersion: byteVersion(readExact(file(id, '.lore.json'))), selectionVersion: randomUUID(), targetRegistry: opened.targetRegistry };
        const { expectedOwner: _owner, expectedFormatEpoch: _epoch, ...semanticCommand } = command;
        opened.journal.begin({ commandId, logicalKey: `${opened.instance}/narrative-evidence/command-id/${commandId}`, campaignInstance: opened.instance, expectedHead: candidate.expectedHead,
            semantic: { schema: 'legacy-story-accept-v1', command: semanticCommand }, frozen: { command, candidate, targetRegistry: opened.targetRegistry, preparation: { ticketId, versions, preview, worldmapInputs, turnInputs, generationPosition, loreVersion: ticket.loreVersion, selectionVersion: ticket.selectionVersion, targetRegistry: opened.targetRegistry } } }, () => {});
        tickets.set(ticketId, ticket);
        return response;
    });

    function makePlans(ticket, bundle) {
        if (!bundle || !Array.isArray(bundle.groups) || ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'].some(group => !bundle.groups.includes(group))) fail('incomplete-prepared-effect-groups');
        semanticBytes(bundle);
        for (const key of ['npcs', 'locations', 'timeline', 'relationshipNpcToMc', 'relationshipNpcToNpc', 'chapters', 'index']) {
            if (bundle[key] !== undefined && !Array.isArray(bundle[key])) fail('invalid-prepared-records');
        }
        for (const key of ['npcs', 'locations']) if (bundle[key] && (bundle[key].some(row => !row || typeof row.id !== 'string' || !row.id) || new Set(bundle[key].map(row => row.id)).size !== bundle[key].length)) fail('ambiguous-prepared-records');
        if (bundle.index && (bundle.index.length !== ticket.preview.index.length || bundle.index.some(row => !ticket.preview.index.some(original => original.sceneId === row.sceneId))
            || bundle.index.at(-1).acceptanceCommandId !== ticket.command.commandId || bundle.index.at(-1).revisionId !== ticket.command.payload.revisionId
            || bundle.index.at(-1).contentHash !== ticket.command.payload.hash)) fail('prepared-index-binding-conflict');
        const plans = [], add = (target, value) => { if (value !== undefined) plans.push({ id: target, target, kind: 'replace', afterBase64: Buffer.from(JSON.stringify(value, null, 2)).toString('base64') }); };
        plans.push({ id: 'archive', target: 'archive', kind: 'archive-append', afterBase64: Buffer.from(ticket.preview.block).toString('base64') });
        add('index', bundle.index ?? ticket.preview.index); add('entities', ticket.preview.entities); add('chapters', bundle.chapters ?? ticket.preview.chapters);
        for (const target of ['npcs', 'locations', 'timeline', 'divergence', 'relationshipNpcToMc', 'relationshipNpcToNpc']) add(target, bundle[target]);
        for (const [name, rows] of Object.entries(bundle.modTables ?? {})) {
            if (!name.startsWith('mod.') || name.startsWith('mod.worldmap.') || !Object.hasOwn(ticket.targetRegistry, name)) fail('unknown-mod-effect-target');
            add(name, rows);
        }
        if (bundle.worldmap) {
            validateWorldmapMovement(bundle.worldmap, ticket.command, ticket.worldmapInputs);
            for (const [table, value] of Object.entries(bundle.worldmap.tables)) {
                const target = `mod.worldmap.${table}`;
                if (ticket.targetRegistry[target] !== `.mod-worldmap-${table}.json`) fail('worldmap-target-binding-conflict');
                add(target, value);
            }
        }
        const changes = [];
        for (const [key, value] of Object.entries(bundle.contextPatch ?? {})) {
            if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('invalid-context-effect');
            changes.push({ path: ['context', key], after: { present: true, value } });
        }
        for (const key of ['condenser', 'onStageNpcIds', 'bookkeepingTurnCounter', 'npcSuggestions', 'locationSuggestions']) {
            if (Object.hasOwn(bundle, key)) changes.push({ path: [key], after: { present: true, value: bundle[key] } });
        }
        if ((bundle.messages ?? []).some(message => !message || typeof message.id !== 'string' || protectedFields.some(field => Object.hasOwn(message, field)))) fail('spoofed-prepared-message');
        if (bundle.messages?.length) {
            const saved = readStrictJson(file(ticket.id, '.state.json'));
            for (const message of bundle.messages) if (saved.messages.some(existing => existing.id === message.id)) fail('duplicate-prepared-message');
            if (new Set(bundle.messages.map(message => message.id)).size !== bundle.messages.length) fail('duplicate-prepared-message');
            changes.push(...bundle.messages.map(message => ({ path: ['messages', { id: message.id, create: true }], after: { present: true, value: message } })));
        }
        const candidate = ticket.command.payload;
        const message = key => ['messages', { id: candidate.assistantMessageId }, key];
        changes.push({ path: message('sceneId'), after: { present: true, value: ticket.preview.sceneId } },
            { path: message('acceptanceBinding'), after: { present: true, value: { commandId: ticket.command.commandId, revisionId: candidate.revisionId, hash: candidate.hash } } },
            ...['pendingCommit', 'commitFailed', 'swipeSet', 'swipeActiveIndex'].map(key => ({ path: message(key), after: { present: false } })),
            { path: message('draftStatus'), after: { present: true, value: 'accepted' } });
        plans.push({ id: 'state-link', target: 'state', kind: 'json-fields', changes });
        plans.push({ id: 'close-draft', target: 'drafts', kind: 'json-fields', changes: [
            { path: ['sets', { id: candidate.setId }, 'state'], after: { present: true, value: 'accepted' } },
            { path: ['sets', { id: candidate.setId }, 'selectionVersion'], after: { present: true, value: ticket.selectionVersion } },
            { path: ['activeSetId'], after: { present: true, value: null } },
        ] });
        return plans;
    }

    function reconcile(opened, command) {
        if (command.status === 'completed') return command.outcome;
        const plans = command.frozen.plans;
        if (!Array.isArray(plans) || !plans.length) fail('missing-prepared-effect-plan');
        if (!command.effectGroup || semanticBytes(command.effectGroup.stepIds) !== semanticBytes(plans.map(plan => plan.id))) fail('missing-durable-prepared-effect-group');
        for (const plan of plans) opened.journal.apply(command.logicalKey, plan.id);
        const candidate = command.frozen.candidate;
        return opened.journal.complete(command.logicalKey, plans.map(plan => plan.id), { revisionId: candidate.revisionId, hash: candidate.hash,
            sceneId: String(command.sceneNumber).padStart(3, '0'), deterministicEffectsComplete: true,
            ...(command.frozen.worldmapProjection ? { worldmapProjection: command.frozen.worldmapProjection } : {}) });
    }

    const commit = (id, { ticketId, command, bundle }) => withCampaignLock(id, async () => {
        const opened = open(id);
        if (!isLegacyAcceptanceCommand(command) || command.campaignInstance !== opened.instance) fail('invalid-acceptance-command');
        const logicalKey = `${opened.instance}/narrative-evidence/command-id/${command.commandId}`;
        const { expectedOwner: _owner, expectedFormatEpoch: _epoch, ...semanticCommand } = command;
        const semantic = { schema: 'legacy-story-accept-v1', command: semanticCommand };
        const previous = opened.document.commands.find(item => item.logicalKey === logicalKey);
        if (previous && previous.semanticRequest !== semanticBytes(semantic)) fail('idempotency-key-reused');
        if (previous?.effectGroup || previous?.status === 'completed') {
            if (previous.frozen.bundleDigest !== byteVersion(Buffer.from(semanticBytes(bundle)))) fail('idempotency-key-reused');
            return { status: previous.status === 'completed' ? 'duplicate' : 'accepted', logicalKey, outcome: reconcile(opened, previous) };
        }
        const ticket = tickets.get(ticketId);
        if (!ticket || ticket.id !== id || semanticBytes(ticket.command) !== semanticBytes(command)) fail('invalid-host-preparation-ticket');
        await validateCandidate(id, command.payload, opened);
        for (const [name, version] of Object.entries(ticket.versions)) if (byteVersion(readExact(file(id, ticket.targetRegistry[name]))) !== version) fail('prepared-source-version-conflict');
        if (byteVersion(readExact(file(id, '.lore.json'))) !== ticket.loreVersion) fail('prepared-source-version-conflict');
        const plans = makePlans(ticket, bundle);
        if (!previous) fail('missing-acceptance-intent');
        if (previous.preparation?.worldmapRuntime && !bundle.worldmap) fail('missing-worldmap-effect-group');
        opened.journal.prepareGroup(logicalKey, plans, ticket.versions, { plans, bundleDigest: byteVersion(Buffer.from(semanticBytes(bundle))),
            ...(bundle.worldmap ? { worldmapProjection: bundle.worldmap.solverAfter } : {}) });
        tickets.delete(ticketId);
        const outcome = reconcile(opened, opened.journal.load().commands.find(item => item.logicalKey === logicalKey));
        // Derived recall retains the old fresh-append policy. It never runs
        // from historical lookup or reconciliation, and is not an outcome prerequisite.
        if (dispatchArchiveEmbedding) queueMicrotask(() => {
            Promise.resolve().then(() => dispatchArchiveEmbedding({ campaignId: id, logicalKey })).catch(error => console.warn('[Acceptance] Archive embedding incomplete:', error.message));
        });
        return { status: 'accepted', logicalKey, outcome };
    });
    const recover = (id, logicalKey) => withCampaignLock(id, () => {
        const opened = open(id), command = opened.document.commands.find(command => command.logicalKey === logicalKey);
        if (!command) fail('unknown-acceptance-command');
        return { status: command.status === 'completed' ? 'duplicate' : 'accepted', logicalKey, outcome: reconcile(opened, command), command: command.frozen.command };
    });
    const acknowledge = (id, logicalKey, head) => withCampaignLock(id, () => open(id).journal.acknowledge(logicalKey, head));
    const publication = (id, logicalKey) => withCampaignLock(id, () => {
        const opened = open(id), command = opened.document.commands.find(command => command.logicalKey === logicalKey);
        if (!command || command.status !== 'completed' || command.outcome.head !== opened.document.head) fail('publication-not-current');
        for (const step of command.steps) if (byteVersion(readExact(file(id, opened.targetRegistry[step.target]))) !== step.afterVersion) fail('publication-target-conflict');
        const read = (target, fallback) => readStrictJson(file(id, opened.targetRegistry[target])) ?? fallback;
        return { command: command.frozen.command, outcome: command.outcome, state: read('state', null), npcs: read('npcs', []), locations: read('locations', []),
            index: read('index', []), chapters: read('chapters', []), timeline: read('timeline', []), divergence: read('divergence', null),
            relationships: { npcToMc: read('relationshipNpcToMc', []), npcToNpc: read('relationshipNpcToNpc', []) },
            modTables: Object.fromEntries(Object.keys(opened.targetRegistry).filter(name => name.startsWith('mod.')).map(name => [name, read(name, null)])) };
    });
    const freezeWorldMap = (id, ticketId, runtimeInput) => withCampaignLock(id, () => {
        const opened = open(id), ticket = tickets.get(ticketId);
        if (!ticket || ticket.id !== id) fail('invalid-host-preparation-ticket');
        if (!runtimeInput || runtimeInput.format !== 'worldmap-solver-input-v1' || runtimeInput.campaignId !== id
            || !['fastest', 'shortest'].includes(runtimeInput.preference)
            || (runtimeInput.transects !== null && !Array.isArray(runtimeInput.transects))
            || Object.keys(runtimeInput).some(key => !['format', 'campaignId', 'preference', 'transects'].includes(key))) fail('invalid-worldmap-solver-input');
        semanticBytes(runtimeInput);
        const logicalKey = `${opened.instance}/narrative-evidence/command-id/${ticket.command.commandId}`;
        return opened.journal.recordPreparation(logicalKey, { worldmapRuntime: runtimeInput });
    });
    return { preflight, commit, recover, acknowledge, freezeWorldMap, publication };
}
