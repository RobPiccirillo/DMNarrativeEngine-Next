import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createModsRouter } from '../routes/mods.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'phase3-source-binding-'))) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
} });
function fixture(bundledModsDir = path.resolve('public/bundled-mods')) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-source-binding-')); roots.push(root);
    const app = express(); app.use('/api/mods', createModsRouter({ modsDir: root, bundledModsDir, appVersion: '2.0.0' }));
    return { app, root };
}
it('attests every exact application-controlled source file rather than a provenance string', async () => {
    const { app } = fixture();
    const proof = JSON.parse(fs.readFileSync('src/services/turn/acceptance/worldmapSource.json', 'utf8'));
    const response = await request(app).get('/api/mods/application-worldmap-source');
    expect(response.status, response.text).toBe(200);
    expect(response.body).toEqual(proof);
});
it('rejects an installed folder shadowing the bundled world-map asset route', async () => {
    const { app, root } = fixture();
    fs.mkdirSync(path.join(root, 'worldmap'));
    fs.writeFileSync(path.join(root, 'worldmap', 'index.js'), 'export const provenance = "bundled";');
    await request(app).get('/api/mods/application-worldmap-source').expect(409);
});
it('rejects a copied bundled module outside the exact application-controlled source', async () => {
    const { root } = fixture();
    const copied = path.join(root, 'bundled'); fs.mkdirSync(copied);
    fs.cpSync(path.resolve('public/bundled-mods/worldmap'), path.join(copied, 'worldmap'), { recursive: true });
    const app = express(); app.use('/api/mods', createModsRouter({ modsDir: root, bundledModsDir: copied, appVersion: '2.0.0' }));
    await request(app).get('/api/mods/application-worldmap-source').expect(409);
});
