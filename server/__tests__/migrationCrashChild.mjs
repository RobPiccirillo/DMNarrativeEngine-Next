import { importSnapshot,verifyArtifact } from '../services/campaignMigration.js';
import { backupArtifact } from '../services/campaignMigration/recovery.js';

const [artifactRoot,point]=process.argv.slice(2);
const opts={artifactRoot,artifactKey:'one',run:'default',fault:current=>{
    if(current===point) process.kill(process.pid,'SIGKILL');
}};
if(point.startsWith('backup-')) await backupArtifact({...opts,backupKey:'interrupted'});
else {importSnapshot(opts);if(point.startsWith('verification-')) verifyArtifact(opts);}
