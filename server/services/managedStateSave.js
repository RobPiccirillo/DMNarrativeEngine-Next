import path from 'node:path';
import { byteVersion, readExact, readStrictJson } from '../lib/durablePublication.js';
import { createLegacyAcceptanceJournal, semanticBytes } from './legacyAcceptanceJournal.js';

export const stateTokenHeader = 'X-Phase3-State-Token';
const fail = code => { throw Object.assign(new Error(code), { code, statusCode: 409 }); };
const fields = ['sceneId', 'acceptanceBinding', 'draftSetId', 'selectedRevisionId', 'displayedRevisionId', 'draftHash', 'draftStatus', 'pendingCommit', 'commitFailed', 'swipeSet', 'swipeActiveIndex'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function managedStateToken(directory, id) {
    const draftsFile = path.join(directory, `${id}.drafts.json`), drafts = readStrictJson(draftsFile);
    if (!drafts) return null;
    if (drafts.schemaVersion !== 1 || !drafts.campaignInstance || !Array.isArray(drafts.sets)) fail('draft-recovery-required');
    if (!drafts.storageGuard || drafts.storageGuard.phase !== 'ready' || drafts.storageGuard.storageId !== id) fail('lifecycle-storage-scope-unready');
    const journal = createLegacyAcceptanceJournal({ directory, storageId: id, campaignInstance: drafts.campaignInstance, targets: {} }).load();
    if (!journal) fail('acceptance-recovery-required');
    return { format: 'legacy-state-save-token-v1', campaignInstance: drafts.campaignInstance, head: journal.head,
        storageToken: drafts.storageGuard.token,
        draftVersion: byteVersion(readExact(draftsFile)), stateVersion: byteVersion(readExact(path.join(directory, `${id}.state.json`))) };
}

export function verifyManagedStateSave(directory, id, encoded, incoming) {
    const expected = managedStateToken(directory, id);
    if (!expected) return;
    let supplied;
    try { supplied = JSON.parse(decodeURIComponent(encoded ?? '')); } catch { fail('managed-state-token-required'); }
    if (semanticBytes(supplied) !== semanticBytes(expected)) fail('managed-state-version-conflict');
    if (!incoming || !Array.isArray(incoming.messages) || !incoming.context || typeof incoming.context !== 'object') fail('invalid-managed-state');
    const document = readStrictJson(path.join(directory, `${id}.drafts.json`));
    const previous = readStrictJson(path.join(directory, `${id}.state.json`));
    for (const key of ['bookkeepingTurnCounter', 'onStageNpcIds', 'npcSuggestions', 'locationSuggestions']) {
        if (Object.hasOwn(incoming, key) && !same(incoming[key], previous?.[key])) fail('managed-host-field-conflict');
    }
    const previousById = new Map((previous?.messages ?? []).map(message => [message.id, message]));
    const incomingById = new Map(incoming.messages.map(message => [message.id, message]));
    const journal = readStrictJson(path.join(directory, `${id}.acceptance.json`));
    const acceptedMessages = new Map();
    for (const command of journal.commands.filter(command => command.status === 'completed')) {
        const candidate = command.frozen?.candidate;
        if (!candidate?.assistantMessageId || !candidate.sourceMessageId) fail('acceptance-recovery-required');
        const scene = String(command.sceneNumber).padStart(3, '0');
        acceptedMessages.set(candidate.assistantMessageId, scene); acceptedMessages.set(candidate.sourceMessageId, scene);
    }
    let archive;
    for (const original of previous?.messages ?? []) {
        const scene = original.sceneId ?? acceptedMessages.get(original.id);
        if (!scene) continue;
        const next = incomingById.get(original.id);
        if (next && next.role === original.role && next.content === original.content && next.displayContent === original.displayContent) continue;
        if (!journal.maintenance?.some(entry => entry.status === 'completed' && entry.affectedScenes?.includes(scene))) fail('managed-history-maintenance-required');
        archive ??= readExact(path.join(directory, `${id}.archive.md`))?.toString('utf8') ?? '';
        const block = archive.split(/^(?=## SCENE )/m).find(block => block.startsWith(`## SCENE ${scene}\n`) || block.startsWith(`## SCENE ${scene}\r\n`));
        if (!next) { if (block) fail('managed-history-maintenance-required'); continue; }
        if (next.role !== original.role) fail('managed-history-maintenance-required');
        if (!block) fail('managed-history-maintenance-required');
        const prose = original.role === 'assistant' ? block.match(/\*\*\[GM\]\*\*\r?\n([\s\S]*?)\r?\n\r?\n---(?:\r?\n)*$/)?.[1]
            : block.match(/\*\*\[USER\]\*\*\r?\n([\s\S]*?)\r?\n\r?\n\*\*\[GM\]\*\*/)?.[1];
        if (typeof prose !== 'string' || (next.displayContent ?? next.content)?.trim() !== prose.trim()
            || next.content !== original.content && next.content?.trim() !== prose.trim()) fail('managed-history-maintenance-required');
    }
    if (new Set(incoming.messages.map(message => message.id)).size !== incoming.messages.length) fail('ambiguous-managed-messages');
    const active = document.sets.find(set => set.id === document.activeSetId);
    if (active) {
        const assistant = incoming.messages.filter(message => message.id === active.assistantMessageId), source = incoming.messages.filter(message => message.id === active.sourceMessageId);
        if (assistant.length !== 1 || source.length !== 1 || (source[0].displayContent ?? source[0].content) !== active.archivedUserText) fail('managed-source-binding-conflict');
        const message = assistant[0], selected = active.revisions.find(revision => revision.id === active.selectedRevisionId);
        const streaming = active.attempts.some(attempt => attempt.status === 'streaming');
        for (const [key, value] of Object.entries({ draftSetId: active.id, selectedRevisionId: active.selectedRevisionId,
            displayedRevisionId: active.displayedRevisionId, draftHash: selected?.hash })) if (!same(message[key], value)) fail('managed-draft-marker-conflict');
        if (message.sceneId !== undefined || message.acceptanceBinding !== undefined || message.commitFailed) fail('managed-acceptance-marker-conflict');
        const status = !selected && active.attempts.some(attempt => attempt.status === 'interrupted') ? 'interrupted' : active.state;
        if (message.role !== 'assistant' || source[0].role !== 'user' || message.draftStatus !== status || (selected && message.pendingCommit !== true)) fail('managed-draft-marker-conflict');
        if (!streaming && selected && (message.content !== selected.text || (message.displayContent !== undefined && message.displayContent !== selected.text))) fail('managed-revision-text-conflict');
        if (message.swipeSet && (!Array.isArray(message.swipeSet) || message.swipeSet.length !== active.revisionOrder.length
            || message.swipeSet.some((variant, index) => variant.id !== active.revisionOrder[index] || variant.text !== active.revisions.find(revision => revision.id === variant.id)?.text))) fail('managed-variant-marker-conflict');
        if (message.swipeSet && message.swipeActiveIndex !== active.revisionOrder.indexOf(active.selectedRevisionId)) fail('managed-variant-marker-conflict');
    }
    for (const message of incoming.messages) {
        if (message.id === active?.assistantMessageId) continue;
        const original = previousById.get(message.id);
        if (fields.some(field => !same(message[field], original?.[field]))) fail('managed-host-field-conflict');
    }
}
