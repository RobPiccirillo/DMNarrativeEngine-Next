import fs from 'node:fs';
import { recoverLease } from '../lib/dataDirectoryLease.js';

const [root,token,inspected,proceed]=process.argv.slice(2);
const wait=()=>{while(!fs.existsSync(proceed)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);};
try {
    const quarantined=recoverLease(root,token,true,'.data-directory.lease',()=> {
        fs.writeFileSync(inspected,'inspected'); wait();
    });
    process.stdout.write(JSON.stringify({quarantined}));
} catch(e) {process.stdout.write(JSON.stringify({code:e.code ?? e.message}));}
