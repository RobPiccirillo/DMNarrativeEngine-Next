import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach,it,expect,vi } from 'vitest';
import { fixture,tree } from './migrationFixtures.js';
import { captureSnapshot,validateSnapshot } from '../services/campaignMigration/snapshot.js';
import { importSnapshot,verifyArtifact,withArtifact } from '../services/campaignMigration.js';
import { reconcile } from '../services/campaignMigration/verifier.js';
import { backupArtifact,restoreCheck,assertImportEligible,defaultRestoreRoot } from '../services/campaignMigration/recovery.js';
import { canonical,digest,hash } from '../services/campaignMigration/artifact.js';

const active=[];
afterEach(()=>{vi.unstubAllGlobals();active.splice(0).forEach(f=>f.cleanup());});
function make() {const f=fixture();active.push(f);return {...f,artifactKey:'one',run:'default',assetRoots:{}};}
function stage(f) {captureSnapshot(f);importSnapshot(f);return verifyArtifact(f);}
function scenes(f) {
    f.write('.archive.md',['001','002'].map(id=>`## SCENE ${id}\n*date*\n\n**[USER]**\nUser\n\n**[GM]**\nStory\n\n---\n\n`).join(''));
    f.write('.archive.index.json',[{sceneId:'001'},{sceneId:'002'}]);
}
async function ineligible(f,report) {
    expect(report.status).toBe('blocked');
    const b=await backupArtifact({...f,backupKey:'blocked'});
    const restored=restoreCheck({...f,backup:b.backup,restoreRoot:path.join(f.root,'drills')});
    expect(()=>assertImportEligible({backup:b.backup,drill:restored.drill})).toThrow('ineligible');
}
it.each([
    ['.unfamiliar.json',{authority:'authoritative',records:[{id:'a'}]}],
    ['.unfamiliar.json',{notes:['unclassified inert-looking data']}],
    ['.opaque.bin',Buffer.from([0,255,1,2])],
])('preserves unknown source %s but fails eligibility closed',async(suffix,payload)=> {
    const f=make();
    if(Buffer.isBuffer(payload)) fs.writeFileSync(path.join(f.dataRoot,'campaigns/test'+suffix),payload);else f.write(suffix,payload);
    const before=tree(f.dataRoot),report=stage(f);
    expect(report.findings.some(x=>x.code==='unknown-source-criticality' && x.severity==='cutover-blocking')).toBe(true);
    const m=validateSnapshot(path.join(f.artifactRoot,'one/snapshot'));
    expect(m.sources.find(s=>s.path.endsWith(suffix))).toMatchObject({criticality:'unknown',disposition:'unclassified-blocked'});
    await ineligible(f,report);expect(tree(f.dataRoot)).toEqual(before);
});
it('retains known optional corruption and known required absence semantics',()=> {
    const optional=make();optional.write('.archive.index.json','{bad');
    expect(stage(optional).findings.filter(x=>x.severity==='cutover-blocking')).toEqual([]);
    const required=make();fs.unlinkSync(path.join(required.dataRoot,'campaigns/test.state.json'));
    expect(stage(required).findings.some(x=>x.code==='missing-critical-source')).toBe(true);
});
it.each(['pin','divergence','chapter'])('blocks reviewer reference reproduction: %s',async(kind)=> {
    const f=make();scenes(f);
    if(kind==='pin') f.write('.state.json',{context:{},messages:[{id:'real'}],pinnedExcerpts:[{id:'pin',sourceMessageId:'missing'}]});
    if(kind==='divergence') f.write('.divergence.json',{entries:[{id:'correction',source:'manual',sceneRef:'999'}]});
    if(kind==='chapter') f.write('.archive.chapters.json',[{chapterId:'CH01',sceneRange:['998','999'],sceneCount:2,sceneIds:['001']}]);
    const before=tree(f.dataRoot),report=stage(f);
    expect(report.findings.some(x=>x.code==='dangling-or-ambiguous-reference')).toBe(true);
    if(kind==='chapter') {
        expect(report.findings.some(x=>x.code==='chapter-scene-count-mismatch')).toBe(true);
        expect(report.findings.some(x=>x.code==='chapter-membership-range-mismatch')).toBe(true);
    }
    await ineligible(f,report);expect(tree(f.dataRoot)).toEqual(before);
});
it('valid source-aware links, manual/bootstrap sentinels, placeholder chapters and optional annotations pass',()=> {
    const f=make();scenes(f);
    f.write('.state.json',{context:{},messages:[{id:'real'}],pinnedExcerpts:[{sourceMessageId:'real'}]});
    f.write('.divergence.json',{entries:[{sceneRef:'001'},{sceneRef:'000'},{sceneRef:'manual',source:'manual'}]});
    f.write('.archive.chapters.json',[{chapterId:'CH01',sceneRange:['001','002'],sceneCount:2,sceneIds:[]},
        {chapterId:'CH02',sceneRange:['003','003'],sceneCount:0,sceneIds:[]}]);
    f.write('.archive.index.json',[{sceneId:'001',sourceMessageId:'old-derived-annotation'},{sceneId:'002'}]);
    const report=stage(f);expect(report.status).toBe('verified');
    expect(report.findings.some(x=>x.code==='dangling-or-ambiguous-reference' && x.severity==='warning')).toBe(true);
    const membership=make();scenes(membership);
    membership.write('.archive.chapters.json',[{chapterId:'CH01',sceneRange:['1','2'],sceneIds:['1','2'],sceneCount:2}]);
    expect(stage(membership).status).toBe('verified');
});
it('independent verification detects omitted staged structural links after successful import',()=> {
    const f=make();scenes(f);
    f.write('.state.json',{context:{},messages:[{id:'m'}],pinnedExcerpts:[{sourceMessageId:'m'}]});
    captureSnapshot(f);importSnapshot(f);
    withArtifact(f,ctx=> {
        ctx.db.prepare("DELETE FROM staged_links WHERE relation='sourceMessageId'").run();
        expect(reconcile({...ctx,run:f.run}).findings.some(x=>x.code==='link-inventory-mismatch')).toBe(true);
    });
});
function archiveAsset(f,reference='/assets/campaigns/test/scene-images/one.png') {
    const dir=path.join(f.dataRoot,'campaigns/test/scene-images');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'one.png'),'synthetic-image');
    f.write('.archive.md',`## SCENE 001\n*date*\n\n**[USER]**\nMap\n\n**[GM]**\n![Map](${reference})\n![Again](${reference})\n\n---\n\n`);
    f.write('.archive.index.json',[{sceneId:'001'}]);return dir;
}
it('archive Markdown assets survive isolated restore and tamper/missing-member checks',async()=> {
    const f=make();archiveAsset(f);const before=tree(f.dataRoot);
    const report=stage(f);expect(report.status).toBe('verified');
    const snap=path.join(f.artifactRoot,'one/snapshot'),m=validateSnapshot(snap);
    expect(m.objects).toHaveLength(1);expect(m.objects[0].hash).toBe(hash('synthetic-image'));
    const b=await backupArtifact({...f,backupKey:'text'});
    fs.renameSync(f.dataRoot,f.dataRoot+'.unavailable');
    const result=restoreCheck({...f,backup:b.backup,restoreRoot:path.join(f.root,'drills')});
    expect(assertImportEligible({backup:b.backup,drill:result.drill}).status).toBe('eligible-snapshot-only');
    fs.writeFileSync(path.join(result.drill,'restored/snapshot/objects',m.objects[0].hash),'tamper');
    expect(()=>assertImportEligible({backup:b.backup,drill:result.drill})).toThrow();
    fs.unlinkSync(path.join(b.backup,'snapshot/objects',m.objects[0].hash));
    expect(()=>restoreCheck({...f,backup:b.backup,restoreRoot:path.join(f.root,'other-drills')})).toThrow();
    expect(tree(f.dataRoot+'.unavailable')).toEqual(before);
});
it('independently rejects an omitted object inventory even with a resealed manifest',()=> {
    const f=make();archiveAsset(f);captureSnapshot(f);
    const snap=path.join(f.artifactRoot,'one/snapshot'),m=validateSnapshot(snap);
    const {digest:_digest,...body}=m;body.objects=[];
    fs.writeFileSync(path.join(snap,'manifest.json'),canonical({...body,digest:digest(body)}));
    expect(()=>validateSnapshot(snap)).toThrow('object-reference-inventory-mismatch');
});
it('missing archive assets block; capture drift, traversal and symlink escapes are rejected',()=> {
    const missing=make(),dir=archiveAsset(missing);fs.unlinkSync(path.join(dir,'one.png'));
    expect(stage(missing).findings.some(x=>x.code==='missing-local-object' && x.severity==='cutover-blocking')).toBe(true);
    const drift=make(),assetDir=archiveAsset(drift);
    expect(()=>captureSnapshot({...drift,fault:p=>{if(p==='after-copy') fs.writeFileSync(path.join(assetDir,'one.png'),'changed');}})).toThrow('source-drift');
    const escape=make();archiveAsset(escape,'/assets/campaigns/test/scene-images/%2e%2e/private.png');
    expect(()=>captureSnapshot(escape)).toThrow('unsafe-path');
    const linked=make(),linkedDir=archiveAsset(linked),physical=path.join(linked.root,'physical-images');
    fs.renameSync(linkedDir,physical);fs.symlinkSync(physical,linkedDir,'junction');
    expect(()=>captureSnapshot(linked)).toThrow('symlink-refused');
});
it('remote Markdown URLs and bare prose paths are never fetched or copied',()=> {
    const f=make();archiveAsset(f,'https://example.invalid/assets/campaigns/test/scene-images/one.png');
    const fetch=vi.fn(()=>{throw new Error('network forbidden');});vi.stubGlobal('fetch',fetch);
    f.write('.lore.json',[{content:'A fictional /assets/portraits/not-a-reference.png path.'}]);
    expect(stage(f).status).toBe('verified');
    expect(validateSnapshot(path.join(f.artifactRoot,'one/snapshot')).objects).toEqual([]);expect(fetch).not.toHaveBeenCalled();
});
it('configured/development/public/DATA_DIR and normalized overlapping restore roots reject before writes',async()=> {
    const f=make();expect(stage(f).status).toBe('verified');const b=await backupArtifact({...f,backupKey:'roots'});
    const portraits=path.join(f.root,'served/portraits');fs.mkdirSync(portraits,{recursive:true});
    const roots=[portraits,path.join(portraits,'nested'),path.dirname(portraits),path.join(portraits,'..','portraits','nested'),
        f.dataRoot,path.join(f.dataRoot,'drills'),path.resolve('public/assets/portraits'),path.resolve('public/assets/portraits/new-private-drill'),
        path.resolve('.eval-output/private-drills'),path.resolve('..')];
    const mkdir=vi.spyOn(fs,'mkdirSync');
    try { for(const restoreRoot of roots) {
        let wrote=false;
        expect(()=>restoreCheck({...f,backup:b.backup,restoreRoot,assetRoots:{portraits},fault:()=>{wrote=true;}})).toThrow('overlapping-roots');
        expect(wrote).toBe(false);
    } expect(mkdir).not.toHaveBeenCalled(); } finally {mkdir.mockRestore();}
    expect(fs.readdirSync(portraits)).toEqual([]);
    expect(()=>restoreCheck({...f,assetRoots:undefined,backup:b.backup,restoreRoot:path.join(f.root,'missing-config')})).toThrow('explicit-asset-roots-required');
    const safe=restoreCheck({...f,backup:b.backup,restoreRoot:path.join(f.root,'safe-sibling'),assetRoots:{portraits}});
    expect(safe.proof.status).toBe('restore-tested');
    const alias=path.join(f.root,'served-alias');fs.symlinkSync(path.join(f.root,'served'),alias,'junction');
    expect(()=>restoreCheck({...f,backup:b.backup,restoreRoot:path.join(alias,'portraits/drill'),assetRoots:{portraits}})).toThrow('overlapping-roots');
    const cli=(restoreRoot)=>spawnSync(process.execPath,['scripts/campaign-migration.mjs','restore-check','--data-root',f.dataRoot,
        '--artifact-root',f.artifactRoot,'--artifact','one','--backup','roots','--portrait-root',portraits,
        '--restore-root',restoreRoot,'--drill-key','cli'],{encoding:'utf8',timeout:10000});
    const rejected=cli(portraits);expect(rejected.status).not.toBe(0);expect(rejected.stderr).toContain('overlapping-roots');
    expect(cli(path.join(f.root,'cli-safe')).status).toBe(0);expect(fs.readdirSync(portraits)).toEqual([]);
    expect(defaultRestoreRoot(path.resolve('data'))).toBe(path.resolve('..',path.basename(process.cwd())+'-migration-restore-drills'));
});
