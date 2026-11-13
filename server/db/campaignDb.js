import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migration } from './migrations/001-staging.js';
import { digest, fail, canonical } from '../services/campaignMigration/artifact.js';

export const MIGRATIONS = [migration];
export const APPLICATION_ID = 0x444d4e32;
export function transaction(db, callback) {
    if (callback.constructor.name === 'AsyncFunction') fail('async-transaction-refused');
    return db.transaction(() => {
        const result = callback();
        if (result && typeof result.then === 'function') fail('async-transaction-refused');
        return result;
    }).immediate();
}
export function migrate(db, migrations = MIGRATIONS) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get();
    const history = exists ? db.prepare('SELECT * FROM schema_migrations ORDER BY version').all() : [];
    for (let i = 0; i < history.length; i++) {
        const m = migrations[i], applied = history[i];
        if (!m || applied.version !== i + 1 || m.version !== applied.version || m.name !== applied.name || digest(m) !== applied.checksum) fail('schema-history-mismatch');
    }
    for (let i = history.length; i < migrations.length; i++) {
        const m = migrations[i];
        if (m.version !== i + 1) fail('schema-gap');
        transaction(db, () => {
            db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL)');
            db.exec(m.sql);
            db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(m.version, m.name, digest(m));
            db.pragma(`user_version = ${m.version}`);
        });
    }
}
export function integrity(db) {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) fail('integrity-failed');
    return true;
}
export function openCampaignDb({ file, mode, binding }) {
    if (!path.isAbsolute(file) || !binding || !['create-staging','inspect-readonly','upgrade-disposable-copy'].includes(mode)) fail('invalid-db-options');
    const create = mode === 'create-staging', readonly = mode === 'inspect-readonly';
    if (create && fs.existsSync(file)) fail('destination-exists');
    if (create) fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file, { readonly, fileMustExist: !create, timeout: 5000 });
    try {
        db.pragma('foreign_keys = ON');
        if (!db.pragma('foreign_keys', { simple: true })) fail('foreign-keys-unavailable');
        if (!readonly) {
            if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') fail('wal-unavailable');
            db.pragma('synchronous = FULL');
            if (db.pragma('synchronous', { simple: true }) !== 2) fail('full-sync-unavailable');
        }
        if (create) { db.pragma(`application_id = ${APPLICATION_ID}`); migrate(db); db.prepare('INSERT INTO staging_campaign VALUES (1,?)').run(canonical(binding)); }
        else {
            if (db.pragma('application_id', { simple: true }) !== APPLICATION_ID) fail('wrong-application');
            // Service reopen never upgrades a published artifact in place. Future schema
            // upgrades must first allocate a disposable copy through an explicit tool.
            const history = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
            if (history.length !== MIGRATIONS.length || history.some((h, i) => h.version !== i + 1 || h.checksum !== digest(MIGRATIONS[i]) || h.name !== MIGRATIONS[i].name)
                || db.pragma('user_version', { simple: true }) !== MIGRATIONS.length) fail('schema-history-mismatch');
            if (db.prepare('SELECT binding FROM staging_campaign WHERE singleton=1').get()?.binding !== canonical(binding)) fail('db-binding-mismatch');
        }
        integrity(db);
        return db;
    } catch (e) { db.close(); throw e; }
}
