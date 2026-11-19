import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { BUILTIN_CAMPAIGN_FILE_SUFFIXES, CAMPAIGNS_DIR, DATA_DIR, PUBLIC_ASSETS_DIR, validateCampaignId } from '../lib/fileStore.js';
import { assetReferences, assetLocation } from '../lib/legacyAssetReferences.js';
import { parseStrictJson, publishDurable } from '../lib/durablePublication.js';
import { validateLifecycleSources } from './lifecycleValidation.js';
import { unsupportedAuthorityBundle } from '../lib/legacyBundleGuard.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code, statusCode: 409 }); };
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const allowedSuffix = suffix => BUILTIN_CAMPAIGN_FILE_SUFFIXES.includes(suffix) || /^\.mod-[a-zA-Z0-9_.-]+\.json$/.test(suffix);
const defaults = () => ({ directory: CAMPAIGNS_DIR, dataRoot: DATA_DIR, portraitRoot: PUBLIC_ASSETS_DIR });
function resolveAlias(reference, aliases) {
    const seen = new Set(); let current = reference;
    while (aliases[current] && aliases[current] !== current) {
        if (seen.has(current)) fail('lifecycle-asset-alias-cycle');
        seen.add(current); current = aliases[current];
    }
    return current;
}

function inside(root, relative, allowMissing = false) {
    const base = path.resolve(root), target = path.resolve(base, relative);
    if (target !== base && !target.startsWith(base + path.sep)) fail('unsafe-lifecycle-asset-path');
    let cursor = base;
    for (const part of path.relative(base, target).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        if (!fs.existsSync(cursor)) { if (allowMissing) continue; return null; }
        if (fs.lstatSync(cursor).isSymbolicLink()) fail('lifecycle-asset-symlink-refused');
    }
    return target;
}
function assetPath(reference, id, options, allowMissing = false) {
    const location = assetLocation(reference, id);
    return { ...location, path: inside(location.group === 'portraits' ? options.portraitRoot : options.dataRoot, location.relative, allowMissing) };
}
function checkedFiles(files) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) fail('invalid-lifecycle-transfer-files');
    const bytes = new Map();
    for (const [suffix, entry] of Object.entries(files)) {
        if (!allowedSuffix(suffix) || !entry || typeof entry.base64 !== 'string') fail('invalid-lifecycle-transfer-target');
        const value = Buffer.from(entry.base64, 'base64');
        if (value.toString('base64') !== entry.base64 || digest(value) !== entry.sha256) fail('lifecycle-transfer-byte-conflict');
        if (suffix.endsWith('.json')) parseStrictJson(value);
        bytes.set(suffix, value);
    }
    return bytes;
}
const bundleBody = bundle => ({ version: bundle.version, format: bundle.format, sourceStorageId: bundle.sourceStorageId,
    campaignInstance: bundle.campaignInstance, files: bundle.files, assets: bundle.assets });

export function exportLifecycleBundle(id, supplied = {}) {
    validateCampaignId(id); const options = { ...defaults(), ...supplied }, files = {};
    if (fs.existsSync(path.join(supplied.authorityDirectory ?? path.join(options.dataRoot, 'authority'), id + '.authority.json'))) fail('lifecycle-transfer-authority-review-required');
    for (const name of fs.readdirSync(options.directory).filter(name => name.startsWith(id + '.')).sort()) {
        const suffix = name.slice(id.length);
        if (!allowedSuffix(suffix)) fail('lifecycle-export-recovery-artifacts-present');
        const file = path.join(options.directory, name);
        if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail('lifecycle-export-unsafe-source');
        const bytes = fs.readFileSync(file); files[suffix] = { base64: bytes.toString('base64'), sha256: digest(bytes) };
    }
    const bytes = checkedFiles(files), validation = validateLifecycleSources(suffix => bytes.get(suffix) ?? null);
    if (!validation.managed || !validation.valid) fail(validation.errors[0] ?? 'lifecycle-export-not-managed');
    const metadata = parseStrictJson(bytes.get('.json') ?? null), drafts = parseStrictJson(bytes.get('.drafts.json'));
    if (metadata?.id !== id || drafts.storageGuard && drafts.storageGuard.storageId !== id) fail('lifecycle-export-storage-binding-conflict');
    const aliases = drafts.storageGuard?.assetAliases ?? {}, references = new Set();
    for (const [suffix, value] of bytes) for (const reference of assetReferences(suffix.endsWith('.json') ? parseStrictJson(value) : value.toString('utf8'), !suffix.endsWith('.json'))) references.add(reference);
    const assets = [...references].sort().map(reference => {
        const storedReference = resolveAlias(reference, aliases);
        const target = assetPath(storedReference, id, options);
        if (!target.path || !fs.existsSync(target.path)) {
            if (target.required) fail('missing-required-lifecycle-asset');
            return { reference, storedReference, missing: true };
        }
        const value = fs.readFileSync(target.path);
        return { reference, storedReference, sha256: digest(value), base64: value.toString('base64') };
    });
    const body = { version: 2, format: 'legacy-lifecycle-transfer-v1', sourceStorageId: id, campaignInstance: validation.campaignInstance, files, assets };
    return { ...body, status: validation.unresolved ? 'recovery-required' : 'playable', digest: digest(Buffer.from(canonical(body))) };
}

