import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isMutationCommand } from '@narrative/engine/contracts/mutation';
import { isAuthorityTransitionState } from '@narrative/engine/contracts/authorityTransition';
import { createStableId } from '@narrative/engine/contracts/identity';
import { acquireLease } from '../../lib/dataDirectoryLease.js';
import { openCampaignDb, integrity } from '../../db/campaignDb.js';
import { artifactPaths } from '../campaignMigration.js';
import { FORMAT, TOOL, canonical, canonicalPath, digest, fail, files, hash, inside, key, readSealed, seal, separate, writeDurable } from './artifact.js';
import { snapshotBinding, validateSnapshot } from './snapshot.js';
import { reconcile } from './verifier.js';

function publishedReport(db,run,manifest,snapshot) {
    const row=db.prepare('SELECT * FROM migration_runs WHERE run_id=?').get(run);
    if (!row || !['verified','blocked'].includes(row.status) || !row.report_body || row.verifier !== TOOL) fail('unpublished-report');
    const report=JSON.parse(row.report_body);
    if (report.type !== 'MigrationReport' || report.format !== FORMAT || report.tool !== TOOL || report.manifest !== manifest.digest
        || digest(report) !== row.report_digest || report.status !== row.status || row.blocking_count !== report.blockers
        || !Array.isArray(report.findings) || report.findings.some(f=>!['informational','warning','cutover-blocking'].includes(f.severity))
        || report.blockers !== report.findings.filter(f=>f.severity === 'cutover-blocking').length) fail('stale-or-invalid-report');
    const current=reconcile({db,run,manifest,snapshot});
    if (canonical(current) !== canonical(report)) fail('verification-no-longer-matches');
    const storedFindings=db.prepare('SELECT finding_id,source_id,locator,code,severity,disposition,evidence FROM migration_findings WHERE run_id=? ORDER BY finding_id').all(run);
    const expectedFindings=report.findings.map((f,i)=>({finding_id:i,source_id:f.source,locator:f.locator,code:f.code,severity:f.severity,disposition:f.disposition,evidence:f.evidence}));
    if(canonical(storedFindings)!==canonical(expectedFindings)) fail('finding-publication-mismatch');
    auditOperational(db,run,manifest,report);
    return { report,digest:row.report_digest };
}

// Retained operational ledger/control are recovery material, never live authorization.
function auditOperational(db,run,manifest,report) {
    const outcomes=db.prepare('SELECT * FROM migration_command_outcomes WHERE campaign=? ORDER BY logical_key').all(manifest.identity.campaignId);
    const runOutcomes=outcomes.filter(o=>JSON.parse(o.semantic_request).command?.payload?.run === run);
    if (runOutcomes.length !== manifest.sources.length+2) fail('outcome-closure-mismatch');
    const expectedOps=new Set(['migration.run-create:run','migration.verify:run',...manifest.sources.map(s=>'migration.source-stage:'+s.id)]);
    for (const o of runOutcomes) {
        const semantic=JSON.parse(o.semantic_request), body=semantic.command;
        const logical=`${run}:${body.kind}:${body.payload.source ?? 'run'}:${TOOL}`;
        const command={...body,expectedOwner:o.owner,expectedFormatEpoch:o.epoch};
        if (body.idempotency.mode === 'caller-key') command.commandId=createOperationalCommandId(manifest,logical);
        const outcome=JSON.parse(o.outcome);
        if (semantic.format !== 1 || !isMutationCommand(command,body.kind,p=>p?.manifest === manifest.digest && p?.tool === TOOL)
            || o.domain !== 'migration-staging' || o.owner !== 'migration-staging' || o.epoch !== 1 || o.mode !== body.idempotency.mode
            || o.logical_key !== (o.mode==='caller-key' ? body.idempotency.key : body.commandId)
            || outcome.status !== 'accepted' || !/^run:\d+$/.test(outcome.version)
            || !expectedOps.delete(body.kind+':'+(body.payload.source ?? 'run'))) fail('invalid-operational-outcome');
        const index=body.kind === 'migration.run-create' ? 0 : body.kind === 'migration.verify' ? manifest.sources.length+1
            : manifest.sources.findIndex(s=>s.id === body.payload.source)+1;
        if (outcome.version !== 'run:'+(index+1)
            || canonical(body.expectedVersion) !== canonical(index===0 ? {mode:'create-if-absent'} : {mode:'exact',version:'run:'+index})) fail('outcome-version-mismatch');
        if (body.kind === 'migration.verify' && outcome.value.reportDigest !== digest(report)) fail('outcome-report-mismatch');
    }
    if (expectedOps.size) fail('outcome-closure-mismatch');
    for (const row of db.prepare('SELECT * FROM domain_authority WHERE run_id=?').all(run)) {
        const state=JSON.parse(row.state);
        if (!isAuthorityTransitionState(state) || state.stage !== 'shadow' || state.firstNewOwnerWrite || state.cutoverPrepared
            || row.scope !== 'staging-only' || (!report.blockers && !state.verification)) fail('invalid-authority-recovery');
    }
}
function createOperationalCommandId(m,logical) { return createStableId({kind:'command',campaign:m.identity.campaignId,namespace:'migration.command.v1',key:logical}); }

