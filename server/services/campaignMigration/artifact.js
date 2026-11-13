import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const FORMAT = 1;
export const TOOL = 'phase2.v1';
export function fail(code) { const e = new Error(code); e.code = code; throw e; }
export function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const digest = body => hash(canonical(body));
export const key = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : fail('invalid-key');
export function inside(root, relative) {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.split('/').some(p => !p || p === '.' || p === '..')) fail('unsafe-path');
    const base = path.resolve(root), target = path.resolve(base, relative);
    if (!target.startsWith(base + path.sep)) fail('unsafe-path');
    let current = base;
    for (const part of relative.split('/')) {
        current = path.join(current, part);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('symlink-refused');
    }
    if (fs.existsSync(base) && fs.realpathSync(base) !== base) fail('symlink-refused');
    return target;
}
export function separate(a, b) {
    const x = path.resolve(a).toLowerCase(), y = path.resolve(b).toLowerCase();
    if (x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep)) fail('overlapping-roots');
}
// Resolve existing ancestors too, including junctions/symlink aliases of live roots.
export function canonicalPath(value) {
    let current=path.resolve(value);
    const missing=[];
    while(true) {
        try { return path.join(fs.realpathSync(current),...missing.reverse()); }
        catch(e) {
            if(e.code!=='ENOENT') throw e;
            const parent=path.dirname(current);
            if(parent===current) fail('unresolvable-root');
            missing.push(path.basename(current));current=parent;
        }
    }
}
export function writeDurable(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function seal(file, body) { writeDurable(file, canonical({ ...body, digest: digest(body) })); }
export function readSealed(file) {
    let value;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('invalid-sealed-document'); }
    const { digest: expected, ...body } = value;
    if (body.format !== FORMAT || body.tool !== TOOL) fail('unsupported-format');
    if (expected !== digest(body)) fail('digest-mismatch');
    return value;
}
export function files(root, prefix = '') {
    return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(e => {
        const relative = prefix + e.name;
        const target = inside(root, e.name);
        if (e.isSymbolicLink()) fail('symlink-refused');
        return e.isDirectory() ? files(target).map(p => relative + '/' + p) : [relative];
    });
}
