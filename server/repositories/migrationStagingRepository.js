import { isMutationCommand } from '@narrative/engine/contracts/mutation';
import { validateAuthorityExpectation, matchesVersion } from '@narrative/engine/contracts/authorityRouter';
import { transitionAuthority } from '@narrative/engine/contracts/authorityTransition';
import { transaction } from '../db/campaignDb.js';
import { canonical, fail, TOOL } from '../services/campaignMigration/artifact.js';
import { pointerPart, recordData, readSource, archiveRanges, archiveProseRanges } from '../services/campaignMigration/readers.js';
import { rawLinks } from '../services/campaignMigration/verifier.js';
import { privacy } from '../services/campaignMigration/snapshot.js';

const KINDS = ['migration.run-create','migration.source-stage','migration.verify'];
/** @returns {{route: (command: object) => Promise<object>}} Narrow DomainAuthorityRouter capability. */
export function createStagingRouter(context) {
    return {route:async command=>routeStagingCommand({...context,command})};
}
export function semanticRequest(command) {
    const { expectedOwner: _owner, expectedFormatEpoch: _epoch, ...body } = command;
    if (body.idempotency.mode === 'caller-key') delete body.commandId;
    return canonical({ format: 1, command: body });
}
export function stageSource(db, snapshot, manifest, run, source, fault) {
    const value = readSource(snapshot,source), records = [];
    if (source.presence === 'present') {
        if (source.parse === 'json') {
            function visit(node, locator = '$') {
                records.push(recordData(manifest,source,locator,records.length,node));
                if (node && typeof node === 'object') {
                    for (const k of Object.keys(node).sort((a,b) => Array.isArray(node) ? Number(a)-Number(b) : a < b ? -1 : a > b ? 1 : 0)) visit(node[k],locator+'/'+pointerPart(k));
                }
            }
            visit(value);
        } else {
            records.push(recordData(manifest,source,'$',0,value,'base64'));
            if (source.family === 'archive') for (const range of archiveRanges(value)) {
                records.push(recordData(manifest,source,`bytes:${range.start}:${range.end}`,records.length,value.subarray(range.start,range.end),'base64'));
            }
            if (source.family === 'archive') for (const range of archiveProseRanges(value)) {
                records.push(recordData(manifest,source,`prose:${range.role}:${range.start}:${range.end}`,records.length,value.subarray(range.start,range.end),'base64'));
            }
        }
    }
    db.prepare('INSERT INTO migration_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(run,source.id,source.path,source.family,
        source.presence,source.hash,source.bytes,source.hash ? 'sha256:'+source.hash : 'absent:'+manifest.digest,
        canonical(source.descriptor),source.parse,records.length,records.length,records.length);
    const insert = db.prepare('INSERT INTO staged_records VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const r of records) insert.run(run,source.id,r.locator,r.kind,r.ordinal,r.original_key,r.compatibility_ref,r.canonical_ref,r.encoding,r.payload,r.semantic_hash);
    const linkInsert = db.prepare("INSERT INTO staged_links VALUES (?,?,?,?,?,?,NULL,NULL,'candidate')");
    for (const r of records.filter(r=>r.encoding === 'json')) for (const l of rawLinks(JSON.parse(r.payload),source)) {
        linkInsert.run(run,source.id,r.locator,l.relation,l.ordinal,l.raw_target);
    }
    fault('source-before-commit');
    return { source: source.id, count: records.length };
}

// Artifact capability only. Its transaction owns rows, revision, and durable outcome together.
export function routeStagingCommand({ db, manifest, snapshot, command, verify, fault = () => {}, view = { owner: 'migration-staging', formatEpoch: 1, writable: true } }) {
    const payloadGuard = p => p && typeof p === 'object' && typeof p.run === 'string' && p.manifest === manifest.digest
        && /^[a-zA-Z0-9_-]{1,100}$/.test(p.run) && p.tool === TOOL && Object.keys(p).every(k => ['run','manifest','tool','source'].includes(k))
        && (command.kind==='migration.source-stage' ? typeof p.source==='string' : !Object.hasOwn(p,'source'));
    if (!KINDS.includes(command?.kind) || !isMutationCommand(command,command.kind,payloadGuard)) return { status: 'malformed-command', reason: 'invalid-envelope' };
    try {privacy(command);} catch {return {status:'malformed-command',reason:'invalid-envelope'};}
    if(command.provenance.writerId!=='migration.coordinator' || command.provenance.origin!==(command.kind==='migration.verify'?'migration':'import')) return {status:'malformed-command',reason:'invalid-envelope'};
    return transaction(db, () => {
        const mode = command.idempotency.mode;
        const logical = mode === 'caller-key' ? command.idempotency.key : command.commandId;
        const args = [command.campaignId,command.domainId,mode,logical];
        const semantic = semanticRequest(command);
        const previous = db.prepare('SELECT * FROM migration_command_outcomes WHERE campaign=? AND domain=? AND mode=? AND logical_key=?').get(...args);
        if (previous) return previous.semantic_request === semantic ? { ...JSON.parse(previous.outcome), status: 'duplicate' }
            : { status: 'malformed-command', reason: 'idempotency-key-reused' };
        const rejection = validateAuthorityExpectation(command, command.campaignId === manifest.identity.campaignId && command.domainId === 'migration-staging' ? view : undefined);
        if (rejection) return rejection;
        const run = command.payload.run;
        const prior = db.prepare('SELECT * FROM migration_runs WHERE run_id=?').get(run);
        const actual = prior ? 'run:'+prior.revision : null;
        if (!matchesVersion(command.expectedVersion,actual)) return { status: 'version-conflict', actualVersion: actual };
        if (command.kind === 'migration.run-create' && prior || command.kind !== 'migration.run-create' && !prior) return { status: 'version-conflict', actualVersion: actual };
        let value;
        if (command.kind === 'migration.run-create') {
            db.prepare("INSERT INTO migration_runs(run_id,manifest_hash,importer,status,revision) VALUES (?,?,?,'incomplete',1)").run(run,manifest.digest,TOOL);
            for (const domain of [...new Set(manifest.sources.map(s => s.family.replace(/[^a-z0-9.-]/gi,'-').toLowerCase()))]) {
                const init = transitionAuthority(undefined,domain,{ type:'initialize', legacyOwner:'legacy-runtime',formatEpoch:1 });
                const shadow = transitionAuthority(init.state,domain,{ type:'begin-shadow',newOwner:'future-sqlite',expectedOwner:'legacy-runtime',expectedFormatEpoch:1 });
                if (shadow.status !== 'transitioned') fail('invalid-staging-authority');
                db.prepare("INSERT INTO domain_authority VALUES (?,?,?,'staging-only',NULL)").run(run,domain,canonical(shadow.state));
            }
            value = { run };
        } else if (command.kind === 'migration.source-stage') {
            if (prior.status !== 'incomplete') fail('run-not-writable');
            const source = manifest.sources.find(s => s.id === command.payload.source);
            if (!source) fail('unknown-source');
            value = stageSource(db,snapshot,manifest,run,source,fault);
            db.prepare('UPDATE migration_runs SET revision=revision+1 WHERE run_id=?').run(run);
            const count = db.prepare('SELECT count(*) n FROM migration_sources WHERE run_id=?').get(run).n;
            if (count === manifest.sources.length) db.prepare("UPDATE migration_runs SET status='imported' WHERE run_id=?").run(run);
        } else {
            if (prior.status === 'incomplete' || !verify) fail('incomplete-run');
            value = verify(db,run);
            db.prepare('UPDATE migration_runs SET revision=revision+1 WHERE run_id=?').run(run);
        }
        const version = 'run:'+db.prepare('SELECT revision FROM migration_runs WHERE run_id=?').get(run).revision;
        const result = { status:'accepted',value,version };
        db.prepare('INSERT INTO migration_command_outcomes VALUES (?,?,?,?,?,?,?,?)').run(...args,semantic,view.owner,view.formatEpoch,canonical(result));
        fault('command-before-commit');
        return result;
    });
}
