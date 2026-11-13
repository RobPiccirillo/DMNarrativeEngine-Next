import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStableId, ROOT_CAMPAIGN_SCOPE } from '@narrative/engine/contracts/identity';
import { acquireLease } from '../../lib/dataDirectoryLease.js';
import { FORMAT, TOOL, canonical, digest, fail, files, hash, inside, key, readSealed, seal, separate, writeDurable } from './artifact.js';
import { sourceIssues } from './readers.js';
import { BUILTINS, sourcePolicy } from './sourcePolicy.js';
import { assetReferences, assetLocation } from './assetReferences.js';

export { BUILTINS } from './sourcePolicy.js';
const PRIVATE_FIELDS = /^(api[-_]?keys?|x-api-key|access[-_]?token|refresh[-_]?token|bearer[-_]?token|auth[-_]?token|client[-_]?secret|private[-_]?key|secret[-_]?access[-_]?key|aws[-_]?access[-_]?key[-_]?id|authorization(?:[-_]?headers?)?|proxy[-_]?authorization|password|credentials|vault|vaultData|debugPayload|precontext|capturedRequest(?:Body|Headers)?|requestBody|requestHeaders|providerRequest|providers|providerConfig|presets)$/i;
export function privacy(value) {
    if (!value || typeof value !== 'object') return;
    for (const [field, child] of Object.entries(value)) {
        if (PRIVATE_FIELDS.test(field)) fail('prohibited-structured-material');
        privacy(child);
    }
}
function lexicalPreflight(bytes) {
    const text=bytes.toString('utf8');
    for (const match of text.matchAll(/"(?:\\.|[^"\\])*"/g)) {
        if(!/^\s*:/.test(text.slice(match.index+match[0].length))) continue;
        try { if (PRIVATE_FIELDS.test(JSON.parse(match[0]))) fail('prohibited-structured-material'); }
        catch(e) { if(e.code) throw e; }
    }
}
function duplicateJsonKeys(bytes) {
    const stack=[];
    for(const token of bytes.toString('utf8').match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) ?? []) {
        const top=stack.at(-1);
        if(token==='{') stack.push({keys:new Set(),expectKey:true});
        else if(token==='[') stack.push({keys:null});
        else if(token==='}' || token===']') stack.pop();
        else if(token===',' && top?.keys) top.expectKey=true;
        else if(token.startsWith('"') && top?.keys && top.expectKey) {
            const k=JSON.parse(token); if(top.keys.has(k)) return true; top.keys.add(k);top.expectKey=false;
        }
    }
    return false;
}
function parse(bytes) { try { return JSON.parse(bytes.toString('utf8')); } catch { return undefined; } }

// Declarative descriptors only. The roots are explicit; neither loader nor mod code is imported.
export function descriptors(roots = []) {
    const result = [];
    const seenMods = new Set();
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const file = inside(root, entry.name + '/manifest.json');
            if (!fs.existsSync(file)) continue;
            const bytes = fs.readFileSync(file), doc = parse(bytes);
            if (!doc || !/^[a-z][a-z0-9-]*$/.test(doc.id) || !Array.isArray(doc.tables ?? [])) fail('invalid-table-descriptor');
            // Caller orders roots by runtime precedence (bundled before installed).
            if (seenMods.has(doc.id)) continue;
            seenMods.add(doc.id);
            for (const table of doc.tables ?? []) {
                if (!/^[a-z][a-zA-Z0-9_-]*$/.test(table.name) || !['array','single-object'].includes(table.recordShape)) fail('invalid-table-descriptor');
                result.push({ suffix: `.mod-${doc.id}-${table.name}.json`, mod: doc.id, table: table.name,
                    shape: table.recordShape, migrateFrom: table.migrateFrom ?? null, descriptorHash: hash(bytes) });
            }
        }
    }
    return result.sort((a,b) => a.suffix.localeCompare(b.suffix));
}