export function validateLifecycleBundle(bundle) {
    if (!bundle || bundle.version !== 2 || bundle.format !== 'legacy-lifecycle-transfer-v1') fail('unsupported-lifecycle-transfer');
    if (!bundle.files || typeof bundle.files !== 'object' || Array.isArray(bundle.files) || !Array.isArray(bundle.assets) || typeof bundle.digest !== 'string') fail('invalid-lifecycle-transfer');
    if (unsupportedAuthorityBundle(bundle)) fail('lifecycle-transfer-authority-review-required');
    validateCampaignId(bundle.sourceStorageId);
    if (digest(Buffer.from(canonical(bundleBody(bundle)))) !== bundle.digest) fail('lifecycle-transfer-integrity-conflict');
    const bytes = checkedFiles(bundle.files), validation = validateLifecycleSources(suffix => bytes.get(suffix) ?? null);
    if (!validation.managed || !validation.valid || validation.campaignInstance !== bundle.campaignInstance) fail(validation.errors[0] ?? 'invalid-lifecycle-transfer');
    const metadata = parseStrictJson(bytes.get('.json') ?? null);
    if (unsupportedAuthorityBundle(metadata)) fail('lifecycle-transfer-authority-review-required');
    if (metadata?.id !== bundle.sourceStorageId || !Array.isArray(bundle.assets)) fail('lifecycle-transfer-storage-binding-conflict');
    const drafts = parseStrictJson(bytes.get('.drafts.json'));
    if (drafts.storageGuard && drafts.storageGuard.storageId !== bundle.sourceStorageId) fail('lifecycle-transfer-storage-binding-conflict');
    const references = new Set();
    for (const [suffix, value] of bytes) for (const reference of assetReferences(suffix.endsWith('.json') ? parseStrictJson(value) : value.toString('utf8'), !suffix.endsWith('.json'))) references.add(reference);
    const found = new Set();
    for (const asset of bundle.assets) {
        if (!asset || !references.has(asset.reference) || found.has(asset.reference)) fail('lifecycle-transfer-asset-inventory-conflict');
        found.add(asset.reference);
        if (resolveAlias(asset.reference, drafts.storageGuard?.assetAliases ?? {}) !== asset.storedReference) fail('lifecycle-transfer-asset-binding-conflict');
        const target = assetLocation(asset.storedReference, bundle.sourceStorageId);
        if (asset.missing) { if (target.required) fail('missing-required-lifecycle-asset'); continue; }
        if (typeof asset.base64 !== 'string') fail('invalid-lifecycle-asset-bytes');
        const value = Buffer.from(asset.base64, 'base64');
        if (value.toString('base64') !== asset.base64 || digest(value) !== asset.sha256) fail('lifecycle-transfer-asset-conflict');
    }
    if (found.size !== references.size) fail('lifecycle-transfer-asset-inventory-conflict');
    return { bytes, validation, metadata };
}

