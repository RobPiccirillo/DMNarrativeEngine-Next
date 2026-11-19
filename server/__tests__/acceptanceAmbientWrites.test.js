import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { readyLifecycle } from './fixtures/lifecycleCampaign.js';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';
import { acceptanceWriteGuard, guardOrdinaryCampaignFile } from '../lib/acceptanceWriteGuard.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('phase3-ambient-')) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
} });
async function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-ambient-')); roots.push(root);
    const f = await readyLifecycle(path.join(root, 'campaigns'));
    const coordinator = createAcceptanceCoordinator({ directory: f.directory, authorityDirectory: path.join(root, 'authority') });
    const accept = async () => {
        const prepared = await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
        const committed = await coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command,
            bundle: { groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'] } });
        await coordinator.acknowledge(f.id, committed.logicalKey, committed.outcome.head);
    };
    const app = express(); app.use(express.json()); app.use('/api/campaigns/:id', acceptanceWriteGuard(f.directory));
    return { ...f, accept, app, token: encodeURIComponent(JSON.stringify(f.view.saveToken)) };
}
it.each(['npcs', 'locations', 'relationship-memory', 'mod-tables/mod.worldmap.settings', 'mod-tables/mod.worldmap.roads', 'mod-data/worldmap'])('rejects a delayed %s request after acceptance acknowledgement', async resource => {
    const f = await fixture(), writes = [];
    f.app.put(`/api/campaigns/:id/${resource}`, (_req, res) => { writes.push(1); res.json({ ok: true }); });
    await f.accept();
    const response = await request(f.app).put(`/api/campaigns/${f.id}/${resource}`).set('X-Phase3-State-Token', f.token).send([]);
    expect(response.status).toBe(409); expect(response.body.code).toBe('managed-write-version-conflict'); expect(writes).toEqual([]);
});
it('retains unrelated legacy endpoints and read-only recall without requiring an acceptance write token', async () => {
    const f = await fixture();
    f.app.put('/api/campaigns/:id/overworld', (_req, res) => res.json({ ok: true }));
    f.app.post('/api/campaigns/:id/archive/semantic-candidates', (_req, res) => res.json({ candidates: [] }));
    expect((await request(f.app).put(`/api/campaigns/${f.id}/overworld`).send({})).status).toBe(200);
    expect((await request(f.app).post(`/api/campaigns/${f.id}/archive/semantic-candidates`).send({})).status).toBe(200);
    expect((await request(f.app).put(`/api/campaigns/${f.id}/npcs`).send([])).status).toBe(409);
});
it('rechecks the captured request scope at a cooperating sink after an asynchronous yield', async () => {
    const f = await fixture(); let release, entered;
    const blocked = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
    f.app.put('/api/campaigns/:id/npcs', async (_req, res, next) => {
        entered(); await blocked;
        try {
            const file = path.join(f.directory, f.id + '.npcs.json'); guardOrdinaryCampaignFile(file);
            fs.writeFileSync(file, '[]'); res.json({ ok: true });
        } catch (error) { next(error); }
    });
    f.app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ code: error.message }));
    const pending = request(f.app).put(`/api/campaigns/${f.id}/npcs`).set('X-Phase3-State-Token', f.token).send([]).then(value => value);
    await reached; await f.accept(); release();
    const response = await pending;
    expect(response.status).toBe(409); expect(response.body.code).toBe('managed-write-version-conflict'); expect(f.read('.npcs.json')).toBeNull();
});
