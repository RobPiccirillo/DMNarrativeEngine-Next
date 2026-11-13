import fs from 'node:fs';
import { createStableId } from '@narrative/engine/contracts/identity';
import { acquireLease } from '../lib/dataDirectoryLease.js';
import { openCampaignDb } from '../db/campaignDb.js';
import { routeStagingCommand } from '../repositories/migrationStagingRepository.js';
import { FORMAT, TOOL, canonical, digest, fail, inside, key, seal, writeDurable, readSealed } from './campaignMigration/artifact.js';
import { snapshotBinding, validateSnapshot } from './campaignMigration/snapshot.js';
import { contextRecord, references } from './campaignMigration/readers.js';
import { reconcile, publishVerification, expectations } from './campaignMigration/verifier.js';

export function artifactPaths(artifactRoot,artifactKey) {
    const artifact = inside(artifactRoot,key(artifactKey));
    return { artifact,snapshot:inside(artifact,'snapshot'),file:inside(artifact,'work/campaign.sqlite') };
}
export function withArtifact({ artifactRoot,artifactKey,readonly = false,validatePayloads = true },callback) {
    const paths = artifactPaths(artifactRoot,artifactKey);
    const lease = readonly ? null : acquireLease(paths.artifact,'migration-artifact','.artifact.lease');
    let db;
    try {
        const manifest = validatePayloads ? validateSnapshot(paths.snapshot) : readSealed(inside(paths.snapshot,'manifest.json'));
        db = openCampaignDb({ file:paths.file,binding:snapshotBinding(manifest),mode:readonly ? 'inspect-readonly' : fs.existsSync(paths.file) ? 'upgrade-disposable-copy' : 'create-staging' });
        const result=callback({ ...paths,db,manifest });
        if(result && typeof result.then==='function') fail('async-artifact-callback-refused');
        return result;
    } finally { db?.close(); lease?.release(); }
}
export function makeCommand(manifest,run,operation,expectedVersion,source) {
    key(run);
    const logical = `${run}:${operation}:${source ?? 'run'}:${TOOL}`;
    return { commandId:createStableId({ kind:'command',campaign:manifest.identity.campaignId,namespace:'migration.command.v1',key:logical }),
        campaignId:manifest.identity.campaignId,domainId:'migration-staging',kind:operation,
        provenance:{ origin:operation === 'migration.verify' ? 'migration' : 'import',writerId:'migration.coordinator',
            importSource:{type:'compatibility',kind:'source-item',id:references(manifest,{id:source ?? 'manifest',family:'migration'},['$'])[0]} },
        expectedOwner:'migration-staging',expectedFormatEpoch:1,expectedVersion,
        idempotency:{ mode:'caller-key',key:logical },payload:{ run,manifest:manifest.digest,tool:TOOL,...(source ? {source} : {}) } };
}
function accepted(result) { if (!['accepted','duplicate'].includes(result.status)) fail(result.reason ?? result.status); return result; }
export function importSnapshot(options) {
    const { run = 'default',fault = () => {} } = options;
    return withArtifact(options,ctx => {
        const route = command => accepted(routeStagingCommand({ ...ctx,command,fault }));
        let outcome = route(makeCommand(ctx.manifest,run,'migration.run-create',{mode:'create-if-absent'}));
        // Replaying from the persisted sequence retains the original content preconditions.
        for (const source of ctx.manifest.sources) {
            outcome = route(makeCommand(ctx.manifest,run,'migration.source-stage',{mode:'exact',version:outcome.version},source.id));
            fault('source-after-commit');
        }
        return { run,version:outcome.version,manifest:ctx.manifest.digest,status:'imported' };
    });
}
export function verifyArtifact(options) {
    const { run = 'default',fault = () => {} } = options;
    return withArtifact(options,ctx => {
        const count = ctx.manifest.sources.length;
        const command = makeCommand(ctx.manifest,run,'migration.verify',{mode:'exact',version:'run:'+(count+1)});
        accepted(routeStagingCommand({ ...ctx,command,fault,verify:(db,id)=>publishVerification(db,id,reconcile({ ...ctx,run:id }),fault) }));
        fault('verification-after-commit');
        const row = ctx.db.prepare('SELECT report_body,report_digest FROM migration_runs WHERE run_id=?').get(run);
        const report = JSON.parse(row.report_body);
        if(digest(report)!==row.report_digest || canonical(reconcile({...ctx,run}))!==canonical(report)) fail('verification-no-longer-matches');
        // Projection can be regenerated after a committed verification with lost acknowledgement.
        const reportDir = inside(ctx.artifact,'reports'); fs.mkdirSync(reportDir,{recursive:true});
        const target = inside(reportDir,key(run)+'.json');
        if (!fs.existsSync(target)) seal(target,report);
        else if(readSealed(target).digest!==row.report_digest) fail('report-projection-mismatch');
        const markdown = inside(reportDir,run+'.md');
        if (!fs.existsSync(markdown)) writeProjection(markdown,report);
        return { ...report,digest:row.report_digest };
    });
}
export function writeProjection(file,report) {
    const lines = [`# Phase 2 staging report`, '', `Status: ${report.status}. Blockers: ${report.blockers}.`,
        `Manifest: ${report.manifest}`, '', 'This verifies a preserved snapshot only. Gameplay remains legacy.', '',
        '| Source | Expected | Staged | Match |','| --- | --- | --- | --- |',
        ...report.coverage.map(c=>`| ${c.source} | ${c.expected} | ${c.staged} | ${c.matched} |`),'',
        ...report.findings.map(f=>`- ${f.severity}: ${f.code} (${f.source ?? 'artifact'} ${f.locator ?? ''})`),''];
    writeDurable(file,lines.join('\n'));
}
export function inspectArtifact(options) {
    const paths=artifactPaths(options.artifactRoot,options.artifactKey);
    if(!fs.existsSync(inside(paths.snapshot,'manifest.json'))) {
        if(fs.existsSync(inside(paths.artifact,'snapshot.partial'))) return {format:FORMAT,tool:TOOL,status:'unsealed',artifact:options.artifactKey};
        fail('missing-snapshot');
    }
    if(!fs.existsSync(paths.file)) return {format:FORMAT,tool:TOOL,status:'sealed-not-imported',manifest:readSealed(inside(paths.snapshot,'manifest.json')).digest};
    return withArtifact({ ...options,readonly:true,validatePayloads:false },ctx=>({ format:FORMAT,tool:TOOL,manifest:ctx.manifest.digest,
        inspection:'metadata-only',restoreProof:'not-supplied',
        runs:ctx.db.prepare('SELECT run_id,status,revision,report_digest,blocking_count FROM migration_runs ORDER BY run_id LIMIT 100').all() }));
}
export function readStagedRecord(options) {
    return withArtifact({ ...options,readonly:true },ctx=> {
        const source = ctx.manifest.sources.find(s=>s.id === options.source);
        if (!source || 'sha256:'+source.hash !== options.expectedSourceVersion) fail('stale-source');
        const run = ctx.db.prepare('SELECT status FROM migration_runs WHERE run_id=?').get(options.run);
        if (!run || !['verified','blocked'].includes(run.status)) fail('unpublished-run');
        const row = ctx.db.prepare('SELECT * FROM staged_records WHERE run_id=? AND source_id=? AND locator=?').get(options.run,source.id,options.locator);
        if (!row) fail('missing-record');
        const expected = expectations(ctx.snapshot,ctx.manifest,source).find(r=>r.locator===row.locator);
        if (!expected || expected.semantic_hash !== row.semantic_hash || expected.payload !== row.payload || expected.compatibility_ref !== row.compatibility_ref) fail('record-integrity-mismatch');
        return contextRecord(ctx.manifest,source,row.locator,row.encoding === 'json' ? JSON.parse(row.payload) : {encoding:'base64',bytes:row.payload});
    });
}
export function assertSupportedOperation(operation) {
    if (['prepare-cutover','commit-cutover','mark-new-owner-write','rollback','retire','authoritative-write'].includes(operation)) fail('not-supported-in-phase2');
}
