import path from 'node:path';
import { CAMPAIGNS_DIR, validateCampaignId } from '../lib/fileStore.js';
import { withCampaignLock } from '../lib/writeLock.js';
import { readExact, readStrictJson } from '../lib/durablePublication.js';
import { createLegacyAcceptanceJournal } from './legacyAcceptanceJournal.js';

// Optional derived recall, dispatched exclusively by a fresh completed host
// acceptance. Restarts and duplicate commands never call this producer.
export function createAcceptanceArchiveEmbedding({ directory = CAMPAIGNS_DIR, authorityDirectory = path.join(path.dirname(directory), 'authority'), embed, buildText, store } = {}) {
    const open = id => {
        if (readStrictJson(path.join(authorityDirectory, id + '.authority.json')) !== null) throw new Error('embedding-authority-conflict');
        const drafts = readStrictJson(path.join(directory, id + '.drafts.json'));
        if (!drafts?.campaignInstance || drafts.storageGuard?.phase !== 'ready') throw new Error('embedding-storage-scope-conflict');
        const journal = createLegacyAcceptanceJournal({ directory, storageId: id, campaignInstance: drafts.campaignInstance, targets: {} });
        return { drafts, journal, document: journal.load() };
    };
    return async ({ campaignId: id, logicalKey }) => {
        validateCampaignId(id);
        const source = await withCampaignLock(id, () => {
            const opened = open(id), command = opened.document.commands.find(command => command.logicalKey === logicalKey);
            if (!command || command.status !== 'completed' || command.derivedRecall?.status !== 'pending') return null;
            const entry = command.frozen.preparation?.preview?.entry, step = command.steps.find(step => step.target === 'archive');
            if (!entry || !step || !opened.journal.recordDerivedRecall(logicalKey, 'pending', 'dispatched')) return null;
            return { entry, step, commandId: command.commandId, revisionId: command.outcome.revisionId, hash: command.outcome.hash,
                storageToken: opened.drafts.storageGuard.token };
        });
        if (!source) return;
        try {
            const vector = embed && buildText && store ? { embedText: embed, buildArchiveText: buildText, storeArchiveEmbedding: store }
                : await import('./vectorService.js');
            const embedding = await vector.embedText(vector.buildArchiveText(source.entry));
            await withCampaignLock(id, () => {
                const opened = open(id), command = opened.document.commands.find(command => command.logicalKey === logicalKey);
                const bytes = readExact(path.join(directory, id + '.archive.md')), block = Buffer.from(source.step.afterBase64, 'base64');
                const index = readStrictJson(path.join(directory, id + '.archive.index.json'));
                const row = index?.find(row => row.sceneId === source.entry.sceneId);
                const current = opened.drafts.storageGuard.token === source.storageToken && command?.status === 'completed'
                    && command.outcome.revisionId === source.revisionId && command.outcome.hash === source.hash
                    && row?.acceptanceCommandId === source.commandId && row.contentHash === source.hash
                    && bytes?.subarray(source.step.originalLength, source.step.originalLength + block.length).equals(block);
                if (!current) { opened.journal.recordDerivedRecall(logicalKey, 'dispatched', 'superseded'); return; }
                if (!store && !vector.getDb()) throw new Error('embedding-store-unavailable');
                // Existing vector store upserts by campaign/scene. A later
                // accepted append does not invalidate this unchanged scene.
                vector.storeArchiveEmbedding(id, source.entry.sceneId, embedding);
                opened.journal.recordDerivedRecall(logicalKey, 'dispatched', 'produced');
            });
        } catch (error) {
            await withCampaignLock(id, () => { open(id).journal.recordDerivedRecall(logicalKey, 'dispatched', 'incomplete'); }).catch(() => {});
            throw error;
        }
    };
}
