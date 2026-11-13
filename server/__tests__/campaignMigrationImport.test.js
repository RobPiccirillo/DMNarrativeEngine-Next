import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, tree } from './migrationFixtures.js';
import { captureSnapshot, descriptors } from '../services/campaignMigration/snapshot.js';
import { importSnapshot, verifyArtifact, withArtifact, makeCommand, readStagedRecord, assertSupportedOperation } from '../services/campaignMigration.js';
import { routeStagingCommand,createStagingRouter } from '../repositories/migrationStagingRepository.js';
import { reconcile } from '../services/campaignMigration/verifier.js';
import { isContextRecord } from '@narrative/engine';

const active = [];
const make = () => { const f=fixture(); active.push(f); return f; };
afterEach(()=>active.splice(0).forEach(f=>f.cleanup()));
const roots = [path.resolve('public/bundled-mods'),path.resolve('mods')];
function setup(f) { captureSnapshot({ ...f,artifactKey:'one',descriptorRoots:roots }); return { ...f,artifactKey:'one',run:'default' }; }
describe('Package B: staging-only import and independent reconciliation',()=> {
    it('covers empty sources and every first party/unknown/retained/relationship source with opaque field inventory',()=> {
        const f=make(), tables=descriptors(roots);
        expect(tables.filter(t=>['arc','enemies','worldmap'].includes(t.mod))).toHaveLength(16);
        for (const t of tables) f.write(t.suffix,t.shape==='array'?[]:{});
        f.write('.relationship-memory.npc-to-mc.json',[{ subject:'Nameless',target:'MC',content:'token of friendship' }]);
        f.write('.relationship-memory.npc-to-npc.json',[{ subject:'Nameless',target:'Other',knownBy:['any'] }]);
        f.write('.mod-gone-unknown.json',[{ id:'opaque',unknown:{ nested:[1,null,'prose'] } }]);
        for (const suffix of ['.enemies.json','.enemy-instances.json','.enemy-encounters.json','.enemy-resolutions.json','.enemy-combat.json','.migrations.json','.overworld.json','.facts.json','.timeline.json','.divergence.json','.npcs.json','.locations.json','.entities.json','.lore.json','.archive.index.json','.archive.chapters.json']) f.write(suffix,[]);
        f.write('.enemy-combat.json',{});f.write('.migrations.json',{});f.write('.overworld.json',{});f.write('.divergence.json',{version:1,entries:[]});
        const before=tree(f.dataRoot), opts=setup(f);
        expect(importSnapshot(opts).status).toBe('imported');
        const report=verifyArtifact(opts);
        expect(report.findings.filter(f=>f.severity==='cutover-blocking').map(f=>f.code)).toEqual(['unknown-source-criticality']);
        expect(report.coverage.every(c=>c.matched)).toBe(true);
        expect(tree(f.dataRoot)).toEqual(before);
        const again=importSnapshot(opts); expect(again.status).toBe('imported');
        expect(verifyArtifact(opts)).toEqual(report);
        const source='campaigns/test.mod-gone-unknown.json';
        const record=readStagedRecord({ ...opts,source,locator:'$/0',expectedSourceVersion:'sha256:'+report.coverage.find(c=>c.source===source).hash });
        expect(isContextRecord(record,'source-item',()=>true)).toBe(true);
        expect(record.reference.type).toBe('compatibility');
        expect(()=>readStagedRecord({ ...opts,source,locator:'$',expectedSourceVersion:'old' })).toThrow('stale-source');
    });
    it('detects importer omissions, payload/order/provenance alterations independently of importer counters',()=> {
        const f=make(); f.write('.npcs.json',[{id:'a'},{id:'b'}]);
        const opts=setup(f); importSnapshot(opts);
        withArtifact(opts,ctx=> {
            ctx.db.prepare("DELETE FROM staged_records WHERE source_id='campaigns/test.npcs.json' AND locator='$/1/id'").run();
            const report=reconcile({ ...ctx,run:opts.run });
            expect(report.findings.some(f=>f.code==='record-content-order-or-provenance-mismatch')).toBe(true);
            expect(report.blockers).toBeGreaterThan(0);
        });
    });
    it('durably recovers both command replay modes before current authority/version checks',()=> {
        const opts=setup(make());
        let command;
        withArtifact(opts,ctx=> {
            command=makeCommand(ctx.manifest,'unit','migration.run-create',{mode:'create-if-absent'});
            expect(routeStagingCommand({ ...ctx,command }).status).toBe('accepted');
            expect(routeStagingCommand({ ...ctx,command:{ ...command,payload:{...command.payload,run:'changed'} } }).reason).toBe('idempotency-key-reused');
        });
        withArtifact(opts,ctx=> {
            expect(routeStagingCommand({ ...ctx,command:{...command,expectedOwner:'other',expectedFormatEpoch:9},view:undefined }).status).toBe('duplicate');
            const fresh=makeCommand(ctx.manifest,'unit','migration.source-stage',{mode:'exact',version:'wrong'},ctx.manifest.sources[0].id);
            expect(routeStagingCommand({ ...ctx,command:fresh }).status).toBe('version-conflict');
            const idCommand={...makeCommand(ctx.manifest,'command-id','migration.run-create',{mode:'create-if-absent'}),idempotency:{mode:'command-id'}};
            expect(routeStagingCommand({ ...ctx,command:idCommand }).status).toBe('accepted');
            expect(routeStagingCommand({ ...ctx,command:idCommand }).status).toBe('duplicate');
        });
    });
    it('rolls back source population and its outcome together then retries the exact operation',()=> {
        const opts=setup(make());
        expect(()=>importSnapshot({ ...opts,fault:p=>{ if(p==='source-before-commit') throw new Error('disk-fault'); } })).toThrow('disk-fault');
        withArtifact(opts,ctx=> {
            expect(ctx.db.prepare('SELECT count(*) n FROM staged_records').get().n).toBe(0);
            expect(ctx.db.prepare('SELECT count(*) n FROM migration_command_outcomes').get().n).toBe(1);
        });
        importSnapshot(opts); expect(verifyArtifact(opts).status).toBe('verified');
    });
    it('classifies dirty source and forbids live transition capabilities without source changes',()=> {
        const f=make(); f.write('.npcs.json',[{id:'same'},{id:'same'}]); f.write('.facts.json','{bad');
        f.write('.archive.index.json','{optional corrupt');
        f.write('.state.json',{ context:{},messages:[{id:'m',sceneId:'999'}] });
        const before=tree(f.dataRoot),opts=setup(f); importSnapshot(opts);
        const report=verifyArtifact(opts);
        expect(report.status).toBe('blocked');
        expect(report.findings.some(f=>f.code==='duplicate-legacy-key')).toBe(true);
        expect(report.findings.some(f=>f.code==='corrupt-source' && f.severity==='warning')).toBe(true);
        expect(report.findings.some(f=>f.code==='dangling-or-ambiguous-reference')).toBe(true);
        for (const op of ['prepare-cutover','commit-cutover','mark-new-owner-write','rollback','retire']) expect(()=>assertSupportedOperation(op)).toThrow('not-supported');
        expect(tree(f.dataRoot)).toEqual(before);
    });
    it('preserves exact archive byte spans and detects ambiguous delimiters, duplicates and missing chapters',()=> {
        const f=make(); f.write('.archive.md','## SCENE 001\r\n*date*\r\n\r\n**[USER]**\r\n hello \r\n\r\n**[GM]**\r\n exact prose \r\n\r\n---\r\n');
        f.write('.archive.index.json',[{sceneId:'001'}]);
        f.write('.archive.chapters.json',[{chapterId:'CH01',sceneIds:['001']}]);
        const opts=setup(f); importSnapshot(opts); expect(verifyArtifact(opts).status).toBe('verified');
        withArtifact(opts,ctx=> {
            expect(ctx.db.prepare("SELECT count(*) n FROM staged_records WHERE kind='archive'").get().n).toBe(4);
            expect(ctx.db.prepare("SELECT count(*) n FROM staged_links WHERE disposition='resolved' AND target_source IS NOT NULL").get().n).toBeGreaterThan(0);
        });
    });
    it('rejects wrong operational authority, disabled writes and structured command contamination',async()=> {
        const opts=setup(make());
        let routed;
        withArtifact(opts,ctx=> {
            const command=makeCommand(ctx.manifest,'guards','migration.run-create',{mode:'create-if-absent'});
            expect(routeStagingCommand({...ctx,command:{...command,domainId:'narrative-evidence'}}).status).toBe('unsupported-domain');
            expect(routeStagingCommand({...ctx,command:{...command,expectedOwner:'other'}}).status).toBe('owner-mismatch');
            expect(routeStagingCommand({...ctx,command:{...command,expectedFormatEpoch:9}}).reason).toBe('format-epoch-mismatch');
            expect(routeStagingCommand({...ctx,command,view:{owner:'migration-staging',formatEpoch:1,writable:false}}).reason).toBe('writes-disabled');
            expect(routeStagingCommand({...ctx,command:{...command,debugPayload:{apiKey:'COMMAND-CANARY'}}}).status).toBe('malformed-command');
            expect(ctx.db.prepare('SELECT count(*) n FROM migration_command_outcomes').get().n).toBe(0);
            // Invocation enters the synchronous SQL unit before returning its Promise.
            routed=createStagingRouter(ctx).route(command);
        });
        expect((await routed).status).toBe('accepted');
    });
    it.each([
        ['.archive.index.json','{bad','verified','corrupt-source'],
        ['.npcs.json','[{"id":"a","id":"b"}]','blocked','duplicate-json-key'],
        ['.facts.json','[{"value":9007199254740993}]','blocked','unsafe-json-number'],
        ['.state.json',{context:{inventoryItems:[1]},inventoryItems:[2],messages:[]},'blocked','conflicting-state-mirror'],
        ['.archive.md','preamble\n## SCENE 001\nno tags','blocked','ambiguous-archive-span'],
        ['.state.json',{context:{},messages:[{id:'m',sceneId:'missing'}]},'blocked','dangling-or-ambiguous-reference'],
    ])('reports source policy %s (%s)',(suffix,body,status,code)=> {
        const f=make();f.write(suffix,body);const opts=setup(f);importSnapshot(opts);
        const report=verifyArtifact(opts);expect(report.status).toBe(status);expect(report.findings.some(f=>f.code===code)).toBe(true);
    });
});