export async function backupArtifact({artifactRoot,artifactKey,run='default',backupKey=crypto.randomUUID(),fault=()=>{}}) {
    key(run); key(backupKey);
    const p=artifactPaths(artifactRoot,artifactKey), lease=acquireLease(p.artifact,'migration-backup','.artifact.lease');
    let db;
    try {
        const manifest=validateSnapshot(p.snapshot);
        db=openCampaignDb({file:p.file,mode:'inspect-readonly',binding:snapshotBinding(manifest)});
        const verified=publishedReport(db,run,manifest,p.snapshot);
        const backupRoot=inside(p.artifact,'backups'); fs.mkdirSync(backupRoot,{recursive:true});
        const partial=inside(backupRoot,backupKey+'.partial'); fs.mkdirSync(partial);
        const dbFile=inside(partial,'work/campaign.sqlite'); fs.mkdirSync(path.dirname(dbFile),{recursive:true});
        await db.backup(dbFile);
        fault('backup-after-db');
        const fd=fs.openSync(dbFile,'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        for (const member of files(p.snapshot)) writeDurable(inside(partial,'snapshot/'+member),fs.readFileSync(inside(p.snapshot,member)));
        seal(inside(partial,'reports/'+run+'.json'),verified.report);
        const members=files(partial).map(member=>({path:member,hash:hash(fs.readFileSync(inside(partial,member))),bytes:fs.statSync(inside(partial,member)).size}));
        seal(inside(partial,'backup-manifest.json'),{format:FORMAT,tool:TOOL,type:'BackupManifest',backupKey,artifactKey,run,
            binding:snapshotBinding(manifest),reportDigest:verified.digest,schema:1,members,exclusions:['vectors','settings','vault','providers']});
        validateBackup(partial);
        fault('backup-before-publish');
        const backup=inside(backupRoot,backupKey); fs.renameSync(partial,backup);
        return {backupKey,backup,digest:readSealed(inside(backup,'backup-manifest.json')).digest};
    } finally { db?.close(); lease.release(); }
}

export function validateBackup(backup) {
    const manifest=readSealed(inside(backup,'backup-manifest.json'));
    if (manifest.type !== 'BackupManifest' || manifest.schema !== 1 || !Array.isArray(manifest.members)) fail('unsupported-backup');
    key(manifest.backupKey); key(manifest.artifactKey); key(manifest.run);
    const seen=new Set();
    for (const member of manifest.members) {
        if (seen.has(member.path) || !(member.path==='work/campaign.sqlite' || member.path===`reports/${manifest.run}.json`
            || member.path==='snapshot/manifest.json' || /^snapshot\/(?:source\/(?:campaigns|authority)\/|objects\/[a-f0-9]{64}$)/.test(member.path))) fail('unsafe-backup-member');
        seen.add(member.path);
        const bytes=fs.readFileSync(inside(backup,member.path));
        if (hash(bytes)!==member.hash || bytes.length!==member.bytes) fail('backup-member-mismatch');
    }
    if (!seen.has('work/campaign.sqlite') || !seen.has('snapshot/manifest.json') || !seen.has(`reports/${manifest.run}.json`)) fail('incomplete-backup');
    if (canonical(files(backup).sort()) !== canonical(['backup-manifest.json',...seen].sort())) fail('unmanifested-backup-member');
    const source=validateSnapshot(inside(backup,'snapshot'));
    if (canonical(snapshotBinding(source))!==canonical(manifest.binding)) fail('backup-source-binding-mismatch');
    const report=readSealed(inside(backup,`reports/${manifest.run}.json`));
    if (report.digest!==manifest.reportDigest) fail('backup-report-binding-mismatch');
    return manifest;
}

export function defaultRestoreRoot(dataRoot) {
    const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
    const resolved=canonicalPath(dataRoot);
    const sibling=path.join(path.dirname(resolved),path.basename(resolved)+'-migration-restore-drills');
    try { separate(canonicalPath(sibling),canonicalPath(projectRoot));return sibling; }
    catch(e) {
        if(e.code!=='overlapping-roots') throw e;
        return path.join(path.dirname(projectRoot),path.basename(projectRoot)+'-migration-restore-drills');
    }
}

export function restoreCheck({backup,restoreRoot,drillKey=crypto.randomUUID(),dataRoot,assetRoots,liveAssetRoots=[],fault=()=>{}}) {
    key(drillKey);
    if (!path.isAbsolute(restoreRoot) || !dataRoot || !path.isAbsolute(dataRoot)) fail('explicit-restore-roots-required');
    if(!assetRoots || typeof assetRoots!=='object' || Array.isArray(assetRoots)
        || [...Object.values(assetRoots),...liveAssetRoots].some(root=>typeof root!=='string' || !path.isAbsolute(root))) fail('explicit-asset-roots-required');
    restoreRoot=canonicalPath(restoreRoot);
    const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
    const publicRoot=path.join(projectRoot,'public');
    const protectedRoots=[dataRoot,path.join(dataRoot,'campaigns'),path.join(dataRoot,'authority'),path.join(dataRoot,'portraits'),
        projectRoot,publicRoot,...Object.values(assetRoots),...liveAssetRoots];
    for(const protectedRoot of protectedRoots) separate(restoreRoot,canonicalPath(protectedRoot));
    separate(restoreRoot,canonicalPath(backup));
    const b=validateBackup(backup);
    fs.mkdirSync(restoreRoot,{recursive:true});
    const drill=inside(restoreRoot,drillKey); fs.mkdirSync(drill);
    const dest=inside(drill,'restored'); fs.mkdirSync(dest);
    for (const member of b.members) {
        const bytes=fs.readFileSync(inside(backup,member.path));
        if(hash(bytes)!==member.hash || bytes.length!==member.bytes) fail('backup-member-drift');
        writeDurable(inside(dest,member.path),bytes);
        if(hash(fs.readFileSync(inside(dest,member.path)))!==member.hash) fail('restore-member-mismatch');
        fault('restore-member');
    }
    const manifest=validateSnapshot(inside(dest,'snapshot'));
    // Only restored paths are available to this verifier; no original DB/source roots are accepted.
    const db=openCampaignDb({file:inside(dest,'work/campaign.sqlite'),mode:'inspect-readonly',binding:snapshotBinding(manifest)});
    let verified;
    try { integrity(db); verified=publishedReport(db,b.run,manifest,inside(dest,'snapshot')); }
    finally { db.close(); }
    if (verified.digest!==b.reportDigest) fail('restore-report-mismatch');
    const body={format:FORMAT,tool:TOOL,type:'RestoreVerificationReport',status:'restore-tested',backupDigest:b.digest,
        manifest:manifest.digest,reportDigest:verified.digest,run:b.run,schema:b.schema,drillKey,
        memberDigest:digest(b.members),blockers:verified.report.blockers,checks:['schema','integrity','foreign-keys','source-expectations','provenance','order','references','objects','outcomes','authority']};
    fault('restore-before-proof');
    seal(inside(drill,'restore-proof.json'),body);
    return {drill,proof:readSealed(inside(drill,'restore-proof.json'))};
}

export function assertImportEligible({backup,drill}) {
    const b=validateBackup(backup),proof=readSealed(inside(drill,'restore-proof.json'));
    if (proof.type!=='RestoreVerificationReport' || proof.status!=='restore-tested' || proof.backupDigest!==b.digest
        || proof.manifest!==b.binding.manifest || proof.reportDigest!==b.reportDigest || proof.schema!==b.schema || proof.run!==b.run
        || proof.memberDigest!==digest(b.members) || proof.blockers!==0) fail('ineligible-restore-proof');
    const dest=inside(drill,'restored');
    for (const member of b.members) {
        const bytes=fs.readFileSync(inside(dest,member.path));
        if (hash(bytes)!==member.hash) fail('restored-member-drift');
    }
    const manifest=validateSnapshot(inside(dest,'snapshot'));
    const db=openCampaignDb({file:inside(dest,'work/campaign.sqlite'),mode:'inspect-readonly',binding:snapshotBinding(manifest)});
    try {
        const verified=publishedReport(db,b.run,manifest,inside(dest,'snapshot'));
        if (verified.report.blockers || verified.digest!==b.reportDigest || verified.report.status!=='verified') fail('ineligible-blockers');
    } finally {db.close();}
    return {status:'eligible-snapshot-only',manifest:manifest.digest,backupDigest:b.digest,reportDigest:b.reportDigest};
}
