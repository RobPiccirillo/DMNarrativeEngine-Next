import fs from 'fs';
import path from 'path';
import { CAMPAIGNS_DIR, BACKUPS_DIR, readJson, writeJson, computeCampaignHash, campaignFiles, campaignFileNames, archiveIndexPath, validateCampaignId } from '../lib/fileStore.js';
import { listArchiveSceneIds, deleteArchiveEmbedding } from '../lib/vectorStore.js';
import { exportLifecycleBundle, publishLifecycleBundle, validateLifecycleBundle } from './legacyLifecycleTransfer.js';
import { createDraftLifecycleService } from './draftLifecycleService.js';
import { withCampaignLock } from '../lib/writeLock.js';
import { assertOrdinaryCampaignWrite } from '../lib/acceptanceWriteGuard.js';
import { randomUUID } from 'node:crypto';
import { publishDurable } from '../lib/durablePublication.js';

export function createBackup(id, opts = {}) {
    validateCampaignId(id);
    const { label = '', trigger = 'manual', isAuto = false } = opts;
    let now = Date.now();
    const hash = computeCampaignHash(id);
    const managed = ['.drafts.json', '.acceptance.json'].some(suffix => fs.existsSync(path.join(CAMPAIGNS_DIR, id + suffix)));
    const managedFiles = managed ? fs.readdirSync(CAMPAIGNS_DIR).filter(name => name.startsWith(id + '.')) : [];
    if (managedFiles.some(name => { const stat = fs.lstatSync(path.join(CAMPAIGNS_DIR, name)); return stat.isSymbolicLink() || !stat.isFile(); })) {
        throw Object.assign(new Error('unsafe-managed-backup-source'), { statusCode: 409 });
    }

    if (isAuto) {
        const backupDir = path.join(BACKUPS_DIR, id);
        if (fs.existsSync(backupDir)) {
            const folders = fs.readdirSync(backupDir)
                .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory())
                .sort()
                .reverse();
            for (const folder of folders) {
                const metaFile = path.join(backupDir, folder, 'meta.json');
                if (fs.existsSync(metaFile)) {
                    const meta = readJson(metaFile);
                    if (meta && meta.isAuto && meta.hash === hash) {
                        return { skipped: true };
                    }
                    break;
                }
            }
        }
    }

    while (fs.existsSync(path.join(BACKUPS_DIR, id, String(now)))) now++;
    const backupPath = path.join(BACKUPS_DIR, id, String(now));
    fs.mkdirSync(backupPath, { recursive: true });

    const files = managed ? managedFiles : campaignFiles(id);
    for (const name of files) {
        const src = path.join(CAMPAIGNS_DIR, name);
        const dst = path.join(backupPath, name);
        fs.copyFileSync(src, dst);
    }
    let lifecycleStatus;
    if (managed) {
        try {
            const bundle = exportLifecycleBundle(id);
            publishDurable(path.join(backupPath, 'lifecycle.bundle.json'), Buffer.from(JSON.stringify(bundle)));
            lifecycleStatus = bundle.status;
        } catch (error) { lifecycleStatus = `recovery-required:${error.code ?? error.message}`; }
    }

    const campaignMeta = readJson(path.join(CAMPAIGNS_DIR, `${id}.json`), {});

    const meta = {
        timestamp: now,
        label,
        trigger,
        hash,
        fileCount: files.length,
        isAuto,
        campaignName: campaignMeta.name || 'Unknown',
        ...(managed ? { lifecycleStatus } : {}),
    };
    writeJson(path.join(backupPath, 'meta.json'), meta);

    if (isAuto) {
        pruneAutoBackups(id, 10);
    }

    return { timestamp: now, hash, fileCount: files.length };
}

/**
 * Roll a campaign back to a backup.
 *
 * Restore REPLACES the campaign's file set — it does not merge into it.
 * `createBackup` only copies files that already exist (`campaignFiles`), so a
 * backup taken before the first scene contains no `.archive.md`,
 * `.archive.index.json` or `.archive.chapters.json` at all. Copying only what
 * the backup holds therefore left every file written AFTER the backup in place:
 * restoring a blank campaign kept the scenes, the archive index and the
 * chapters recorded since, and sealing the chapter then summarised scenes the
 * restored state never contained. Any campaign file the backup lacks must go.
 *
 * Returns the pre-restore backup so the caller can offer an undo.
 */
export function restoreBackup(id, ts) {
    validateCampaignId(id);
    if (!/^\d+$/.test(String(ts))) throw Object.assign(new Error('Invalid backup timestamp'), { statusCode: 400 });
    const backupPath = path.join(BACKUPS_DIR, id, String(ts));
    if (!fs.existsSync(backupPath)) {
        const err = new Error('Backup not found');
        err.statusCode = 404;
        throw err;
    }
    if (fs.existsSync(path.join(backupPath, 'lifecycle.bundle.json')) || ['.drafts.json', '.acceptance.json'].some(suffix =>
        fs.existsSync(path.join(CAMPAIGNS_DIR, id + suffix)) || fs.existsSync(path.join(backupPath, id + suffix)))) {
        return restoreManagedBackup(id, backupPath, ts);
    }

    const preRestore = createBackup(id, {
        label: `Pre-restore from ${new Date(Number(ts)).toLocaleString()}`,
        trigger: 'pre-restore',
        isAuto: false,
    });

    const backupFiles = new Set(fs.readdirSync(backupPath).filter(f => f !== 'meta.json'));
    const metaName = `${id}.json`;
    for (const name of campaignFileNames(id)) {
        const dst = path.join(CAMPAIGNS_DIR, name);
        if (backupFiles.has(name)) {
            fs.copyFileSync(path.join(backupPath, name), dst);
        } else if (name !== metaName && fs.existsSync(dst)) {
            // Never delete `${id}.json` — it is the campaign's identity record,
            // and dropping it would unlist the campaign entirely. The backup
            // endpoint refuses to run without it, so a real backup always
            // carries one; this only guards hand-made backup directories.
            fs.rmSync(dst, { force: true });
        }
    }

    purgeOrphanedSceneEmbeddings(id);

    return preRestore;
}