export function publishLifecycleBundle(bundle, targetId, supplied = {}) {
    validateCampaignId(targetId); const options = { ...defaults(), ...supplied };
    const checked = validateLifecycleBundle(bundle);
    if (fs.existsSync(path.join(supplied.authorityDirectory ?? path.join(options.dataRoot, 'authority'), targetId + '.authority.json'))) fail('lifecycle-transfer-authority-review-required');
    if (checked.validation.unresolved) fail('recover-and-acknowledge-before-playable-import-or-restore');
    const existing = fs.existsSync(path.join(options.directory, `${targetId}.drafts.json`))
        ? parseStrictJson(fs.readFileSync(path.join(options.directory, `${targetId}.drafts.json`))) : null;
    if (!supplied.restore && fs.existsSync(options.directory) && fs.readdirSync(options.directory).some(name => name === targetId || name.startsWith(targetId + '.'))) fail('lifecycle-import-destination-exists');
    const drafts = parseStrictJson(checked.bytes.get('.drafts.json'));
    const oldGuard = drafts.storageGuard;
    const guard = { format: 'legacy-storage-scope-v1', phase: 'ready', storageId: targetId, token: randomUUID(),
        assetAliases: { ...(oldGuard?.assetAliases ?? {}) }, history: [...(oldGuard?.history ?? []), {
            kind: supplied.restore ? 'restore' : 'import', sourceStorageId: supplied.originStorageId ?? bundle.sourceStorageId, storageId: targetId,
            campaignInstance: bundle.campaignInstance, previousToken: existing?.storageGuard?.token ?? oldGuard?.token ?? null,
        }] };
    const assetWrites = [];
    for (const asset of bundle.assets) {
        if (asset.missing) continue;
        const location = assetLocation(asset.storedReference, bundle.sourceStorageId);
        const extension = path.extname(location.relative).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12) || '.png';
        const filename = `import_${targetId}_${asset.sha256.slice(0, 24)}${extension}`;
        const reference = location.group === 'portraits' ? `/assets/portraits/${filename}` : `/assets/campaigns/${targetId}/scene-images/${filename}`;
        const target = assetPath(reference, targetId, options, true).path, bytes = Buffer.from(asset.base64, 'base64');
        if (fs.existsSync(target) && digest(fs.readFileSync(target)) !== asset.sha256) fail('lifecycle-import-asset-collision');
        guard.assetAliases[asset.reference] = reference; guard.assetAliases[asset.storedReference] = reference;
        assetWrites.push({ target, bytes });
    }
    for (const key of Object.keys(guard.assetAliases)) guard.assetAliases[key] = resolveAlias(key, guard.assetAliases);
    const readyDrafts = Buffer.from(JSON.stringify({ ...drafts, storageGuard: guard }, null, 2));
    const metadata = Buffer.from(JSON.stringify({ ...checked.metadata, id: targetId }, null, 2));
    const planned = new Map(checked.bytes); planned.set('.drafts.json', readyDrafts); planned.set('.json', metadata);
    const proof = validateLifecycleSources(suffix => planned.get(suffix) ?? null);
    if (!proof.valid) fail(proof.errors[0]);
    const marker = existing ?? drafts;
    fs.mkdirSync(options.directory, { recursive: true });
    supplied.boundary?.('before-scope-marker');
    publishDurable(path.join(options.directory, `${targetId}.drafts.json`), Buffer.from(JSON.stringify({ ...marker,
        storageGuard: { ...guard, phase: supplied.restore ? 'restoring' : 'importing' } }, null, 2)));
    supplied.boundary?.('scope-marker-published');
    try {
        if (supplied.restore) {
            for (const name of fs.readdirSync(options.directory).filter(name => name.startsWith(targetId + '.'))) {
                const suffix = name.slice(targetId.length);
                if (!allowedSuffix(suffix)) fail('lifecycle-restore-unexplained-source');
                if (!planned.has(suffix) && suffix !== '.drafts.json') fs.unlinkSync(path.join(options.directory, name));
            }
        }
        for (const [suffix, bytes] of planned) if (!['.drafts.json', '.json'].includes(suffix)) {
            supplied.boundary?.(`before-write:${suffix}`); publishDurable(path.join(options.directory, targetId + suffix), bytes); supplied.boundary?.(`after-write:${suffix}`);
        }
        for (const { target, bytes } of assetWrites) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (!fs.existsSync(target)) publishDurable(target, bytes);
        }
        const verified = validateLifecycleSources(suffix => suffix === '.drafts.json' ? readyDrafts
            : fs.existsSync(path.join(options.directory, targetId + suffix)) ? fs.readFileSync(path.join(options.directory, targetId + suffix)) : null);
        if (!verified.valid) fail(verified.errors[0]);
        publishDurable(path.join(options.directory, `${targetId}.drafts.json`), readyDrafts);
        publishDurable(path.join(options.directory, `${targetId}.json`), metadata);
        supplied.boundary?.('ready-scope-published');
    } catch (error) { throw Object.assign(error, { code: error.code ?? 'lifecycle-publication-recovery-required', storageId: targetId }); }
    return { id: targetId, name: checked.metadata.name, mapping: { sourceStorageId: bundle.sourceStorageId, storageId: targetId, campaignInstance: bundle.campaignInstance } };
}
