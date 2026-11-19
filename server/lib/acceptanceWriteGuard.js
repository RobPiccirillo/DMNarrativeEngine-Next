import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { managedStateToken } from '../services/managedStateSave.js';

const ordinaryRequest = new AsyncLocalStorage();
const conflict = code => { throw Object.assign(new Error(code), { statusCode: 409 }); };

function verifyRequestScope(directory, id, supplied) {
    const drafts = JSON.parse(fs.readFileSync(path.join(directory, id + '.drafts.json'), 'utf8'));
    const journal = JSON.parse(fs.readFileSync(path.join(directory, id + '.acceptance.json'), 'utf8'));
    if (!supplied || supplied.campaignInstance !== drafts.campaignInstance || supplied.storageToken !== drafts.storageGuard?.token
        || supplied.head !== journal.head) conflict('managed-write-version-conflict');
}

export function assertOrdinaryCampaignWrite(directory, id) {
    const request = ordinaryRequest.getStore();
    if (request && request.id === id && request.directory === directory) verifyRequestScope(directory, id, request.token);
    const draftFile = path.join(directory, `${id}.drafts.json`);
    let drafts;
    if (fs.existsSync(draftFile)) {
        try { drafts = JSON.parse(fs.readFileSync(draftFile, 'utf8')); }
        catch { throw Object.assign(new Error('draft-journal-recovery-required'), { statusCode: 409 }); }
        if (drafts?.schemaVersion !== 1 || typeof drafts.campaignInstance !== 'string' || !Array.isArray(drafts.sets)
            || !drafts.storageGuard || drafts.storageGuard.storageId !== id) conflict('draft-journal-recovery-required');
        if (drafts.storageGuard && drafts.storageGuard.phase !== 'ready') throw Object.assign(new Error('lifecycle-storage-scope-unready'), { statusCode: 409 });
    }
    const file = path.join(directory, `${id}.acceptance.json`);
    if (!fs.existsSync(file)) { if (drafts) conflict('missing-managed-lifecycle-pair'); return; }
    let journal;
    try { journal = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw Object.assign(new Error('acceptance-journal-recovery-required'), { statusCode: 409 }); }
    if (!drafts || journal?.schemaVersion !== 1 || journal.campaignInstance !== drafts.campaignInstance || typeof journal.head !== 'string') conflict('acceptance-journal-recovery-required');
    if (journal.maintenance !== undefined && (!Array.isArray(journal.maintenance) || journal.maintenance.some(entry => entry?.status !== 'completed'))) {
        throw Object.assign(new Error('archive-maintenance-recovery-required'), { statusCode: 409 });
    }
    if (!Array.isArray(journal.commands) || journal.commands.some(command => !command || command.status !== 'completed' || !command.acknowledged)) {
        throw Object.assign(new Error('acceptance-write-owned'), { statusCode: 409 });
    }
}

export function guardOrdinaryCampaignFile(file) {
    const name = path.basename(file);
    if (path.basename(path.dirname(file)) !== 'campaigns') return;
    const id = name.split('.')[0];
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return;
    assertOrdinaryCampaignWrite(path.dirname(file), id);
    if (name.endsWith('.archive.md') && fs.existsSync(path.join(path.dirname(file), id + '.acceptance.json'))) {
        throw Object.assign(new Error('raw-managed-archive-write-rejected'), { statusCode: 409 });
    }
}

export function acceptanceWriteGuard(directory) {
    return (req, res, next) => {
        if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) || req.path.startsWith('/acceptance/') || req.path === '/lifecycle'
            || req.method === 'POST' && /^\/(?:archive|lore)\/semantic-candidates$/.test(req.path)
            || req.method === 'POST' && req.path === '/backup') return next();
        // Only the explicit restore operation may resume a failed restore. Its
        // service validates the full backup before taking ownership again.
        if (req.method === 'POST' && /^\/backups\/\d+\/restore$/.test(req.path)) {
            try {
                const drafts = JSON.parse(fs.readFileSync(path.join(directory, `${req.params.id}.drafts.json`), 'utf8'));
                if (drafts.storageGuard?.phase === 'restoring') return next();
            } catch { /* The normal guard handles missing or corrupt evidence. */ }
        }
        try {
            assertOrdinaryCampaignWrite(directory, req.params.id);
            if (!fs.existsSync(path.join(directory, `${req.params.id}.drafts.json`))) return next();
            // Conditional scope belongs to the files acceptance reads/writes.
            // Unrelated legacy map/vector/backup endpoints retain their normal
            // behavior outside an owned acceptance window.
            if (!/^\/(?:state|npcs|locations|lore|timeline|divergence|archive|entities|facts|relationship-memory|mod-tables|mod-data)(?:\/|$)/.test(req.path)) return next();
            let token;
            try { token = JSON.parse(decodeURIComponent(req.get('X-Phase3-State-Token') ?? '')); }
            catch { conflict('managed-write-token-required'); }
            verifyRequestScope(directory, req.params.id, token);
            const json = res.json.bind(res), id = req.params.id;
            res.json = value => {
                if (res.statusCode < 400) {
                    const current = managedStateToken(directory, id);
                    if (current) res.set('X-Phase3-State-Token', encodeURIComponent(JSON.stringify(current)));
                }
                return json(value);
            };
            // The same captured scope is rechecked at ordinary file sinks,
            // including writes after an asynchronous request has yielded.
            return ordinaryRequest.run({ directory, id: req.params.id, token }, next);
        }
        catch (error) { res.status(error.statusCode ?? 409).json({ code: error.message }); }
    };
}
