import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onInstall, onActivate } from '../../public/bundled-mods/worldmap/index.js';
import { applyStoryMovement } from '../../src/services/turn/applyStoryMovement';
import { modEventBus } from '../../src/services/mods/events';
import { fixtureContext } from '../../src/services/turn/__tests__/baseAppGate/fixture';

let root;
afterEach(() => {
    modEventBus.reset();
    if (root) {
        if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'phase3-native-boundary-'))) throw new Error('unsafe-test-cleanup');
        fs.rmSync(root, { recursive: true, force: true }); root = undefined;
    }
});

it('real native Story-route handler writes through its standing refreshed context, beyond the turn effect store', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-native-boundary-'));
    modEventBus.reset();
    const campaignId = 'phase3-native-boundary';
    const tables = new Map([['settings', { worldSeed: 'one-route-fixed-seed', climateGradient: 0.5 }]]);
    const handlers = new Map(), writes = [];
    const ledger = [{ id: 'a', name: 'A', aliases: '', kind: 'place', connections: [{ toId: 'b', band: 'regional' }] },
        { id: 'b', name: 'B', aliases: '', kind: 'place', connections: [{ toId: 'a', band: 'regional' }] }];
    const native = {
        data: { campaignId, loreChunks: [], context: {}, location: { currentPlaceId: 'a', currentFeature: null, ledger, travel: null, worldDay: 1 } },
        refresh: async () => native,
        table: { read: async name => tables.get(name) ?? null,
            write: async (name, value) => {
                if (!/^[a-z-]+$/.test(name)) throw new Error('invalid-test-table');
                tables.set(name, structuredClone(value)); writes.push(`native-table:${name}`);
                fs.writeFileSync(path.join(root, `${campaignId}.mod-worldmap-${name}.json`), JSON.stringify(value));
            }, subscribe: () => () => {} },
        write: { setLocationLedger: async value => { native.data.location.ledger = value; writes.push('native-location-ledger');
            fs.writeFileSync(path.join(root, `${campaignId}.locations.json`), JSON.stringify(value)); }, updateContext: vi.fn() },
        mounts: { window: () => ({ open() {}, close() {}, focus() {}, update() {}, remove() {} }), header: () => ({ update() {}, remove() {} }) },
        events: { on: (event, handler) => { handlers.set(event, handler); return modEventBus.on(event, handler); },
            emit: (event, payload) => modEventBus.emitFromMod({ modId: 'worldmap', modName: 'World Map', file: 'worldmap/manifest.json' }, event, payload) },
        subscribe: () => () => {}, log: vi.fn(),
    };
    await onInstall(native); await onActivate(native);
    expect(handlers.has('mod.worldmap.storyRoute')).toBe(true);
    writes.length = 0;
    const context = { ...fixtureContext(), currentPlaceId: 'a', currentFeature: null, travel: null, worldDay: 1 };
    const privateWrites = [];
    const effectStore = { getState: () => ({ activeCampaignId: campaignId, context, locationLedger: structuredClone(native.data.location.ledger),
        addMessage: message => privateWrites.push(message), updateContext: patch => privateWrites.push(patch), setLocationLedger: rows => privateWrites.push(rows) }) };
    await expect(applyStoryMovement('<!-- MOVEMENT {"action":"depart","place":"b"} -->', campaignId, effectStore))
        .rejects.toThrow('unsupported-required-acceptance-writer:worldmap.storyRoute');
    expect(writes).toHaveLength(0);
    expect(privateWrites).toHaveLength(0);
    expect(fs.existsSync(path.join(root, `${campaignId}.acceptance.json`))).toBe(false);

    tables.delete('settings');
    await handlers.get('mod.worldmap.storyRoute')({ requestId: 'proof-request', campaignId, fromId: 'a', worldDay: 1, toId: 'b', mode: 'foot', expiresAt: Date.now() + 60000 });
    expect(writes).toContain('native-table:settings');
    expect(writes).toContain('native-table:anchors');
    expect(native.refresh).not.toBe(effectStore.getState);
    expect(privateWrites).toHaveLength(0);
    expect(fs.existsSync(path.join(root, `${campaignId}.acceptance.json`))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root, `${campaignId}.mod-worldmap-settings.json`), 'utf8')).worldSeed).toBeTruthy();
    if (process.env.PHASE3_CAPTURE_NATIVE_BOUNDARY === '1') {
        fs.writeFileSync('docs/eval/phase-3/native-writer-boundary.json', JSON.stringify({
            suite: 'phase3-native-writer-boundary-characterization-v1',
            writer: 'worldmap.storyRoute -> freshCampaignContext -> solveAndPersist/writeJourney',
            guard: { rejectedBeforeEventDispatch: true, privateWrites: 0, nativeWrites: 0 },
            nativeListener: { writes, intentExisted: false, refreshedStandingContext: true, createdSettings: true },
            disposition: 'Section W required-writer/native-scope architecture stop; not a Phase 3 completion artifact',
        }, null, 2));
    }
});
