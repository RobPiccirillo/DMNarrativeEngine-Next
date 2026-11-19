import { managedStateToken } from './managedStateSave.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCompatibilityReferences } from '@narrative/engine/contracts/identity';
import { addAttempt, finishAttempt, sealRevision, selectRevision, interruptAttempts } from '@narrative/engine/contracts/draftLifecycle';
import { upgradeLegacyPending } from '@narrative/engine/contracts/draftCompatibility';
import { CAMPAIGNS_DIR, DATA_DIR, validateCampaignId } from '../lib/fileStore.js';
import { withCampaignLock } from '../lib/writeLock.js';
import { readExact, readStrictJson, byteVersion } from '../lib/durablePublication.js';
import { createLegacyDraftRepository, serverStoryHash } from './legacyDraftRepository.js';
import { createLegacyAcceptanceJournal, semanticBytes } from './legacyAcceptanceJournal.js';

const error = code => { throw Object.assign(new Error(code), { statusCode: 409, code }); };
const movementPosition = context => JSON.stringify([context.currentPlaceId ?? null, context.currentFeature ?? null, context.worldDay ?? null, context.travel ?? null, context.travelMinutesToday ?? 0]);
export const lifecycleReference = (instance, kind, locator = randomUUID()) => createCompatibilityReferences({ kind,
    campaign: instance, namespace: 'legacy-runtime', family: 'phase3-lifecycle', version: '1', scope: { mode: 'compatibility' } }, [locator])[0];

