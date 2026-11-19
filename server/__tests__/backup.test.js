import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Backup functions read CAMPAIGNS_DIR and BACKUPS_DIR from fileStore at import time.
// We control DATA_DIR via env before dynamic import to get a temp-dir-scoped instance.

let tmpDir;
let createBackup;
let updateBackupLabel;
let pruneAutoBackups;
let restoreBackup;
let CAMPAIGNS_DIR;
let BACKUPS_DIR;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    process.env.DATA_DIR = tmpDir;

    // Dynamic import ensures each test gets fresh module evaluation
    // (vitest resets module cache between tests via isolateModules)
    const backup = await import('../services/backup.js?t=' + Date.now());
    const store = await import('../lib/fileStore.js?t=' + Date.now());

    createBackup = backup.createBackup;
    updateBackupLabel = backup.updateBackupLabel;
    pruneAutoBackups = backup.pruneAutoBackups;
    restoreBackup = backup.restoreBackup;
    CAMPAIGNS_DIR = store.CAMPAIGNS_DIR;
    BACKUPS_DIR = store.BACKUPS_DIR;

    fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true });
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
});

afterEach(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedCampaign(id, name = 'Test Campaign') {
    const data = { id, name, lastPlayedAt: Date.now() };
    fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.json`), JSON.stringify(data));
    fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.state.json`), JSON.stringify({ messages: [] }));
}

describe('managed lifecycle backup and restore', () => {
    it('restores the selected revision and embedded image after original files are unavailable', async () => {
        const { readyLifecycle } = await import('./fixtures/lifecycleCampaign.js');
        const f = await readyLifecycle(CAMPAIGNS_DIR, 'portable-backup');
        const imageDirectory = path.join(CAMPAIGNS_DIR, f.id, 'scene-images'); fs.mkdirSync(imageDirectory, { recursive: true });
        const image = path.join(imageDirectory, 'story.png'); fs.writeFileSync(image, 'synthetic image');
        const state = JSON.parse(f.read('.state.json')); state.messages[0].attachmentUrl = `/assets/campaigns/${f.id}/scene-images/story.png`; f.write('.state.json', state);
        const original = f.read('.state.json'), drafts = JSON.parse(f.read('.drafts.json'));
        const saved = createBackup(f.id);
        expect(JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, f.id, String(saved.timestamp), 'meta.json'))).lifecycleStatus).toBe('playable');
        for (const name of fs.readdirSync(CAMPAIGNS_DIR).filter(name => name.startsWith(f.id + '.'))) fs.unlinkSync(path.join(CAMPAIGNS_DIR, name));
        fs.unlinkSync(image);
        await restoreBackup(f.id, saved.timestamp);
        expect(f.read('.state.json')).toEqual(original);
        const restored = JSON.parse(f.read('.drafts.json'));
        expect(restored.sets).toEqual(drafts.sets); expect(restored.storageGuard.token).not.toBe(drafts.storageGuard.token);
        const alias = restored.storageGuard.assetAliases[state.messages[0].attachmentUrl];
        expect(fs.readFileSync(path.join(imageDirectory, path.basename(alias)), 'utf8')).toBe('synthetic image');
    });
    it('rejects a backed-up in-flight acceptance before changing current files', async () => {
        const { readyLifecycle } = await import('./fixtures/lifecycleCampaign.js');
        const { createAcceptanceCoordinator } = await import('../services/acceptanceCoordinator.js');
        const f = await readyLifecycle(CAMPAIGNS_DIR, 'unresolved-backup');
        await createAcceptanceCoordinator({ directory: CAMPAIGNS_DIR, authorityDirectory: path.join(tmpDir, 'authority') }).preflight(f.id, f.candidate, f.view.saveToken.storageToken);
        const saved = createBackup(f.id), before = f.read('.acceptance.json');
        await expect(restoreBackup(f.id, saved.timestamp)).rejects.toThrow('Recover and acknowledge');
        expect(f.read('.acceptance.json')).toEqual(before);
    });
    it('explicitly initializes an older backup in detached storage before replacing a managed campaign', async () => {
        const { readyLifecycle } = await import('./fixtures/lifecycleCampaign.js');
        const id = 'old-backup'; seedCampaign(id);
        const legacyState = { context: {}, messages: [] }; fs.writeFileSync(path.join(CAMPAIGNS_DIR, id + '.state.json'), JSON.stringify(legacyState));
        const saved = createBackup(id);
        const f = await readyLifecycle(CAMPAIGNS_DIR, id), oldToken = JSON.parse(f.read('.drafts.json')).storageGuard.token;
        await restoreBackup(id, saved.timestamp);
        expect(JSON.parse(f.read('.state.json'))).toEqual(legacyState);
        const restored = JSON.parse(f.read('.drafts.json'));
        expect(restored.storageGuard.token).not.toBe(oldToken); expect(restored.storageGuard.phase).toBe('ready');
        expect(restored.storageGuard.history.at(-1)).toMatchObject({ kind: 'restore', sourceStorageId: id, storageId: id });
        expect(fs.readdirSync(path.join(BACKUPS_DIR, id)).some(name => name.startsWith('.restore-'))).toBe(false);
    });
});

