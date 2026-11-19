import path from 'node:path';
import { createHash } from 'node:crypto';
import { hashStoryVisible, validateDraftSet } from '@narrative/engine/contracts/draftLifecycle';
import { byteVersion, publishDurable, readExact, parseStrictJson } from '../lib/durablePublication.js';
import { semanticBytes } from './legacyAcceptanceJournal.js';

export const serverStoryHash = text => hashStoryVisible(text, async bytes => new Uint8Array(createHash('sha256').update(bytes).digest()));

export async function verifyDraftDocument(document, campaignInstance) {
    if (document && document.schemaVersion !== 1) throw new Error('unsupported-draft-schema');
    if (!document || document.schemaVersion !== 1 || document.campaignInstance !== campaignInstance || !Array.isArray(document.sets)
        || !Array.isArray(document.conflicts) || new Set(document.sets.map(set => set.id)).size !== document.sets.length) throw new Error('invalid-draft-document');
    if (document.activeSetId !== null && !document.sets.some(set => set.id === document.activeSetId && !['closed', 'discarded', 'acknowledged'].includes(set.state))) throw new Error('invalid-active-draft');
    const revisionIds = new Set(), attemptIds = new Set();
    for (const set of document.sets) {
        validateDraftSet(set);
        if (set.campaignInstance !== campaignInstance) throw new Error('draft-campaign-binding-conflict');
        for (const revision of set.revisions) {
            if (revisionIds.has(revision.id)) throw new Error('duplicate-revision-across-sets');
            revisionIds.add(revision.id);
            if (await serverStoryHash(revision.text) !== revision.hash) throw new Error('revision-hash-conflict');
        }
        for (const attempt of set.attempts) {
            if (attemptIds.has(attempt.id)) throw new Error('duplicate-attempt-across-sets');
            attemptIds.add(attempt.id);
        }
    }
    return document;
}

export function createLegacyDraftRepository({ directory, storageId, campaignInstance, boundary = () => {} }) {
    if (!/^[a-zA-Z0-9_-]+$/.test(storageId) || typeof campaignInstance !== 'string' || !campaignInstance) throw new Error('invalid-campaign-binding');
    const file = path.join(path.resolve(directory), `${storageId}.drafts.json`);
    let flight = Promise.resolve();
    const serialize = action => {
        const result = flight.then(action);
        flight = result.catch(() => {});
        return result;
    };
    const load = async () => {
        const bytes = readExact(file), document = parseStrictJson(bytes);
        if (document === null) return { status: 'absent', version: byteVersion(null) };
        await verifyDraftDocument(document, campaignInstance);
        return { status: 'loaded', document, version: byteVersion(bytes) };
    };
    return {
        load,
        save(expectedVersion, document) {
            return serialize(async () => {
                const before = await load();
                if (before.version !== expectedVersion) throw new Error('draft-version-conflict');
                await verifyDraftDocument(document, campaignInstance);
                if (byteVersion(readExact(file)) !== expectedVersion) throw new Error('draft-version-conflict');
                if (before.status === 'loaded') {
                    for (const originalSet of before.document.sets) {
                        const nextSet = document.sets.find(set => set.id === originalSet.id);
                        if (!nextSet) throw new Error('draft-history-removal-conflict');
                        for (const field of ['campaignInstance', 'turnReference', 'sourceMessageId', 'assistantMessageId', 'archivedUserText', 'expectedHead']) {
                            if (nextSet[field] !== originalSet[field]) throw new Error('immutable-draft-source-conflict');
                        }
                        for (const attempt of originalSet.attempts) {
                            const nextAttempt = nextSet.attempts.find(item => item.id === attempt.id);
                            if (!nextAttempt) throw new Error('attempt-history-removal-conflict');
                            const { status: previousStatus, ...originalFields } = attempt;
                            const { status: nextStatus, ...nextFields } = nextAttempt;
                            if (semanticBytes(originalFields) !== semanticBytes(nextFields) || (previousStatus !== 'streaming' && previousStatus !== nextStatus)) throw new Error('immutable-attempt-conflict');
                        }
                        if (semanticBytes(originalSet) !== semanticBytes(nextSet) && originalSet.selectionVersion === nextSet.selectionVersion) throw new Error('draft-selection-version-required');
                    }
                    const revisions = new Map(before.document.sets.flatMap(set => set.revisions.map(revision => [revision.id, revision])));
                    const next = new Map(document.sets.flatMap(set => set.revisions.map(revision => [revision.id, revision])));
                    for (const [id, revision] of revisions) {
                        if (!next.has(id) || semanticBytes(next.get(id)) !== semanticBytes(revision)) throw new Error('immutable-revision-conflict');
                    }
                }
                const bytes = Buffer.from(JSON.stringify(document, null, 2));
                publishDurable(file, bytes, boundary);
                return { status: 'saved', document: structuredClone(document), version: byteVersion(bytes) };
            });
        },
    };
}
