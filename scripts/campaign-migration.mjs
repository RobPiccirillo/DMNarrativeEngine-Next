import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { captureSnapshot } from '../server/services/campaignMigration/snapshot.js';
import { importSnapshot,verifyArtifact,inspectArtifact,artifactPaths,assertSupportedOperation,withArtifact } from '../server/services/campaignMigration.js';
import { backupArtifact,restoreCheck,assertImportEligible,defaultRestoreRoot } from '../server/services/campaignMigration/recovery.js';
import { acquireLease,inspectLease,recoverLease } from '../server/lib/dataDirectoryLease.js';
import { digest,fail,inside,key,separate } from '../server/services/campaignMigration/artifact.js';

export async function main(args) {
    const [operation,...tail]=args,flags={};
    for(let i=0;i<tail.length;i++) {
        if(!tail[i].startsWith('--')) fail('invalid-argument');
        const name=tail[i].slice(2);
        flags[name]=tail[i+1] && !tail[i+1].startsWith('--') ? tail[++i] : true;
    }
    const allowed=['data-root','artifact-root','artifact','snapshot','run','campaign','portrait-root','dry-run','operation','backup-key','backup','restore-root','drill-key','token','fingerprint','confirmed-stopped','include-snapshot'];
    if(Object.keys(flags).some(k=>!allowed.includes(k)) || ['dry-run','confirmed-stopped','include-snapshot'].some(k=>k in flags && flags[k]!==true)) fail('invalid-argument');
    assertSupportedOperation(operation);
    const repo=fileURLToPath(new URL('../',import.meta.url));
    const dataRoot=path.resolve(flags['data-root'] || process.env.DATA_DIR || path.join(repo,'data'));
    const artifactRoot=path.resolve(flags['artifact-root'] || path.join(dataRoot,'migration-staging'));
    const artifactKey=flags.artifact || flags.snapshot;
    const opts={dataRoot,artifactRoot,artifactKey,run:flags.run || 'default'};
    const sourceOptions={...opts,campaign:flags.campaign,artifactKey:artifactKey || crypto.randomUUID(),descriptorRoots:[path.join(repo,'public/bundled-mods'),path.join(repo,'mods')],
        assetRoots:{portraits:path.resolve(flags['portrait-root'] || (process.env.NODE_ENV==='production' ? path.join(dataRoot,'portraits') : path.join(repo,'public/assets/portraits')))}};
    switch(operation) {
        case 'inspect-source': if(!flags['dry-run']) fail('dry-run-required'); return captureSnapshot({...sourceOptions,dryRun:true});
        case 'snapshot': return captureSnapshot(sourceOptions);
        case 'import': return importSnapshot(opts);
        case 'verify': return verifyArtifact(opts);
        case 'retry': if(flags.operation==='import') return importSnapshot(opts); if(flags.operation==='verify') return verifyArtifact(opts); fail('retry-operation-required'); break;
        case 'status': {
            const status=inspectArtifact(opts);
            if(flags.backup && flags['drill-key']) {
                const p=artifactPaths(artifactRoot,artifactKey);
                const backup=inside(p.artifact,'backups/'+key(flags.backup));
                const drill=inside(path.resolve(flags['restore-root'] || defaultRestoreRoot(dataRoot)),key(flags['drill-key']));
                return {...status,restoreProof:'restore-tested',eligibility:assertImportEligible({backup,drill})};
            }
            return status;
        }
        case 'report': case 'mismatches': return withArtifact({...opts,readonly:true,validatePayloads:false},ctx=> {
            const row=ctx.db.prepare('SELECT report_body,report_digest FROM migration_runs WHERE run_id=?').get(opts.run);
            if(!row?.report_body) fail('unpublished-report');
            const report=JSON.parse(row.report_body);
            if(digest(report)!==row.report_digest || report.manifest!==ctx.manifest.digest || report.run!==opts.run || report.type!=='MigrationReport') fail('invalid-report');
            return operation==='report' ? report : report.findings.filter(f=>f.severity!=='informational');
        });
        case 'backup': return backupArtifact({...opts,backupKey:flags['backup-key']});
        case 'restore-check': {
            const p=artifactPaths(artifactRoot,artifactKey),backup=inside(p.artifact,'backups/'+key(flags.backup));
            const restoreRoot=path.resolve(flags['restore-root'] || defaultRestoreRoot(dataRoot));
            return restoreCheck({backup,restoreRoot,dataRoot,assetRoots:sourceOptions.assetRoots,drillKey:flags['drill-key']});
        }
        case 'inspect-lease': return inspectLease(flags.artifact ? artifactPaths(artifactRoot,artifactKey).artifact : dataRoot,flags.artifact ? '.artifact.lease' : '.data-directory.lease');
        case 'recover-lease': return {quarantined:recoverLease(flags.artifact ? artifactPaths(artifactRoot,artifactKey).artifact : dataRoot,flags.token || flags.fingerprint,flags['confirmed-stopped']===true,flags.artifact ? '.artifact.lease' : '.data-directory.lease')};
        case 'discard': {
            const p=artifactPaths(artifactRoot,artifactKey);
            separate(p.artifact,path.join(dataRoot,'campaigns')); separate(p.artifact,path.join(dataRoot,'authority'));
            if(flags['dry-run']) return {owned:p.artifact,action:'quarantine',snapshotRetained:!flags['include-snapshot']};
            if(!flags['include-snapshot'] && !fs.existsSync(p.snapshot)) fail('snapshot-retention-unavailable');
            const lease=acquireLease(p.artifact,'discard','.artifact.lease');
            const quarantine=inside(artifactRoot,key(artifactKey)+'-quarantine-'+crypto.randomUUID());
            try {
                // Quarantine preserves forensic data; explicit snapshot retention keeps snapshot in place.
                {
                    fs.mkdirSync(quarantine);
                    for(const name of [...(flags['include-snapshot'] ? ['snapshot'] : []),'work','reports','backups','restore-drills']) {
                        const target=inside(p.artifact,name);
                        if(fs.existsSync(target)) fs.renameSync(target,inside(quarantine,name));
                    }
                }
                return {quarantined:quarantine,snapshotRetained:!flags['include-snapshot']};
            } finally {lease.release();}
        }
        default: fail('unsupported-operation');
    }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    try {
        const result=await main(process.argv.slice(2));
        console.log(JSON.stringify(result,null,2));
        if(result?.status==='blocked' || result?.blockers>0) process.exitCode=2;
    } catch(e) {
        // Never echo native errors, source values, SQL payloads, or arbitrary user input.
        const code=/^[a-z][a-z0-9-]+$/.test(e.code ?? '') ? e.code : 'io-or-integrity-failure';
        console.error(JSON.stringify({format:1,status:'failed',code}));
        process.exitCode=/busy|stale|conflict|exists|owner-running/.test(code) ? 3 : /unsupported|not-supported|schema/.test(code) ? 4 : 5;
    }
}