describe('createBackup', () => {
    it('creates a backup directory with meta.json', () => {
        const id = 'camp1';
        seedCampaign(id);
        const result = createBackup(id, { label: 'test', trigger: 'manual', isAuto: false });

        expect(result.timestamp).toBeDefined();
        expect(result.fileCount).toBeGreaterThan(0);

        const backupDir = path.join(BACKUPS_DIR, id, String(result.timestamp));
        expect(fs.existsSync(backupDir)).toBe(true);

        const meta = JSON.parse(fs.readFileSync(path.join(backupDir, 'meta.json'), 'utf-8'));
        expect(meta.label).toBe('test');
        expect(meta.trigger).toBe('manual');
        expect(meta.campaignName).toBe('Test Campaign');
    });

    it('copies campaign files into the backup directory', () => {
        const id = 'camp2';
        seedCampaign(id);
        const result = createBackup(id, {});
        const backupDir = path.join(BACKUPS_DIR, id, String(result.timestamp));
        const backedFiles = fs.readdirSync(backupDir).filter(f => f !== 'meta.json');
        expect(backedFiles.length).toBeGreaterThan(0);
    });

    it('skips auto-backup when hash unchanged', () => {
        const id = 'camp3';
        seedCampaign(id);
        createBackup(id, { isAuto: true });
        const result2 = createBackup(id, { isAuto: true });
        expect(result2.skipped).toBe(true);
    });

    it('creates new auto-backup when data changes', () => {
        const id = 'camp4';
        seedCampaign(id);
        createBackup(id, { isAuto: true });
        // Modify campaign data to change hash
        fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.json`), JSON.stringify({ id, name: 'Changed', lastPlayedAt: 999 }));
        const result2 = createBackup(id, { isAuto: true });
        expect(result2.skipped).toBeUndefined();
        expect(result2.timestamp).toBeDefined();
    });
});

describe('restoreBackup', () => {
    // A backup taken before the campaign's first scene contains no archive files
    // at all, because createBackup only copies files that exist. Restore used to
    // copy just the backup's own files, which left every archive file written
    // afterwards on disk — so a "restore to blank" kept the scenes, and sealing
    // the chapter summarised scenes the restored campaign never had.
    it('deletes campaign files the backup predates', () => {
        const id = 'restore_blank';
        seedCampaign(id);
        const { timestamp } = createBackup(id, { label: 'blank' });

        // Play a turn: the archive files appear for the first time.
        fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.archive.md`), '## SCENE 001\nGhost scene.\n');
        fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.archive.index.json`), JSON.stringify([{ sceneId: '001' }]));
        fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.archive.chapters.json`), JSON.stringify([{ chapterId: 'CH01', sceneIds: ['001'] }]));

        restoreBackup(id, timestamp);

        expect(fs.existsSync(path.join(CAMPAIGNS_DIR, `${id}.archive.md`))).toBe(false);
        expect(fs.existsSync(path.join(CAMPAIGNS_DIR, `${id}.archive.index.json`))).toBe(false);
        expect(fs.existsSync(path.join(CAMPAIGNS_DIR, `${id}.archive.chapters.json`))).toBe(false);
    });

    it('overwrites files the backup does contain', () => {
        const id = 'restore_overwrite';
        seedCampaign(id);
        fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.archive.md`), '## SCENE 001\nOriginal.\n');
        const { timestamp } = createBackup(id, { label: 'one scene' });

        fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.archive.md`), '## SCENE 001\nOriginal.\n## SCENE 002\nLater.\n');

        restoreBackup(id, timestamp);

        const md = fs.readFileSync(path.join(CAMPAIGNS_DIR, `${id}.archive.md`), 'utf-8');
        expect(md).toContain('SCENE 001');
        expect(md).not.toContain('SCENE 002');
    });

    it('never deletes the campaign identity file', () => {
        const id = 'restore_identity';
        seedCampaign(id);
        // A hand-made backup directory missing `${id}.json` must not unlist the campaign.
        const ts = Date.now();
        const backupDir = path.join(BACKUPS_DIR, id, String(ts));
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'meta.json'), JSON.stringify({ timestamp: ts }));
        fs.writeFileSync(path.join(backupDir, `${id}.state.json`), JSON.stringify({ messages: [] }));

        restoreBackup(id, ts);

        expect(fs.existsSync(path.join(CAMPAIGNS_DIR, `${id}.json`))).toBe(true);
    });

    it('takes a pre-restore backup before touching anything', () => {
        const id = 'restore_undo';
        seedCampaign(id);
        const { timestamp } = createBackup(id, { label: 'blank' });
        fs.writeFileSync(path.join(CAMPAIGNS_DIR, `${id}.archive.md`), '## SCENE 001\nGhost scene.\n');

        const preRestore = restoreBackup(id, timestamp);

        const preRestoreDir = path.join(BACKUPS_DIR, id, String(preRestore.timestamp));
        expect(fs.existsSync(path.join(preRestoreDir, `${id}.archive.md`))).toBe(true);
    });

    it('throws a 404-shaped error for a missing backup', () => {
        const id = 'restore_missing';
        seedCampaign(id);
        expect(() => restoreBackup(id, 1)).toThrowError(/Backup not found/);
    });
});

