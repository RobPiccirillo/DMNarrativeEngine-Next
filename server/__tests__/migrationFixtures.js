import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmn-phase2-'));
    const dataRoot = path.join(root, 'data');
    const artifactRoot = path.join(root, 'artifacts');
    fs.mkdirSync(path.join(dataRoot, 'campaigns'), { recursive: true });
    const write = (suffix, value) => fs.writeFileSync(path.join(dataRoot, 'campaigns', `test${suffix}`),
        typeof value === 'string' ? value : JSON.stringify(value));
    write('.json', { id: 'test', name: 'Synthetic secret token story' });
    write('.state.json', { context: { arcs: [], inventory: [] }, messages: [], pinnedExcerpts: [] });
    return { root, dataRoot, artifactRoot, campaign: 'test', write,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function tree(root) {
    const result = {};
    function visit(dir, relative = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const name = relative + entry.name;
            if (entry.isDirectory()) visit(path.join(dir, entry.name), name + '/');
            else result[name] = fs.readFileSync(path.join(dir, entry.name)).toString('hex');
        }
    }
    visit(root);
    return result;
}
