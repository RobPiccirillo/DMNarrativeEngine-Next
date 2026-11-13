import fs from 'node:fs';
import path from 'node:path';
import { afterEach,describe,it,expect } from 'vitest';
import { fixture,tree } from './migrationFixtures.js';
import { captureSnapshot } from '../services/campaignMigration/snapshot.js';
import { importSnapshot,verifyArtifact,withArtifact,makeCommand } from '../services/campaignMigration.js';
import { backupArtifact,restoreCheck,assertImportEligible,validateBackup } from '../services/campaignMigration/recovery.js';
import { routeStagingCommand } from '../repositories/migrationStagingRepository.js';
import { unsupportedAuthorityBundle } from '../lib/legacyBundleGuard.js';
import { openCampaignDb } from '../db/campaignDb.js';
import { snapshotBinding,validateSnapshot } from '../services/campaignMigration/snapshot.js';

const active=[];
afterEach(()=>active.splice(0).forEach(f=>f.cleanup()));
function setup() {
    const f=fixture();active.push(f);
    const portraits=path.join(f.root,'portraits');fs.mkdirSync(portraits); fs.writeFileSync(path.join(portraits,'one.png'),Buffer.from([1,2,3,4]));
    fs.writeFileSync(path.join(portraits,'two.png'),Buffer.from([5,6,7,8]));
    f.write('.npcs.json',[{id:'npc',portrait:'/assets/portraits/one.png'}]);
    f.write('.lore.json',[{id:'lore',content:'Lore must survive offline recovery. ![map](/assets/portraits/two.png?cache=1)'}]);
    captureSnapshot({...f,artifactKey:'one',assetRoots:{portraits}});
    const opts={...f,artifactKey:'one',run:'default',assetRoots:{portraits}};
    importSnapshot(opts);expect(verifyArtifact(opts).status).toBe('verified');
    return opts;
}
describe('Package C: actual isolated recovery',()=> {
    it('restores with original sources/work unavailable, validates closure and recovers operational retries',async()=> {
        const opts=setup(),before=tree(opts.dataRoot);
        const b=await backupArtifact({...opts,backupKey:'copy'});
        expect(validateSnapshot(path.join(b.backup,'snapshot')).objects).toHaveLength(2);
        const p=path.join(opts.artifactRoot,'one');
        fs.renameSync(path.join(p,'snapshot'),path.join(p,'snapshot.unavailable'));
        fs.renameSync(path.join(p,'work'),path.join(p,'work.unavailable'));
        fs.renameSync(opts.dataRoot,opts.dataRoot+'.unavailable');
        const restored=restoreCheck({...opts,backup:b.backup,restoreRoot:path.join(opts.root,'isolated'),drillKey:'proof'});
        expect(restored.proof.checks).toContain('source-expectations');
        expect(assertImportEligible({backup:b.backup,drill:restored.drill}).status).toBe('eligible-snapshot-only');
        const restoredArtifact=path.join(restored.drill,'restored');
        // Inspection/retry uses restored artifact data, never original/live paths.
        fs.renameSync(restoredArtifact,path.join(restored.drill,'recovered'));
        const recovered={artifactRoot:restored.drill,artifactKey:'recovered',run:'default'};
        withArtifact(recovered,ctx=> {
            const cmd=makeCommand(ctx.manifest,'default','migration.run-create',{mode:'create-if-absent'});
            expect(routeStagingCommand({...ctx,command:cmd}).status).toBe('duplicate');
        });
        expect(tree(opts.dataRoot+'.unavailable')).toEqual(before);
    });
    it('refuses partial/tampered backups and never accepts creation without a restore proof',async()=> {
        const opts=setup(), b=await backupArtifact({...opts,backupKey:'copy'});
        expect(()=>assertImportEligible({backup:b.backup,drill:path.join(opts.root,'none')})).toThrow();
        fs.appendFileSync(path.join(b.backup,'snapshot/source/campaigns/test.lore.json'),' ');
        expect(()=>validateBackup(b.backup)).toThrow('backup-member-mismatch');
    });
    it('keeps partial restores unpublished and blocks dirty or altered report/outcome state',async()=> {
        const opts=setup(), b=await backupArtifact({...opts,backupKey:'copy'});
        expect(()=>restoreCheck({...opts,backup:b.backup,restoreRoot:path.join(opts.root,'isolated'),drillKey:'fault',fault:()=>{throw new Error('ENOSPC');}})).toThrow('ENOSPC');
        expect(fs.existsSync(path.join(opts.root,'isolated/fault/restore-proof.json'))).toBe(false);
        withArtifact(opts,ctx=>ctx.db.prepare('DELETE FROM migration_command_outcomes WHERE logical_key LIKE ?').run('%migration.verify%'));
        await expect(backupArtifact({...opts,backupKey:'bad'})).rejects.toThrow('outcome-closure');
    });
    it('refuses live restore roots and future-authority bundle markers while retaining inert mod data',async()=> {
        const opts=setup(), b=await backupArtifact({...opts,backupKey:'copy'});
        expect(()=>restoreCheck({...opts,backup:b.backup,restoreRoot:path.join(opts.dataRoot,'campaigns/drill')})).toThrow('overlapping');
        for (const marker of ['sqlite','authorityControl','domainAuthority','migrationArtifact','storageAuthority']) expect(unsupportedAuthorityBundle({version:1,[marker]:{}})).toBe(true);
        expect(unsupportedAuthorityBundle({version:1,'mod.unknown.table':{opaque:true}})).toBe(false);
    });
    it('rejects proof substitution and staged bytes changed after a successful restore',async()=> {
        const opts=setup(),a=await backupArtifact({...opts,backupKey:'a'}),b=await backupArtifact({...opts,backupKey:'b'});
        const restored=restoreCheck({...opts,backup:a.backup,restoreRoot:path.join(opts.root,'isolated'),drillKey:'one'});
        expect(()=>assertImportEligible({backup:b.backup,drill:restored.drill})).toThrow('ineligible-restore-proof');
        fs.appendFileSync(path.join(restored.drill,'restored/snapshot/source/campaigns/test.json'),' ');
        expect(()=>assertImportEligible({backup:a.backup,drill:restored.drill})).toThrow('restored-member-drift');
    });
    it('uses SQLite backup API with committed data still in WAL',async()=> {
        const opts=setup(),root=path.join(opts.artifactRoot,'one'),snapshot=path.join(root,'snapshot');
        const manifest=validateSnapshot(snapshot),file=path.join(root,'work/campaign.sqlite');
        const db=openCampaignDb({file,binding:snapshotBinding(manifest),mode:'upgrade-disposable-copy'});
        let b;
        try {
            db.pragma('wal_autocheckpoint = 0');
            const command=makeCommand(manifest,'wal-extra','migration.run-create',{mode:'create-if-absent'});
            expect(routeStagingCommand({db,manifest,snapshot,command}).status).toBe('accepted');
            expect(fs.statSync(file+'-wal').size).toBeGreaterThan(0);
            b=await backupArtifact({...opts,backupKey:'wal'});
        } finally {db.close();}
        fs.renameSync(path.join(root,'work'),path.join(root,'work.unavailable'));
        fs.renameSync(snapshot,path.join(root,'snapshot.unavailable'));
        const result=restoreCheck({...opts,backup:b.backup,restoreRoot:path.join(opts.root,'isolated')});
        const restored=path.join(result.drill,'restored');
        const read=openCampaignDb({file:path.join(restored,'work/campaign.sqlite'),binding:snapshotBinding(manifest),mode:'inspect-readonly'});
        try {expect(read.prepare('SELECT status FROM migration_runs WHERE run_id=?').get('wal-extra').status).toBe('incomplete');}
        finally {read.close();}
    });
});
