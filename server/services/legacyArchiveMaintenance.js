import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { byteVersion, readExact, readStrictJson, publishDurable } from '../lib/durablePublication.js';
import fs from 'node:fs';
import { assertOrdinaryCampaignWrite } from '../lib/acceptanceWriteGuard.js';

const targets = Object.freeze({ archive: '.archive.md', index: '.archive.index.json', chapters: '.archive.chapters.json', timeline: '.timeline.json' });
const fail = code => { throw Object.assign(new Error(code), { code, statusCode: 409 }); };
const blocks = bytes => new Map((bytes?.toString('utf8') ?? '').split(/^(?=## SCENE )/m).flatMap(block => {
    const id = block.match(/^## SCENE (\d+)/)?.[1]; return id ? [[id, block]] : [];
}));

// Called only by the synchronous archive repository inside the existing
// campaign maintenance lock. This records legacy maintenance, not a new
// revision of accepted Story or a world-map staging API.
export function maintainLegacyArchive(directory, id, changes, boundary = () => {}) {
    const journalFile = path.join(directory, id + '.acceptance.json');
    const journal = readStrictJson(journalFile);
    if (!journal) return false;
    assertOrdinaryCampaignWrite(directory, id);
    if (!Array.isArray(changes) || !changes.length || new Set(changes.map(change => change.target)).size !== changes.length) fail('invalid-archive-maintenance');
    const operations = changes.map(({ target, after }) => {
        if (!Object.hasOwn(targets, target) || after !== null && !Buffer.isBuffer(after)) fail('invalid-archive-maintenance');
        const before = readExact(path.join(directory, id + targets[target]));
        return { target, beforeVersion: byteVersion(before), afterVersion: byteVersion(after),
            afterBase64: after === null ? null : after.toString('base64') };
    });
    if (operations.every(operation => operation.beforeVersion === operation.afterVersion)) return true;
    if (!Number.isSafeInteger(journal.generation) || journal.generation >= Number.MAX_SAFE_INTEGER) fail('head-generation-exhausted');
    const archive = changes.find(change => change.target === 'archive');
    const beforeBlocks = blocks(readExact(path.join(directory, id + targets.archive))), afterBlocks = archive ? blocks(archive.after) : beforeBlocks;
    const scenes = [...new Set([...beforeBlocks.keys(), ...afterBlocks.keys()])].filter(scene => beforeBlocks.get(scene) !== afterBlocks.get(scene));
    const entry = { format: 'legacy-archive-maintenance-v1', status: 'pending', generation: journal.generation + 1,
        beforeHead: journal.head, afterHead: `legacy-maintenance:${randomUUID()}`, affectedScenes: scenes, operations };
    journal.maintenance ??= []; journal.maintenance.push(entry);
    const publish = () => publishDurable(journalFile, Buffer.from(JSON.stringify(journal, null, 2)));
    publish(); boundary('maintenance-intent-published');
    // A fault leaves the durable pending entry in place. Ordinary writes and
    // unseen acceptances stay closed; hydration never guesses derived repairs.
    for (const operation of operations) {
        const file = path.join(directory, id + targets[operation.target]);
        if (byteVersion(readExact(file)) !== operation.beforeVersion) fail('archive-maintenance-version-conflict');
        boundary(`before-maintenance-write:${operation.target}`);
        if (operation.afterBase64 === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
        else publishDurable(file, Buffer.from(operation.afterBase64, 'base64'));
        boundary(`after-maintenance-write:${operation.target}`);
        if (byteVersion(readExact(file)) !== operation.afterVersion) fail('archive-maintenance-verification-failed');
    }
    entry.status = 'completed'; journal.head = entry.afterHead; journal.generation = entry.generation;
    publish(); boundary('maintenance-outcome-published');
    return true;
}
