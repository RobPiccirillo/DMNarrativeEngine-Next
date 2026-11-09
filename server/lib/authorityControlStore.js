// Explicit, dormant control-plane API. No gameplay routes import this module.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, validateCampaignId } from './fileStore.js';
import { isAuthorityControlDocument, serializeAuthorityControl } from '@narrative/engine/contracts/authorityControl';
import { transitionAuthority } from '@narrative/engine/contracts/authorityTransition';

/** Separate from campaigns/: generic campaign save/import/delete cannot overwrite control state.
 * storageId is the existing filesystem-safe campaign key; campaignId is its explicit canonical ID.
 * Missing files/entries report absence, not proof a campaign was never adopted. Legacy defaults
 * require independently known never-adopted status; future live adoption must supply separate
 * evidence and fail recovery closed if a migrated campaign loses this metadata.
 * All cooperating writers use an exclusive lock + revision check. A stale lock fails closed;
 * operators must inspect it, not silently clear it. This is not a database transaction or replay store.
 */
export function createAuthorityControlStore(directory = path.join(DATA_DIR, 'authority')) {
    function target(storageId) {
        validateCampaignId(storageId);
        return path.join(directory, `${storageId}.authority.json`);
    }
    function load(storageId, campaignId) {
        const file = target(storageId);
        if (!isAuthorityControlDocument({ schemaVersion: 1, campaignId, revision: 0, domains: [] })) return { status: 'invalid-campaign' };
        let text;
        try { text = fs.readFileSync(file, 'utf8'); }
        catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'io-error' }; }
        let document;
        try { document = JSON.parse(text); } catch { return { status: 'malformed' }; }
        if (!isAuthorityControlDocument(document)) return { status: 'malformed' };
        if (document.campaignId !== campaignId) return { status: 'campaign-mismatch' };
        return { status: 'loaded', document };
    }
    function persist(file, document) {
        const temporary = `${file}.tmp`;
        let owned = false;
        try {
            // Exclusive temp creation also refuses unexplained leftovers from interrupted writes.
            const fd = fs.openSync(temporary, 'wx');
            owned = true;
            try { fs.writeFileSync(fd, serializeAuthorityControl(document), 'utf8'); fs.fsyncSync(fd); }
            finally { fs.closeSync(fd); }
            fs.renameSync(temporary, file);
            owned = false;
            return { status: 'saved', document };
        } catch (error) {
            if (owned) {
                try { fs.unlinkSync(temporary); }
                catch { return { status: 'io-error' }; }
            }
            return { status: error.code === 'EEXIST' ? 'busy' : 'io-error' };
        }
    }
    function withLock(storageId, action) {
        const file = target(storageId);
        let lock;
        try {
            fs.mkdirSync(directory, { recursive: true });
            lock = fs.openSync(`${file}.lock`, 'wx');
        } catch (error) { return { status: error.code === 'EEXIST' ? 'busy' : 'io-error' }; }
        let result;
        try { result = action(file); }
        catch { result = { status: 'io-error' }; }
        try { fs.closeSync(lock); fs.unlinkSync(`${file}.lock`); }
        catch { return { status: 'io-error' }; }
        return result;
    }
    return {
        load,
        initialize(storageId, campaignId) {
            return withLock(storageId, file => {
                const loaded = load(storageId, campaignId);
                if (loaded.status === 'loaded') return { status: 'already-initialized' };
                if (loaded.status !== 'missing') return loaded;
                return persist(file, { schemaVersion: 1, campaignId, revision: 0, domains: [] });
            });
        },
        apply(storageId, campaignId, expectedRevision, domainId, operation) {
            return withLock(storageId, file => {
                const loaded = load(storageId, campaignId);
                if (loaded.status !== 'loaded') return loaded;
                if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { status: 'invalid-revision' };
                if (loaded.document.revision !== expectedRevision) return { status: 'revision-conflict' };
                if (expectedRevision === Number.MAX_SAFE_INTEGER) return { status: 'revision-exhausted' };
                const previous = loaded.document.domains.find(state => state.domainId === domainId);
                const result = transitionAuthority(previous, domainId, operation);
                if (result.status !== 'transitioned') return result;
                return persist(file, { ...loaded.document, revision: expectedRevision + 1,
                    domains: [...loaded.document.domains.filter(state => state.domainId !== domainId), result.state] });
            });
        },
    };
}
