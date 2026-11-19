import { transitionAuthority, isAuthorityTransitionState } from '@narrative/engine/contracts/authorityTransition';
import { integrity } from '../../db/campaignDb.js';
import { FORMAT, TOOL, canonical, digest, fail, inside } from './artifact.js';
import fs from 'node:fs';
import { validateLifecycleSources } from '../lifecycleValidation.js';
import { validateSnapshot } from './snapshot.js';
import { archiveRanges, archiveProseRanges, archiveIssues, pointerPart, rawKey, readSource, references, semanticHash, sourceIssues } from './readers.js';
import { sourcePolicy } from './sourcePolicy.js';

// Separate traversal from the importer: breadth collection, pointer sort, and reconstruction.
// Expectations come from sealed raw sources, never importer counts/status/outcomes.
export function expectations(snapshot, manifest, source) {
    if (source.presence === 'missing') return [];
    const value = readSource(snapshot,source);
    let values;
    if (source.parse === 'json') {
        const pending = [{ locator:'$', value, order:[] }];
        for (let i=0;i<pending.length;i++) {
            const item = pending[i];
            if (item.value && typeof item.value === 'object') {
                const keys = Object.keys(item.value).sort((a,b) => Array.isArray(item.value) ? Number(a)-Number(b) : a < b ? -1 : a > b ? 1 : 0);
                keys.forEach((k,ordinal) => pending.push({ locator:item.locator+'/'+pointerPart(k),value:item.value[k],order:[...item.order,ordinal] }));
            }
        }
        pending.sort((a,b) => {
            for (let i=0;i<Math.min(a.order.length,b.order.length);i++) if (a.order[i] !== b.order[i]) return a.order[i]-b.order[i];
            return a.order.length-b.order.length;
        });
        values = pending.map(n => ({ locator:n.locator,payload:canonical(n.value),original_key:rawKey(n.value),encoding:'json' }));
    } else {
        values = [{ locator:'$',payload:value.toString('base64'),encoding:'base64',original_key:null }];
        if (source.family === 'archive') values.push(...archiveRanges(value).map(r => ({ locator:`bytes:${r.start}:${r.end}`,
            payload:value.subarray(r.start,r.end).toString('base64'),encoding:'base64',original_key:null })));
        if (source.family === 'archive') values.push(...archiveProseRanges(value).map(r=>({locator:`prose:${r.role}:${r.start}:${r.end}`,
            payload:value.subarray(r.start,r.end).toString('base64'),encoding:'base64',original_key:null})));
    }
    const refs = references(manifest,source,values.map(n => n.locator));
    return values.map((n,i) => ({ ...n,ordinal:i,kind:source.family,compatibility_ref:refs[i],canonical_ref:null,semantic_hash:semanticHash(n.encoding,n.payload) }));
}

const SINGLE_REFS = /^(sceneId|chapterId|npcId|subjectId|targetId|entityId|locationId|currentPlaceId|messageId|sourceSceneId|originSceneId)$/;
const MULTI_REFS = /^(sceneIds|npcIds|onStageNpcIds|messageIds|entityIds)$/;
export function rawLinks(value, source = {}) {
    const result = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [field,child] of Object.entries(value)) {
        if (SINGLE_REFS.test(field) && (typeof child === 'string' || typeof child === 'number')) result.push({ relation:field,ordinal:0,raw_target:String(child) });
        if (MULTI_REFS.test(field) && Array.isArray(child)) child.forEach((v,i) => {
            if (typeof v === 'string' || typeof v === 'number') result.push({ relation:field,ordinal:i,raw_target:String(v) });
        });
    }
    if(Object.hasOwn(value,'sourceMessageId') && (typeof value.sourceMessageId==='string' || typeof value.sourceMessageId==='number')) {
        result.push({relation:'sourceMessageId',ordinal:0,raw_target:String(value.sourceMessageId)});
    }
    if(Object.hasOwn(value,'sceneRef') && (typeof value.sceneRef==='string' || typeof value.sceneRef==='number')) {
        result.push({relation:'sceneRef',ordinal:0,raw_target:String(value.sceneRef)});
    }
    if(source.family==='archive.chapters' && Array.isArray(value.sceneRange)) value.sceneRange.forEach((target,i)=> {
        if(typeof target==='string' || typeof target==='number') result.push({relation:'sceneRange',ordinal:i,raw_target:String(target)});
    });
    // sceneId/chapterId are the record identity in index/chapter collections, checked separately.
    return result;
}

