import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach,it,expect } from 'vitest';
import { fixture } from './migrationFixtures.js';
import { acquireLease,inspectLease,recoverLease } from '../lib/dataDirectoryLease.js';

const active=[];
afterEach(()=>active.splice(0).forEach(f=>f.cleanup()));
function stale() {
    const f=fixture();active.push(f);
    fs.writeFileSync(path.join(f.dataRoot,'.data-directory.lease'),JSON.stringify({pid:999999,token:'stale',purpose:'test'}));
    return f;
}
function recovery(f,id) {
    const inspected=path.join(f.root,id+'.inspected'),proceed=path.join(f.root,id+'.proceed');
    const child=spawn(process.execPath,['server/__tests__/migrationLeaseChild.mjs',f.dataRoot,'stale',inspected,proceed],{stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
    const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));});
    return {child,done,inspected,proceed};
}
async function reached(file) {
    for(let i=0;i<300;i++) {if(fs.existsSync(file)) return;await delay(10);}
    throw new Error('child did not reach synchronization point');
}
it('serializes recovery with acquisition and refuses an older recovery after replacement',async()=> {
    const f=stale(),a=recovery(f,'a');
    try {
        await reached(a.inspected); // A has inspected stale while holding the serialization guard.
        const b=recovery(f,'b');
        expect((await b.done).code).toBe('lease-busy');
        expect(()=>acquireLease(f.dataRoot,'new-owner')).toThrow('lease-busy');
        fs.writeFileSync(a.proceed,'continue');
        const result=await a.done;
        expect(JSON.parse(fs.readFileSync(path.join(f.dataRoot,result.quarantined),'utf8')).token).toBe('stale');
        const owner=acquireLease(f.dataRoot,'new-owner');
        try {
            expect(()=>recoverLease(f.dataRoot,'stale',true)).toThrow('lease-recovery-refused');
            expect(inspectLease(f.dataRoot).token).toBe(owner.owner.token);
            expect(()=>acquireLease(f.dataRoot,'third-owner')).toThrow('lease-busy');
            expect(fs.readdirSync(f.dataRoot).filter(n=>n.includes('.quarantine-'))).toHaveLength(1);
        } finally {owner.release();}
    } finally {if(!fs.existsSync(a.proceed)) fs.writeFileSync(a.proceed,'continue');await a.done;}
},15000);
it('two synchronized recoveries quarantine only one exact instance',async()=> {
    const f=stale(),a=recovery(f,'a');
    try {
        await reached(a.inspected);
        const b=recovery(f,'b');
        expect((await b.done).code).toBe('lease-busy');
        expect(inspectLease(f.dataRoot).token).toBe('stale');
    } finally {fs.writeFileSync(a.proceed,'continue');await a.done;}
    expect(inspectLease(f.dataRoot)).toBeNull();
    const owner=acquireLease(f.dataRoot,'normal-owner');owner.release();
    expect(inspectLease(f.dataRoot)).toBeNull();
},15000);