export function discover({ dataRoot, campaign, descriptorRoots = [], assetRoots = {} }) {
    key(campaign);
    const tables = descriptors(descriptorRoots);
    const expected = new Set(BUILTINS.map(s => `campaigns/${campaign}${s}`));
    for (const t of tables) expected.add(`campaigns/${campaign}${t.suffix}`);
    const dir = inside(dataRoot, 'campaigns');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(campaign + '.')) {
            if (!entry.isFile()) fail('unknown-campaign-entry');
            expected.add('campaigns/' + entry.name);
        }
    }
    const authorityDir = inside(dataRoot, 'authority');
    expected.add(`authority/${campaign}.authority.json`);
    if (fs.existsSync(authorityDir)) for (const name of fs.readdirSync(authorityDir)) {
        if (name.startsWith(campaign + '.')) expected.add('authority/' + name);
    }
    const sourceBytes = new Map(), objectBytes = new Map(), objects = new Map();
    const sources = [...expected].sort().map(relative => {
        const file = inside(dataRoot, relative);
        const suffix = relative.startsWith('campaigns/') ? relative.slice(('campaigns/' + campaign).length) : '.authority';
        const matches = tables.filter(t => t.suffix === suffix);
        const family = suffix === '.json' ? 'metadata' : suffix.replace(/^\./,'').replace(/\.json$|\.md$/g,'');
        const base = { id: relative, path: relative, family, critical: ['.json','.state.json'].includes(suffix),
            descriptor: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
        Object.assign(base,sourcePolicy(base,campaign));
        if (!fs.existsSync(file)) return { ...base, presence: 'missing', hash: null, bytes: 0, parse: 'absent' };
        const bytes = fs.readFileSync(file), json = parse(bytes);
        if (json !== undefined) { lexicalPreflight(bytes); privacy(json); }
        else if (relative.endsWith('.json') || relative.endsWith('.tmp')) {
            // Malformed JSON is retained only after lexical credential-field preflight.
            lexicalPreflight(bytes);
        }
        sourceBytes.set(relative, bytes);
        const references=family==='archive' ? assetReferences(bytes.toString('utf8'),true) : assetReferences(json);
        for (const reference of references) {
            const location=assetLocation(reference,campaign);
            const root=location.group==='portraits' ? assetRoots.portraits : dataRoot;
            if (!root) fail('asset-root-required');
            const target=inside(root,location.relative);
            const raw=fs.existsSync(target) ? fs.readFileSync(target) : null;
            const sha=raw ? hash(raw) : null;
            objects.set(reference,{reference,hash:sha,bytes:raw?.length ?? 0,required:location.required});
            if(raw) objectBytes.set(sha,raw);
        }
        let validUtf8=true;
        try { new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { validUtf8=false; }
        const unsafeNumbers=json !== undefined && (bytes.toString('utf8').match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [])
            .some(t=>!t.startsWith('"') && (!Number.isFinite(Number(t)) || Number.isInteger(Number(t)) && !Number.isSafeInteger(Number(t))));
        return { ...base, presence: 'present', hash: hash(bytes), bytes: bytes.length, validUtf8,unsafeNumbers,duplicateKeys:json !== undefined && duplicateJsonKeys(bytes),
            parse: relative.endsWith('.md') ? 'text' : json === undefined ? 'corrupt' : 'json' };
    });
    return { sources, objects: [...objects.values()].sort((a,b) => a.reference.localeCompare(b.reference)), sourceBytes, objectBytes };
}

export function captureSnapshot(options) {
    const { dataRoot, artifactRoot, campaign, artifactKey = crypto.randomUUID(), fault = () => {} } = options;
    key(artifactKey);
    // Default layout may be a child of DATA_DIR, but never a legacy source/authority/asset root.
    separate(artifactRoot, path.join(dataRoot, 'campaigns'));
    separate(artifactRoot, path.join(dataRoot, 'authority'));
    for (const root of Object.values(options.assetRoots ?? {})) separate(artifactRoot, root);
    const lease = acquireLease(dataRoot, 'offline-snapshot');
    try {
        const initial = discover(options);
        const sourceBytes=[...initial.sourceBytes.values(),...initial.objectBytes.values()].reduce((n,b)=>n+b.length,0);
        const stat=fs.statfsSync(dataRoot);
        const capacity={availableBytes:stat.bavail*stat.bsize,estimatedBytes:sourceBytes*8+1024*1024,advisory:true,model:'snapshot-work-backup-restore.v1'};
        if (options.dryRun) {
            const findings=initial.sources.flatMap(s=>sourceIssues({campaign,identity:{campaignId:null}},s,
                s.parse==='json'?parse(initial.sourceBytes.get(s.id)):initial.sourceBytes.get(s.id)));
            const blockers=findings.filter(f=>f.severity==='cutover-blocking').length;
            return { format: FORMAT, tool: TOOL, sources: initial.sources, objects: initial.objects,findings,blockers,status:blockers?'blocked':'inspected',capacity };
        }
        fs.mkdirSync(artifactRoot, { recursive: true });
        const artifact = inside(artifactRoot, artifactKey);
        if(fs.existsSync(artifact)) fail('destination-exists');
        fs.mkdirSync(artifact, { recursive: false });
        const partial = inside(artifact, 'snapshot.partial');
        fs.mkdirSync(partial);
        for (const [relative, bytes] of initial.sourceBytes) writeDurable(inside(partial, 'source/' + relative), bytes);
        for (const [sha, bytes] of initial.objectBytes) writeDurable(inside(partial, 'objects/' + sha), bytes);
        fault('after-copy');
        const next = discover(options);
        if (canonical([initial.sources, initial.objects]) !== canonical([next.sources, next.objects])) fail('source-drift');
        const snapshotId = crypto.randomUUID(), importCopyKey = crypto.randomUUID();
        const body = { format: FORMAT, tool: TOOL, policy: 'offline-persisted.v1', artifactKey, snapshotId,
            campaign, identity: { disposition: 'new-disposable-import-copy', allocationKey: importCopyKey,
                campaignId: createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'migration.import-copy.v1', key: importCopyKey }) },
            sources: initial.sources, objects: initial.objects };
        seal(inside(partial, 'manifest.json'), body);
        validateSnapshot(partial);
        fault('before-publish');
        fs.renameSync(partial, inside(artifact, 'snapshot'));
        return { artifactKey, manifest: readSealed(inside(artifact, 'snapshot/manifest.json')),capacity };
    } finally { lease.release(); }
}