async function restoreManagedBackup(id, backupPath, ts) {
    let bundle;
    const portable = path.join(backupPath, 'lifecycle.bundle.json');
    if (fs.existsSync(portable)) bundle = JSON.parse(fs.readFileSync(portable, 'utf8'));
    else {
        if (['.drafts.json', '.acceptance.json'].some(suffix => fs.existsSync(path.join(backupPath, id + suffix)))) {
            throw Object.assign(new Error('Backup lifecycle evidence needs recovery before playable restore'), { statusCode: 409 });
        }
        const stageRoot = path.resolve(BACKUPS_DIR, id, `.restore-${randomUUID()}`), parent = path.resolve(BACKUPS_DIR, id);
        if (!stageRoot.startsWith(parent + path.sep) || path.dirname(stageRoot) !== parent) throw new Error('unsafe-restore-staging');
        const campaigns = path.join(stageRoot, 'campaigns'), stagingId = randomUUID();
        fs.mkdirSync(campaigns, { recursive: true });
        try {
            for (const name of fs.readdirSync(backupPath).filter(name => name.startsWith(id + '.'))) {
                const source = path.join(backupPath, name);
                if (!fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw new Error('unsafe-backup-source');
                fs.copyFileSync(source, path.join(campaigns, stagingId + name.slice(id.length)));
            }
            const metaFile = path.join(campaigns, stagingId + '.json'), meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
            publishDurable(metaFile, Buffer.from(JSON.stringify({ ...meta, id: stagingId })));
            await createDraftLifecycleService({ directory: campaigns, authorityDirectory: path.join(stageRoot, 'authority') }).initialize(stagingId);
            bundle = exportLifecycleBundle(stagingId, { directory: campaigns, dataRoot: stageRoot, portraitRoot: path.join(stageRoot, 'portraits') });
        } finally {
            if (path.dirname(path.resolve(stageRoot)) !== parent || !path.basename(stageRoot).startsWith('.restore-')) throw new Error('unsafe-restore-staging-cleanup');
            fs.rmSync(stageRoot, { recursive: true, force: true });
        }
    }
    const proof = validateLifecycleBundle(bundle);
    if (proof.validation.unresolved) throw Object.assign(new Error('Recover and acknowledge the backed-up acceptance before playable restore'), { statusCode: 409 });
    return withCampaignLock(id, () => {
        const draftFile = path.join(CAMPAIGNS_DIR, id + '.drafts.json');
        const phase = fs.existsSync(draftFile) ? JSON.parse(fs.readFileSync(draftFile, 'utf8')).storageGuard?.phase : null;
        if (phase !== 'restoring') assertOrdinaryCampaignWrite(CAMPAIGNS_DIR, id);
        const before = createBackup(id, { label: `Pre-restore from ${new Date(Number(ts)).toLocaleString()}`, trigger: 'pre-restore' });
        publishLifecycleBundle(bundle, id, { restore: true, originStorageId: id });
        purgeOrphanedSceneEmbeddings(id);
        return before;
    });
}

/**
 * Scene vectors live in embeddings.db, which backups do not cover. Drop every
 * vector whose scene is absent from the (restored) archive index — otherwise
 * semantic recall keeps surfacing scenes the campaign no longer has. Non-fatal:
 * a stale vector degrades recall, it does not corrupt the save.
 */
function purgeOrphanedSceneEmbeddings(id) {
    try {
        const index = readJson(archiveIndexPath(id), []);
        const restoredIds = new Set(
            (Array.isArray(index) ? index : [])
                .map(e => String(e?.sceneId ?? '').trim())
                .filter(Boolean)
                .map(s => s.padStart(3, '0'))
        );
        for (const sceneId of listArchiveSceneIds(id)) {
            if (!restoredIds.has(String(sceneId).padStart(3, '0'))) {
                deleteArchiveEmbedding(id, sceneId);
            }
        }
    } catch (e) {
        console.warn(`[Backup] Restore embedding purge failed: ${e.message}`);
    }
}

export function updateBackupLabel(id, ts, label) {
    const backupPath = path.join(BACKUPS_DIR, id, String(ts));
    const metaPath = path.join(backupPath, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;

    const meta = readJson(metaPath, {});
    meta.label = label ? String(label).trim() : '';
    writeJson(metaPath, meta);
    return meta;
}

export function pruneAutoBackups(id, keep) {
    const backupDir = path.join(BACKUPS_DIR, id);
    if (!fs.existsSync(backupDir)) return;

    const folders = fs.readdirSync(backupDir)
        .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory())
        .map(f => {
            const meta = readJson(path.join(backupDir, f, 'meta.json'), {});
            return { folder: f, isAuto: meta.isAuto || false, label: meta.label || '' };
        })
        .filter(f => f.isAuto && !f.label.trim())
        .sort((a, b) => Number(b.folder) - Number(a.folder));

    for (let i = keep; i < folders.length; i++) {
        const dirToRemove = path.join(backupDir, folders[i].folder);
        fs.rmSync(dirToRemove, { recursive: true, force: true });
    }
}

