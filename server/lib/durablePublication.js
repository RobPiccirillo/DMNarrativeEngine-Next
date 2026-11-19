import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { duplicateJsonKeys } from './jsonSourceIntegrity.js';

let publicationSequence = 0;

export const byteVersion = bytes => bytes === null ? 'absent' : `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function readExact(file) {
    try { return fs.readFileSync(file); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function publishDurable(file, bytes, boundary = () => {}) {
    let temporary, fd;
    for (let attempts = 0; attempts < 1024; attempts++) {
        if (!Number.isSafeInteger(++publicationSequence)) throw new Error('publication-sequence-exhausted');
        temporary = `${file}.publish-${process.pid}-${publicationSequence}`;
        try { fd = fs.openSync(temporary, 'wx'); break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (fd === undefined) throw new Error('publication-temporary-conflict');
    let owned = false;
    try {
        owned = true;
        try {
            boundary('temporary-opened');
            fs.writeFileSync(fd, bytes); boundary('temporary-written');
            fs.fsyncSync(fd); boundary('temporary-synced');
        } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, file); owned = false; boundary('renamed');
        let directory;
        try { directory = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(directory); }
        catch (error) {
            if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EACCES', 'EBADF'].includes(error.code)) throw error;
        } finally { if (directory !== undefined) fs.closeSync(directory); }
        boundary('directory-synced');
    } finally {
        if (owned) fs.unlinkSync(temporary);
    }
}

export function parseStrictJson(bytes) {
    if (bytes === null) return null;
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('invalid-file-encoding');
    try {
        const value = JSON.parse(text);
        if (duplicateJsonKeys(bytes)) throw new Error();
        return value;
    }
    catch { throw new Error('corrupt-lifecycle-file'); }
}

export function readStrictJson(file) { return parseStrictJson(readExact(file)); }