export function reconcile({ db, snapshot, manifest, run }) {
    const actualManifest = validateSnapshot(snapshot);
    if (actualManifest.digest !== manifest.digest) fail('manifest-binding-mismatch');
    integrity(db);
    const findings = [], coverage = [], expectedAll = [];
    const add = (code,source = null,locator = null,severity = 'cutover-blocking') => findings.push({ code,source,locator,severity,
        disposition:severity === 'cutover-blocking' ? 'unresolved' : 'preserved', evidence:'policy:independent-reconciliation.v1' });
    const runRow = db.prepare('SELECT * FROM migration_runs WHERE run_id=?').get(run);
    if (!runRow || runRow.manifest_hash !== manifest.digest || runRow.importer !== TOOL || runRow.status === 'incomplete') add('incomplete-or-stale-run');
    const lifecycle = validateLifecycleSources(suffix => {
        const source = manifest.sources.find(source => source.path === `campaigns/${manifest.campaign}${suffix}` && source.presence === 'present');
        return source ? fs.readFileSync(inside(snapshot, 'source/' + source.path)) : null;
    });
    for (const code of lifecycle.errors) add(code);
    if (lifecycle.managed && lifecycle.unresolved && lifecycle.valid) add('unresolved-acceptance-preserved', null, null, 'informational');
    for (const source of manifest.sources) {
        const value = readSource(snapshot,source), expected = expectations(snapshot,manifest,source);
        findings.push(...sourceIssues(manifest,source,value,lifecycle.valid ? lifecycle.campaignInstance : undefined));
        if (source.family === 'archive' && source.presence === 'present') findings.push(...archiveIssues(source,value).filter(issue =>
            !(lifecycle.valid && lifecycle.partialArchives?.some(range => issue.code === 'ambiguous-archive-span' && issue.locator === `bytes:${range.start}:${range.end}`))));
        const stored = db.prepare('SELECT * FROM migration_sources WHERE run_id=? AND source_id=?').get(run,source.id);
        if (!stored || stored.path !== source.path || stored.raw_hash !== source.hash || stored.presence !== source.presence
            || stored.byte_length !== source.bytes || stored.family !== source.family || stored.parse_status !== source.parse
            || stored.descriptor !== canonical(source.descriptor) || stored.source_version !== (source.hash ? 'sha256:'+source.hash : 'absent:'+manifest.digest)) add('source-provenance-mismatch',source.id);
        const actual = db.prepare('SELECT locator,ordinal,kind,original_key,compatibility_ref,canonical_ref,encoding,payload,semantic_hash FROM staged_records WHERE run_id=? AND source_id=? ORDER BY ordinal').all(run,source.id);
        if (canonical(actual) !== canonical(expected)) add('record-content-order-or-provenance-mismatch',source.id);
        if (stored && [stored.expected_count,stored.observed_count,stored.staged_count].some(n => n !== expected.length)) add('source-count-mismatch',source.id);
        coverage.push({ source:source.id,presence:source.presence,hash:source.hash,...sourcePolicy(source,manifest.campaign),expected:expected.length,staged:actual.length,matched:canonical(actual) === canonical(expected) });
        expectedAll.push(...expected.map(r => ({ ...r,source:source.id,family:source.family })));
    }
    const sourceRows = db.prepare('SELECT source_id FROM migration_sources WHERE run_id=?').all(run);
    if (canonical(sourceRows.map(r=>r.source_id).sort()) !== canonical(manifest.sources.map(s=>s.id).sort())) add('source-inventory-mismatch');
    const values = expectedAll.filter(r=>r.encoding === 'json').map(r=>({ ...r,value:JSON.parse(r.payload) }));
    const scenes = new Map();
    for (const s of manifest.sources.filter(s=>s.family === 'archive' && s.presence === 'present')) {
        const bytes = readSource(snapshot,s);
        for (const r of archiveRanges(bytes)) {
            const match = bytes.subarray(r.start,r.end).toString('utf8').match(/^## SCENE (\d+)/);
            if (match) scenes.set(match[1],{ source:s.id,locator:`bytes:${r.start}:${r.end}` });
        }
    }
    const indexScenes = values.filter(r=>r.family === 'archive.index' && r.value && typeof r.value === 'object' && !Array.isArray(r.value) && r.value.sceneId != null).map(r=>String(r.value.sceneId));
    const pendingScenes = new Set(lifecycle.valid ? lifecycle.pendingScenes ?? [] : []);
    if (canonical([...scenes.keys()].filter(scene => !pendingScenes.has(scene)).sort()) !== canonical([...new Set(indexScenes)].filter(scene => !pendingScenes.has(scene)).sort())) add('archive-index-coverage-mismatch');
    for (const source of manifest.sources.filter(s=>s.descriptor?.shape === 'array' && s.presence === 'present')) {
        if (!Array.isArray(readSource(snapshot,source))) add('invalid-table-shape',source.id);
    }
    const expectedLinks = [];
    const nextScene=Math.max(0,...[...scenes.keys()].map(Number))+1;
    for (const r of values) for (const link of rawLinks(r.value,r)) {
        // Frozen lifecycle previews describe historical and not-yet-applied
        // records. Their scoped bindings are independently checked above;
        // they are not assertions that those records exist in today's files.
        const lifecycleReference = lifecycle.valid && (['acceptance', 'drafts'].includes(r.family)
            || r.family === 'state' && link.relation === 'sceneId' && /^\$\/messages\/\d+$/.test(r.locator) && lifecycle.historicalMessages?.[r.value.id] === link.raw_target);
        let candidates;
        if (/scene/i.test(link.relation)) candidates = scenes.has(link.raw_target) ? [scenes.get(link.raw_target)]
            : /^\d+$/.test(link.raw_target) && Number.isSafeInteger(Number(link.raw_target))
                ? [...scenes].filter(([id])=>Number.isSafeInteger(Number(id)) && Number(id)===Number(link.raw_target)).map(([,target])=>target) : [];
        else {
            const family = /chapter/i.test(link.relation) ? 'archive.chapters' : /message/i.test(link.relation) ? 'state'
                : /location|place/i.test(link.relation) ? 'locations' : /entity/i.test(link.relation) ? 'entities' : 'npcs';
            candidates = values.filter(v=>v.family === family && v.original_key === link.raw_target
                && (!/message/i.test(link.relation) || /^\$\/messages\/\d+$/.test(v.locator)));
        }
        const emptyChapter=r.family==='archive.chapters' && link.relation==='sceneRange' && r.value.sceneCount===0
            && Array.isArray(r.value.sceneRange) && r.value.sceneRange.length===2 && r.value.sceneRange[0]===r.value.sceneRange[1]
            && !(r.value.sceneIds?.length) && /^\d+$/.test(String(r.value.sceneRange[0])) && Number(r.value.sceneRange[0])===nextScene;
        const manualScene=link.relation==='sceneRef' && link.raw_target==='manual' && r.value.source==='manual'
            && (r.family==='divergence' || r.family==='state' && /divergence/i.test(r.locator));
        const sentinel = (link.relation==='sceneRange' ? emptyChapter || r.value.sceneCount===0 && link.raw_target==='000'
            : /message/i.test(link.relation) ? false
            : /scene/i.test(link.relation) ? ['000',''].includes(link.raw_target)
            : /chapter/i.test(link.relation) ? ['CH00',''].includes(link.raw_target)
            : link.raw_target==='' || /npc|subject|target|entity/i.test(link.relation) && link.raw_target==='MC') || manualScene;
        let disposition = sentinel ? 'legacy-sentinel' : candidates.length === 1 ? 'resolved' : candidates.length ? 'ambiguous' : 'unresolved';
        if (!sentinel && candidates.length !== 1) add(lifecycleReference ? 'historical-lifecycle-reference-preserved' : pendingScenes.has(link.raw_target) && /scene/i.test(link.relation) ? 'pending-lifecycle-reference-preserved' : 'dangling-or-ambiguous-reference',r.source,r.locator,
            lifecycleReference || pendingScenes.has(link.raw_target) && /scene/i.test(link.relation) ? 'informational' : r.family==='archive.index' ? 'warning' : 'cutover-blocking');
        let target_source=disposition==='resolved'?candidates[0].source:null,target_locator=disposition==='resolved'?candidates[0].locator:null;
        if(target_source && !db.prepare('SELECT 1 FROM staged_records WHERE run_id=? AND source_id=? AND locator=?').get(run,target_source,target_locator)) {
            add('missing-staged-reference-target',r.source,r.locator);disposition='missing-staged-target';target_source=null;target_locator=null;
        }
        expectedLinks.push({ source_id:r.source,locator:r.locator,...link,disposition,target_source,target_locator });
    }
    // Source-only structural checks: these do not depend on importer link emission.
    for(const r of values.filter(r=>r.family==='archive.chapters' && /^\$\/\d+$/.test(r.locator))) {
        const chapter=r.value;
        if(!chapter || typeof chapter!=='object') continue;
        if(Object.hasOwn(chapter,'sceneRange')) {
            const range=chapter.sceneRange;
            if(!Array.isArray(range) || range.length!==2 || range.some(v=>!/^\d+$/.test(String(v)) || !Number.isSafeInteger(Number(v))) || Number(range[0])>Number(range[1])) {
                add('invalid-chapter-scene-range',r.source,r.locator);continue;
            }
            const members=[...scenes.keys()].filter(id=>Number(id)>=Number(range[0]) && Number(id)<=Number(range[1]));
            const pendingMembers = [...pendingScenes].filter(id => !scenes.has(id) && Number(id)>=Number(range[0]) && Number(id)<=Number(range[1]));
            if(Object.hasOwn(chapter,'sceneCount') && (!Number.isSafeInteger(chapter.sceneCount) || chapter.sceneCount!==members.length && chapter.sceneCount!==members.length+pendingMembers.length)) add('chapter-scene-count-mismatch',r.source,r.locator);
            // Desktop writes [] for sceneIds while maintaining ranges; nonempty membership is explicit.
            const spelling=id=>/^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) ? String(Number(id)) : String(id);
            if(Array.isArray(chapter.sceneIds) && chapter.sceneIds.length && canonical([...chapter.sceneIds].map(spelling).sort())!==canonical(members.map(spelling).sort())) add('chapter-membership-range-mismatch',r.source,r.locator);
        } else if(Array.isArray(chapter.sceneIds) && Object.hasOwn(chapter,'sceneCount') && chapter.sceneCount!==chapter.sceneIds.length) add('chapter-scene-count-mismatch',r.source,r.locator);
    }
    const actualLinks = db.prepare('SELECT source_id,locator,relation,ordinal,raw_target,disposition,target_source,target_locator FROM staged_links WHERE run_id=? ORDER BY source_id,locator,relation,ordinal').all(run);
    const linkOrder = (a,b) => canonical([a.source_id,a.locator,a.relation,a.ordinal]).localeCompare(canonical([b.source_id,b.locator,b.relation,b.ordinal]));
    // Import stores explicit candidates without claiming resolution; independent resolution remains report evidence.
    const candidates = expectedLinks.map(l=>runRow?.status==='imported' ? {...l,disposition:'candidate',target_source:null,target_locator:null} : l);
    if (canonical([...actualLinks].sort(linkOrder)) !== canonical(candidates.sort(linkOrder))) add('link-inventory-mismatch');
    const state = values.find(r=>r.family === 'state' && r.locator === '$')?.value;
    if (state) {
        for (const field of ['inventoryItems','characterProfileData','playerCharacter','currentPlaceId','onStageNpcIds']) {
            if (Object.hasOwn(state,field) && Object.hasOwn(state.context ?? {},field) && canonical(state[field]) !== canonical(state.context[field])) add('conflicting-state-mirror',null,'$/'+field);
        }
        if (state.context?.arcs?.length && values.some(r=>r.family === 'mod-arc-arcs' && r.locator === '$' && r.value?.length && canonical(r.value) !== canonical(state.context.arcs))) add('arc-source-disagreement');
    }
    for (const source of manifest.sources.filter(s=>s.descriptor?.migrateFrom)) {
        const retained = values.find(r=>r.source.endsWith(source.descriptor.migrateFrom) && r.locator === '$');
        const adopted = values.find(r=>r.source === source.id && r.locator === '$');
        if (retained && adopted && canonical(retained.value) !== canonical(adopted.value)) add('retained-adopted-disagreement',source.id);
    }
    for (const object of manifest.objects) if (!object.hash) add('missing-local-object',null,null,object.required ? 'cutover-blocking' : 'warning');
    const domains = db.prepare('SELECT * FROM domain_authority WHERE run_id=? ORDER BY domain').all(run);
    const expectedDomains=[...new Set(manifest.sources.map(s=>s.family.replace(/[^a-z0-9.-]/gi,'-').toLowerCase()))].sort();
    if (canonical(domains.map(d=>d.domain).sort())!==canonical(expectedDomains)) add('authority-inventory-mismatch');
    for (const d of domains) {
        let state; try { state=JSON.parse(d.state); } catch { state=null; }
        if (d.scope !== 'staging-only' || !isAuthorityTransitionState(state) || state.stage !== 'shadow' || state.firstNewOwnerWrite || state.cutoverPrepared || state.legacyOwner !== 'legacy-runtime'
            || state.domainId !== d.domain || state.newOwner!=='future-sqlite' || state.formatEpoch!==1 || d.control_hash!==null) add('invalid-staging-authority');
        if(runRow?.status==='verified') {
            const source=coverage.find(c=>c.hash);
            const expected={type:'compatibility',kind:'source-item',id:references(manifest,{id:source.source,family:'verification'},['report:'+runRow.report_digest])[0]};
            if(canonical(state?.verification)!==canonical(expected)) add('stale-shadow-verification');
        }
    }
    const blockers = findings.filter(f=>f.severity === 'cutover-blocking').length;
    return { format:FORMAT,tool:TOOL,type:'MigrationReport',run,snapshot:manifest.snapshotId,manifest:manifest.digest,
        campaign:manifest.identity.campaignId,schema:1,importer:TOOL,verifier:TOOL,status:blockers ? 'blocked' : 'verified',blockers,
        authorityScope:'staging-only',restoreProof:'required-external',coverage,links:expectedLinks,findings };
}