export function validateSnapshot(snapshot) {
    const m = readSealed(inside(snapshot, 'manifest.json'));
    if (m.policy !== 'offline-persisted.v1' || m.identity?.disposition !== 'new-disposable-import-copy'
        || m.identity.campaignId !== createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE,
            namespace: 'migration.import-copy.v1', key: m.identity.allocationKey })) fail('invalid-identity-binding');
    key(m.campaign); key(m.artifactKey);
    const members = ['manifest.json'];
    const seen = new Set();
    const expectedReferences=new Set();
    for (const s of m.sources) {
        if (seen.has(s.id) || s.id !== s.path || !['present','missing'].includes(s.presence)) fail('invalid-source-inventory');
        if(!(s.path.startsWith(`campaigns/${m.campaign}.`) || s.path.startsWith(`authority/${m.campaign}.`))) fail('out-of-scope-source');
        seen.add(s.id);
        if (s.presence === 'present') {
            const member = 'source/' + s.path, bytes = fs.readFileSync(inside(snapshot, member));
            if (hash(bytes) !== s.hash || bytes.length !== s.bytes) fail('source-hash-mismatch');
            if(s.path.endsWith('.json') || s.path.endsWith('.tmp')) {lexicalPreflight(bytes);privacy(parse(bytes));}
            const references=s.family==='archive' ? assetReferences(bytes.toString('utf8'),true) : assetReferences(parse(bytes));
            references.forEach(r=>expectedReferences.add(r));
            members.push(member);
        }
    }
    for (const suffix of BUILTINS) if (!seen.has(`campaigns/${m.campaign}${suffix}`)) fail('incomplete-inventory');
    if(canonical([...expectedReferences].sort())!==canonical(m.objects.map(o=>o.reference).sort())) fail('object-reference-inventory-mismatch');
    for (const object of m.objects) {
        if(object.required!==assetLocation(object.reference,m.campaign).required) fail('object-criticality-mismatch');
        if (!object.hash) continue;
        const member = 'objects/' + object.hash, bytes = fs.readFileSync(inside(snapshot, member));
        if (hash(bytes) !== object.hash || bytes.length !== object.bytes) fail('object-hash-mismatch');
        members.push(member);
    }
    if (canonical(files(snapshot).sort()) !== canonical([...new Set(members)].sort())) fail('unmanifested-payload');
    return m;
}
export const snapshotBinding = m => ({ format: FORMAT, artifact: m.artifactKey, snapshot: m.snapshotId,
    campaign: m.identity.campaignId, manifest: m.digest });
export const snapshotFingerprint = options => digest(discover(options).sources);
