import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { captureSnapshot } from '../../server/services/campaignMigration/snapshot.js';
import { importSnapshot,verifyArtifact,withArtifact } from '../../server/services/campaignMigration.js';
import { backupArtifact,restoreCheck,assertImportEligible } from '../../server/services/campaignMigration/recovery.js';
import { files } from '../../server/services/campaignMigration/artifact.js';

// Synthetic-only, separate artifact schema; never alters Phase 0/1L projections.
const output=path.resolve('.eval-output/phase2');fs.mkdirSync(output,{recursive:true});
const metrics=[];
for(const [name,count] of [['empty',0],['small',5],['long',250]]) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'dmn-phase2-eval-'));
    try {
        const dataRoot=path.join(root,'data'),artifactRoot=path.join(root,'artifacts');
        fs.mkdirSync(path.join(dataRoot,'campaigns'),{recursive:true});
        const write=(suffix,body)=>fs.writeFileSync(path.join(dataRoot,'campaigns/test'+suffix),typeof body==='string'?body:JSON.stringify(body));
        write('.json',{id:'test',name:'Synthetic '+name});write('.state.json',{context:{arcs:[]},messages:[]});
        const index=Array.from({length:count},(_,i)=>({sceneId:String(i+1).padStart(3,'0')}));
        write('.archive.index.json',index);
        write('.archive.md',index.map(s=>`## SCENE ${s.sceneId}\n*synthetic*\n\n**[USER]**\nA token for the next room.\n\n**[GM]**\n${'Synthetic fictional prose. '.repeat(40)}\n\n---\n\n`).join(''));
        const timings={},opts={dataRoot,artifactRoot,campaign:'test',artifactKey:'one',run:'default'};
        async function measure(label,fn){const start=performance.now();const value=await fn();timings[label]=Math.round((performance.now()-start)*100)/100;return value;}
        const sourceBytes=files(dataRoot).reduce((sum,p)=>sum+fs.statSync(path.join(dataRoot,p)).size,0);
        await measure('snapshot',()=>captureSnapshot(opts));
        await measure('import',()=>importSnapshot(opts));
        const report=await measure('verify',()=>verifyArtifact(opts));
        if(report.blockers) throw new Error('synthetic fixture blocked');
        const b=await measure('backup',()=>backupArtifact({...opts,backupKey:'copy'}));
        // Actual originals unavailable, including the developer-independent fixture DATA_DIR.
        const artifact=path.join(artifactRoot,'one');
        fs.renameSync(path.join(artifact,'work'),path.join(artifact,'work.unavailable'));
        fs.renameSync(path.join(artifact,'snapshot'),path.join(artifact,'snapshot.unavailable'));
        fs.renameSync(dataRoot,dataRoot+'.unavailable');
        const restored=await measure('restore',()=>restoreCheck({backup:b.backup,restoreRoot:path.join(root,'isolated'),dataRoot,assetRoots:{}}));
        const eligible=assertImportEligible({backup:b.backup,drill:restored.drill});
        fs.renameSync(path.join(artifact,'work.unavailable'),path.join(artifact,'work'));
        fs.renameSync(path.join(artifact,'snapshot.unavailable'),path.join(artifact,'snapshot'));
        const counts=withArtifact({...opts,readonly:true},ctx=>({records:ctx.db.prepare('SELECT count(*) n FROM staged_records').get().n,
            transactions:ctx.db.prepare('SELECT count(*) n FROM migration_command_outcomes').get().n}));
        const diskBytes=files(root).reduce((sum,p)=>sum+fs.statSync(path.join(root,p)).size,0);
        metrics.push({fixture:name,scenes:count,sourceBytes,diskBytes,diskAmplification:diskBytes/sourceBytes,...counts,
            peakRssBytes:process.resourceUsage().maxRSS*1024,timingsMs:timings,status:eligible.status,blockers:report.blockers});
    } finally {fs.rmSync(root,{recursive:true,force:true});}
}
const result={format:1,suite:'phase2-persistence-v1',node:process.version,sqlite:'better-sqlite3',metrics,
    boundaries:{liveAuthorityMoved:false,providersUsed:false,vectorsUsed:false,realCampaignsUsed:false},privacy:'Field-aware canaries are tested by test:phase2; no universal prose secret detection claim.'};
fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