export function publishVerification(db,run,report,fault = () => {}) {
    const resolve=db.prepare('UPDATE staged_links SET disposition=?,target_source=?,target_locator=? WHERE run_id=? AND source_id=? AND locator=? AND relation=? AND ordinal=?');
    for(const l of report.links) resolve.run(l.disposition,l.target_source,l.target_locator,run,l.source_id,l.locator,l.relation,l.ordinal);
    db.prepare('DELETE FROM migration_findings WHERE run_id=?').run(run);
    const insert = db.prepare('INSERT INTO migration_findings VALUES (?,?,?,?,?,?,?,?)');
    report.findings.forEach((f,i)=>insert.run(run,i,f.source,f.locator,f.code,f.severity,f.disposition,f.evidence));
    const reportDigest = digest(report);
    db.prepare('UPDATE migration_runs SET verifier=?,status=?,report_digest=?,report_body=?,blocking_count=? WHERE run_id=?').run(TOOL,report.status,reportDigest,canonical(report),report.blockers,run);
    if (!report.blockers) for (const d of db.prepare('SELECT * FROM domain_authority WHERE run_id=?').all(run)) {
        const source = report.coverage.find(c=>c.hash);
        const reference = { type:'compatibility',kind:'source-item',id:references({ identity:{ campaignId:report.campaign },digest:report.manifest,snapshotId:report.snapshot },
            { id:source.source,family:'verification' },['report:'+reportDigest])[0] };
        const next = transitionAuthority(JSON.parse(d.state),d.domain,{ type:'verify',expectedOwner:'legacy-runtime',expectedFormatEpoch:1,verification:reference });
        if (next.status !== 'transitioned') fail('invalid-shadow-verification');
        db.prepare('UPDATE domain_authority SET state=? WHERE run_id=? AND domain=?').run(canonical(next.state),run,d.domain);
    }
    fault('verification-before-commit');
    return { reportDigest,status:report.status,blockers:report.blockers };
}