export function createDraftLifecycleService({ directory = CAMPAIGNS_DIR, authorityDirectory = path.join(DATA_DIR, 'authority') } = {}) {
    const file = (id, suffix) => { validateCampaignId(id); return path.join(directory, id + suffix); };
    const state = id => readStrictJson(file(id, '.state.json'));
    const repository = (id, instance) => createLegacyDraftRepository({ directory, storageId: id, campaignInstance: instance });
    const journal = (id, instance) => createLegacyAcceptanceJournal({ directory, storageId: id, campaignInstance: instance, targets: {} });

    function legacyBinding(id) {
        const control = readStrictJson(path.join(authorityDirectory, id + '.authority.json'));
        if (control !== null) error('authority-binding-requires-review');
        const saved = state(id);
        if (!saved || !Array.isArray(saved.messages) || !saved.context) error('missing-legacy-state');
        const prose = readExact(file(id, '.archive.md'));
        const index = readStrictJson(file(id, '.archive.index.json')) ?? [];
        if (!Array.isArray(index)) error('invalid-legacy-index');
        const ids = [...(prose?.toString('utf8') ?? '').matchAll(/^## SCENE (\d+)\r?$/gm)].map(match => match[1]);
        if (new Set(ids).size !== ids.length || new Set(index.map(entry => entry.sceneId)).size !== index.length
            || ids.length !== index.length || ids.some(scene => !index.some(entry => entry.sceneId === scene))) error('legacy-archive-evidence-conflict');
        if (saved.messages.some(message => message.sceneId && !ids.includes(message.sceneId))) error('legacy-scene-stamp-conflict');
        return { saved, anchor: { head: `legacy-head:${randomUUID()}`, highWater: Math.max(0, ...ids.map(Number)),
            sources: { state: byteVersion(readExact(file(id, '.state.json'))), archive: byteVersion(prose), index: byteVersion(readExact(file(id, '.archive.index.json'))) } } };
    }

    async function load(id, initialize = false) {
        if (readStrictJson(path.join(authorityDirectory, id + '.authority.json')) !== null) error('authority-binding-requires-review');
        const raw = readStrictJson(file(id, '.drafts.json'));
        if (!raw) {
            if (readStrictJson(file(id, '.acceptance.json'))) error('missing-managed-drafts');
            const saved = state(id);
            if (!initialize && !saved?.messages?.some(message => message.pendingCommit || message.commitFailed)) return { managed: false };
            const binding = legacyBinding(id), instance = randomUUID();
            const document = { schemaVersion: 1, campaignInstance: instance, activeSetId: null, sets: [], conflicts: [], anchor: binding.anchor,
                storageGuard: { format: 'legacy-storage-scope-v1', storageId: id, token: randomUUID(), phase: 'ready', history: [] } };
            if (binding.saved.messages.some(message => message.pendingCommit || message.commitFailed)) {
                const upgraded = await upgradeLegacyPending({ campaignInstance: instance, expectedHead: binding.anchor.head,
                    messages: binding.saved.messages, hash: serverStoryHash });
                if (upgraded.status === 'ready') { document.sets.push(upgraded.set); document.activeSetId = upgraded.set.id; }
                else document.conflicts.push({ code: upgraded.reason, preserved: upgraded.preserved });
            }
            await repository(id, instance).save('absent', document);
            journal(id, instance).initialize(binding.anchor);
        }
        const document = readStrictJson(file(id, '.drafts.json'));
        const repo = repository(id, document.campaignInstance);
        let loaded = await repo.load();
        if (!loaded.document.storageGuard) {
            const upgraded = { ...loaded.document, storageGuard: { format: 'legacy-storage-scope-v1', storageId: id, token: randomUUID(), phase: 'ready', history: [] } };
            await repo.save(loaded.version, upgraded); loaded = await repo.load();
        }
        if (loaded.document.storageGuard.phase !== 'ready' || loaded.document.storageGuard.storageId !== id) error('lifecycle-storage-scope-unready');
        let acceptance = journal(id, document.campaignInstance).load();
        if (!acceptance) {
            if (!document.anchor || document.sets.some(set => set.state === 'accepted' || set.state === 'acceptance-pending')) error('missing-managed-acceptance');
            const current = legacyBinding(id);
            if (JSON.stringify(current.anchor.sources) !== JSON.stringify(document.anchor.sources)) error('incomplete-lifecycle-bootstrap-conflict');
            acceptance = journal(id, document.campaignInstance).initialize(document.anchor);
        }
        if (acceptance.maintenance?.some(entry => entry.status !== 'completed')) error('archive-maintenance-recovery-required');
        return { managed: true, document: loaded.document, version: loaded.version, head: acceptance.head, saveToken: managedStateToken(directory, id),
            pendingAcceptance: acceptance.commands.find(command => command.status !== 'completed') ?? null,
            unacknowledged: acceptance.commands.filter(command => command.status === 'completed' && !command.acknowledged).map(command => ({ logicalKey: command.logicalKey, outcome: command.outcome })) };
    }

    const inspect = id => withCampaignLock(id, () => load(id));
    const initialize = id => withCampaignLock(id, () => load(id, true));
    const transition = (id, request) => withCampaignLock(id, async () => {
        const view = await load(id, request.action === 'begin');
        if (!view.managed) error('missing-draft-lifecycle');
        if (request.transitionId !== undefined && (typeof request.transitionId !== 'string' || !/^[a-f0-9-]{36}$/.test(request.transitionId))) error('invalid-transition-id');
        const historical = view.document.transitions?.find(transition => transition.id === request.transitionId);
        if (historical) {
            if (historical.request !== semanticBytes(request)) error('idempotency-key-reused');
            return { ...view, ...historical.result };
        }
        if (request.expectedVersion !== undefined && request.expectedVersion !== view.version) error('draft-version-conflict');
        if (request.action !== 'begin' && request.expectedVersion === undefined) error('draft-version-required');
        if (view.pendingAcceptance) error('acceptance-recovery-required');
        if (view.unacknowledged?.length) error('acceptance-acknowledgement-required');
        if (view.document.conflicts.length) error('legacy-recovery-required');
        const document = structuredClone(view.document), instance = document.campaignInstance;
        let set = document.sets.find(candidate => candidate.id === document.activeSetId);
        const version = () => randomUUID();
        let result = {};
        if (request.action === 'begin') {
            if (!['initial', 'retry', 'swipe', 'continue', 'regenerate'].includes(request.kind)) error('invalid-attempt-kind');
            const saved = state(id), message = saved.messages.find(message => message.id === request.assistantMessageId && message.role === 'assistant');
            const source = saved.messages.find(message => message.id === request.sourceMessageId && message.role === 'user');
            if (!message || !source || source.id === message.id || saved.messages.indexOf(source) >= saved.messages.indexOf(message)) error('invalid-attempt-source');
            if (message.sceneId || message.acceptanceBinding || document.sets.some(previous => previous.sourceMessageId === source.id && previous.state === 'accepted')) error('accepted-turn-cannot-become-a-draft');
            if ((source.displayContent ?? source.content) !== request.archivedUserText) error('source-text-conflict');
            if (!set) {
                if (request.kind !== 'initial') error('missing-source-draft');
                set = { id: lifecycleReference(instance, 'draft'), campaignInstance: instance, turnReference: lifecycleReference(instance, 'turn'),
                    sourceMessageId: source.id, assistantMessageId: message.id, archivedUserText: request.archivedUserText,
                    expectedHead: view.head, revisionOrder: [], revisions: [], attempts: [], selectionVersion: version(), state: 'draft' };
                document.sets.push(set); document.activeSetId = set.id;
            }
            if (set.assistantMessageId !== message.id || set.sourceMessageId !== source.id || set.expectedHead !== view.head) error('active-draft-conflict');
            if (request.kind === 'initial' && set.attempts.length) error('initial-attempt-exists');
            const previousAttempt = set.attempts.at(-1);
            const currentPosition = movementPosition(saved.context);
            const inheritedPosition = set.revisions.find(revision => revision.id === set.selectedRevisionId)?.generationPosition ?? previousAttempt?.generationPosition;
            const generationPosition = request.generationPosition ?? (request.kind === 'initial' ? currentPosition : inheritedPosition ?? currentPosition);
            if (typeof generationPosition !== 'string' || generationPosition !== currentPosition && generationPosition !== inheritedPosition) error('generation-position-source-conflict');
            const attempt = { id: lifecycleReference(instance, 'generation-attempt'), setId: set.id, kind: request.kind,
                generationPosition,
                profileId: request.profileId, callReference: lifecycleReference(instance, 'model-call'), status: 'streaming',
                ...(set.selectedRevisionId ? { sourceRevisionId: set.selectedRevisionId } : {}),
                ...(previousAttempt && ['retry', 'regenerate'].includes(request.kind) ? { sourceAttemptId: previousAttempt.id } : {}) };
            set = addAttempt(set, attempt, version()); result = { attempt };
        } else {
            if (!set || set.id !== request.setId) error('active-draft-conflict');
            if (request.action === 'restore') set = interruptAttempts(set, version());
            else if (request.action === 'select') {
                const revision = set.revisions.find(revision => revision.id === request.revisionId);
                if (!revision || revision.text !== request.displayedText) error('selection-text-conflict');
                set = selectRevision(set, revision.id, version());
            } else if (request.action === 'finish') {
                const attempt = set.attempts.find(attempt => attempt.id === request.attemptId);
                if (!attempt) error('unknown-attempt');
                if (attempt.status !== 'streaming') error('attempt-already-finalized');
                if (!['completed', 'failed', 'aborted'].includes(request.status)) error('invalid-attempt-status');
                set = finishAttempt(set, attempt.id, request.status, version());
                if (request.text !== undefined) {
                    if (request.status !== 'completed' && !(request.status === 'aborted' && attempt.kind === 'continue')) error('failed-attempt-cannot-finalize');
                    const hash = await serverStoryHash(request.text), revisionId = lifecycleReference(instance, 'revision');
                    const revision = { id: revisionId, setId: set.id, attemptId: attempt.id, reason: attempt.kind, provenance: 'host-generation', text: request.text, hash,
                        ...(attempt.kind === 'continue' ? { parentRevisionId: attempt.sourceRevisionId } : {}),
                        ...(attempt.generationPosition ? { generationPosition: attempt.generationPosition } : {}),
                        ...(request.metadata ? { metadata: { revisionId, hash, version: version(), sceneStakes: request.metadata.sceneStakes, tagPresent: request.metadata.tagPresent } } : {}) };
                    set = sealRevision(set, revision, version(), request.select !== false); result = { revision };
                }
            } else if (request.action === 'edit') {
                if (request.parentRevisionId !== set.selectedRevisionId) error('stale-edit-parent');
                const revisionId = lifecycleReference(instance, 'revision'), hash = await serverStoryHash(request.text);
                const generationPosition = set.revisions.find(revision => revision.id === set.selectedRevisionId)?.generationPosition;
                const revision = { id: revisionId, setId: set.id, parentRevisionId: set.selectedRevisionId,
                    reason: 'edit', provenance: 'user-edit', text: request.text, hash,
                    ...(generationPosition ? { generationPosition } : {}) };
                set = sealRevision(set, revision, version()); result = { revision };
            } else if (request.action === 'discard') {
                if (!['draft', 'ready', 'streaming'].includes(set.state)) error('draft-not-editable');
                set = { ...set, state: 'discarded', selectionVersion: version() }; document.activeSetId = null;
            } else error('unknown-lifecycle-action');
        }
        document.sets = document.sets.map(candidate => candidate.id === set.id ? set : candidate);
        if (request.transitionId) document.transitions = [...(document.transitions ?? []), { id: request.transitionId, request: semanticBytes(request), result }];
        await repository(id, instance).save(view.version, document);
        return { ...await load(id), ...result };
    });
    return { inspect, transition, initialize };
}
