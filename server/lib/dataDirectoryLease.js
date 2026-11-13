import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Every cooperating pathname mutation uses the same atomic, short-lived guard.
// A crash-held guard fails closed; it is never stolen based on PID/age.
function withLeaseGuard(root, name, action) {
    const guard = path.join(path.resolve(root), name + '.guard');
    let fd;
    try { fd = fs.openSync(guard, 'wx'); }
    catch (e) { if (e.code === 'EEXIST') throw Object.assign(new Error('lease-busy'), { code: 'lease-busy' }); throw e; }
    try { return action(); }
    finally { fs.closeSync(fd); fs.unlinkSync(guard); }
}

// Exclusive cooperating-process exclusion, never inferred stale from PID/mtime.
export function inspectLease(root, name = '.data-directory.lease') {
    const file = path.join(path.resolve(root), name);
    if (!fs.existsSync(file)) return null;
    const bytes=fs.readFileSync(file),fingerprint=crypto.createHash('sha256').update(bytes).digest('hex');
    try {
        const owner=JSON.parse(bytes.toString('utf8'));
        if(!Number.isSafeInteger(owner.pid) || typeof owner.token!=='string') return {status:'unexplained',fingerprint};
        return {pid:owner.pid,token:owner.token,purpose:/^[a-z-]{1,80}$/.test(owner.purpose)?owner.purpose:'unexplained',fingerprint};
    } catch { return { status: 'unexplained',fingerprint }; }
}
export function acquireLease(root, purpose, name = '.data-directory.lease') {
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(path.resolve(root), name);
    const owner = { pid: process.pid, token: crypto.randomUUID(), purpose };
    let fd;
    withLeaseGuard(root, name, () => {
    try { fd = fs.openSync(file, 'wx'); }
    catch (e) { if (e.code === 'EEXIST') throw Object.assign(new Error('lease-busy'), { code: 'lease-busy' }); throw e; }
    try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    });
    let released = false;
    return { owner, release() {
        if (released) return;
        withLeaseGuard(root, name, () => {
            if (inspectLease(root, name)?.token !== owner.token) throw new Error('lease-owner-changed');
            fs.unlinkSync(file); released = true;
        });
    } };
}
export function recoverLease(root, token, confirmedStopped, name = '.data-directory.lease', fault = () => {}) {
    return withLeaseGuard(root, name, () => {
    const lease=inspectLease(root,name);
    if (!confirmedStopped || !token || !lease || (lease.token!==token && lease.fingerprint!==token)) throw new Error('lease-recovery-refused');
    if(lease.pid>0) {
        let running=true;
        try {process.kill(lease.pid,0);} catch(e) {if(e.code==='ESRCH') running=false;}
        if(running) throw Object.assign(new Error('lease-owner-running'),{code:'lease-owner-running'});
    }
    fault('recovery-inspected');
    const target = path.join(root, name + '.quarantine-' + crypto.randomUUID());
    fs.renameSync(path.join(root, name), target);
    return path.basename(target);
    });
}