describe('updateBackupLabel', () => {
    it('updates backup label in meta.json', () => {
        const id = 'label1';
        seedCampaign(id);
        const res = createBackup(id, { isAuto: true });
        const updatedMeta = updateBackupLabel(id, res.timestamp, 'Custom Name');

        expect(updatedMeta.label).toBe('Custom Name');

        const backupDir = path.join(BACKUPS_DIR, id, String(res.timestamp));
        const metaOnDisk = JSON.parse(fs.readFileSync(path.join(backupDir, 'meta.json'), 'utf-8'));
        expect(metaOnDisk.label).toBe('Custom Name');
    });
});

describe('pruneAutoBackups', () => {
    it('removes old auto-backups beyond the keep limit', () => {
        const id = 'prune1';
        seedCampaign(id);

        // Create 5 auto-backups with different hashes (change data each time)
        for (let i = 0; i < 5; i++) {
            fs.writeFileSync(
                path.join(CAMPAIGNS_DIR, `${id}.json`),
                JSON.stringify({ id, name: `Campaign v${i}`, lastPlayedAt: i })
            );
            createBackup(id, { isAuto: true });
        }

        pruneAutoBackups(id, 3);

        const backupDir = path.join(BACKUPS_DIR, id);
        const remaining = fs.readdirSync(backupDir)
            .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory());
        expect(remaining.length).toBeLessThanOrEqual(3);
    });

    it('spares named auto-backups from auto-pruning', () => {
        const id = 'prune_named';
        seedCampaign(id);

        const createdTimestamps = [];
        for (let i = 0; i < 5; i++) {
            fs.writeFileSync(
                path.join(CAMPAIGNS_DIR, `${id}.json`),
                JSON.stringify({ id, name: `Campaign v${i}`, lastPlayedAt: i })
            );
            const res = createBackup(id, { isAuto: true });
            createdTimestamps.push(res.timestamp);
        }

        // Give a name to the oldest auto-backup
        updateBackupLabel(id, createdTimestamps[0], 'Protected Save');

        // Prune keeping 2
        pruneAutoBackups(id, 2);

        const backupDir = path.join(BACKUPS_DIR, id);
        const remainingFolders = fs.readdirSync(backupDir)
            .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory());

        // Oldest backup was named so it must still exist!
        expect(remainingFolders).toContain(String(createdTimestamps[0]));
    });
});

