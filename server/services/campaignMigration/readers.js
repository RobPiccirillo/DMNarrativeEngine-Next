import fs from 'node:fs';
import { createCompatibilityReferences, parseStableId, getStableIdCampaign } from '@narrative/engine/contracts/identity';
import { isAuthorityControlDocument } from '@narrative/engine/contracts/authorityControl';
import { canonical, digest, fail, inside } from './artifact.js';
import { sourcePolicy } from './sourcePolicy.js';

export const pointerPart = s => String(s).replace(/~/g,'~0').replace(/\//g,'~1');
export function readSource(snapshot, source) {
    if (source.presence === 'missing') return undefined;
    const bytes = fs.readFileSync(inside(snapshot, 'source/' + source.path));
    if (source.parse !== 'json') return bytes;
    try { return JSON.parse(bytes.toString('utf8')); } catch { fail('source-parse-drift'); }
}
export function references(manifest, source, locators) {
    return createCompatibilityReferences({ kind: 'source-item', campaign: manifest.identity.campaignId,
        namespace: source.id, family: source.family, version: manifest.digest,
        scope: { mode: 'snapshot', snapshot: manifest.snapshotId } }, locators);
}
export function rawKey(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value.id ?? value.sceneId ?? value.chapterId;
    return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}
export function classification(family) {
    return { authority: family === 'archive' ? 'canonical-evidence' : family === 'lore' ? 'reference-input'
        : family === 'state' ? 'working-data' : 'operational-metadata',
    trust: 'imported-untrusted-content', legacyStatus: 'transitional-legacy' };
}
export function contextRecord(manifest, source, locator, content) {
    return { reference: { type: 'compatibility', kind: 'source-item', id: references(manifest, source, [locator])[0] },
        sourceVersion: 'sha256:' + source.hash, classification: classification(source.family), content };
}
export function sourceIssues(manifest, source, value) {
    const result = [];
    const add = (code, severity = 'cutover-blocking', locator = '$') => result.push({ source: source.id, locator, code, severity,
        disposition: severity === 'cutover-blocking' ? 'unresolved' : 'preserved', evidence: 'policy:phase2.v1' });
    const policy=sourcePolicy(source,manifest.campaign);
    if(policy.criticality==='unknown') add('unknown-source-criticality');
    if(source.criticality!==undefined && (source.criticality!==policy.criticality || source.disposition!==policy.disposition)) add('source-criticality-mismatch');
    if (source.presence === 'missing') { add(source.critical ? 'missing-critical-source' : 'absent-unused-source', source.critical ? 'cutover-blocking' : 'informational'); return result; }
    if (source.ambiguous) add('ambiguous-table-descriptor');
    if (source.duplicateKeys) add('duplicate-json-key');
    if (source.validUtf8===false) add('invalid-source-utf8');
    if (source.unsafeNumbers) add('unsafe-json-number');
    if (/\.(tmp|lock)$/.test(source.path)) add('unexplained-control-or-temporary');
    if (source.parse === 'corrupt') add('corrupt-source', source.family === 'archive.index' ? 'warning' : 'cutover-blocking');
    if (!source.path.startsWith('authority/') && !source.path.endsWith('.json') && !source.path.endsWith('.archive.md')) add('unknown-source-format');
    if (source.family === 'metadata' && (value?.id !== manifest.campaign)) add('metadata-locator-disagreement');
    if (source.critical && (!value || typeof value !== 'object' || Array.isArray(value))) add('invalid-critical-shape');
    if (source.family === 'state' && (!Array.isArray(value?.messages) || !value?.context || typeof value.context !== 'object')) add('invalid-state-shape');
    const arrayFamilies=['npcs','locations','entities','facts','timeline','archive.index','archive.chapters','relationship-memory.npc-to-mc','relationship-memory.npc-to-npc','lore'];
    if(source.parse==='json' && arrayFamilies.includes(source.family) && !Array.isArray(value)) add('invalid-source-container');
    if(source.parse==='json' && source.descriptor?.shape==='single-object' && value!==null && (typeof value!=='object' || Array.isArray(value))) add('invalid-table-shape');
    if (source.path.startsWith('authority/')) {
        if (!isAuthorityControlDocument(value)) add('invalid-control-document');
        else if (value.domains.some(d => !['legacy','shadow'].includes(d.stage) || d.cutoverPrepared || d.firstNewOwnerWrite)) add('unsupported-advanced-authority');
        // A matching filename cannot independently bind a canonical identity.
        else add('unbound-control-identity');
    }
    const ids = new Map();
    function walk(node, locator) {
        if (!node || typeof node !== 'object') return;
        const id = rawKey(node);
        if (id !== null) {
            const parent = locator.replace(/\/[^/]+$/, '');
            const scope = parent + '\0' + id;
            if (ids.has(scope)) add('duplicate-legacy-key', 'cutover-blocking', locator);
            ids.set(scope, locator);
            if (id.startsWith('sid:')) {
                const kinds = ['campaign','entity','turn','draft','revision','annotation','evidence','command','change-set','npc','location','message','scene'];
                const canonicalId = kinds.map(k => parseStableId(id,k)).find(Boolean);
                if (!canonicalId || getStableIdCampaign(canonicalId) !== manifest.identity.campaignId) add('unbound-canonical-identity','cutover-blocking',locator);
            }
        }
        for (const [k,v] of Object.entries(node)) walk(v, locator + '/' + pointerPart(k));
    }
    if (source.parse === 'json') walk(value, '$');
    if (source.family.startsWith('relationship-memory') && Array.isArray(value) && value.some(v=>v && typeof v==='object' && !v.subjectId && !v.npcId)) add('name-only-relationship-reference','warning');
    return result;
}

// Low-level lossless archive ranges shared by two independent traversal implementations.
// UTF-8 offsets derive from original bytes, never trimmed/re-serialized prose.
export function archiveRanges(bytes) {
    const text = bytes.toString('utf8');
    const starts = [...text.matchAll(/^## SCENE [^\r\n]*/gm)];
    const offsets = [0, ...starts.map(m => Buffer.byteLength(text.slice(0,m.index)))];
    return [...new Set(offsets)].map((start,i,all) => ({ start, end: all[i+1] ?? bytes.length }));
}
export function archiveIssues(source, bytes) {
    const out = [], seen = new Set();
    for (const range of archiveRanges(bytes)) {
        const text = bytes.subarray(range.start,range.end).toString('utf8');
        if (!text.length) continue;
        const m = text.match(/^## SCENE (\d+)\r?\n/);
        let code;
        if (!m || (text.match(/\*\*\[USER\]\*\*/g) ?? []).length !== 1 || (text.match(/\*\*\[GM\]\*\*/g) ?? []).length !== 1
            || archiveProse(bytes.subarray(range.start,range.end)).length!==2) code = 'ambiguous-archive-span';
        else if (seen.has(m[1])) code = 'duplicate-archive-scene';
        if (m) seen.add(m[1]);
        if (code) out.push({ source: source.id, locator: `bytes:${range.start}:${range.end}`, code, severity: 'cutover-blocking', disposition: 'unresolved', evidence: 'policy:archive-spans.v1' });
    }
    return out;
}
export function archiveProse(bytes,base=0) {
    // ASCII structural tags permit exact byte slicing without Unicode offset conversion.
    const user=Buffer.from('**[USER]**'),gm=Buffer.from('**[GM]**');
    const u=bytes.indexOf(user),g=bytes.indexOf(gm);
    if(u<0 || g<=u) return [];
    const lineStart=offset=>bytes[offset]===13 && bytes[offset+1]===10 ? offset+2 : bytes[offset]===10 ? offset+1 : -1;
    const userStart=lineStart(u+user.length),assistantStart=lineStart(g+gm.length);
    const beforeG=bytes.subarray(0,g).toString('latin1').match(/\r?\n\r?\n$/);
    const ending=bytes.toString('latin1').match(/\r?\n\r?\n---(?:\r?\n)*$/);
    if(userStart<0 || assistantStart<0 || !beforeG || !ending) return [];
    return [{role:'user',start:base+userStart,end:base+g-beforeG[0].length},
        {role:'assistant',start:base+assistantStart,end:base+ending.index}];
}
export function archiveProseRanges(bytes) {
    return archiveRanges(bytes).flatMap(r=>archiveProse(bytes.subarray(r.start,r.end),r.start));
}
export const semanticHash = (encoding, payload) => digest({ version: 1, encoding, payload });
export function recordData(manifest, source, locator, ordinal, value, encoding = 'json') {
    const payload = encoding === 'json' ? canonical(value) : value.toString('base64');
    return { locator, ordinal, kind: source.family, original_key: encoding === 'json' ? rawKey(value) : null,
        compatibility_ref: references(manifest,source,[locator])[0], canonical_ref: null, encoding, payload,
        semantic_hash: semanticHash(encoding,payload) };
}
