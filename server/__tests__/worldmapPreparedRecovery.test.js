import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createWorldMapRuntime } from '../../public/bundled-mods/worldmap/runtime.js';
import { createLegacyAcceptanceJournal } from '../services/legacyAcceptanceJournal.js';
import { byteVersion } from '../lib/durablePublication.js';
import { departMultiHop, mergeUpserts } from '../../src/services/turn/travelState';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'phase3-movement-crash-'))) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
} });

async function prepared(boundary = () => {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-movement-crash-')); roots.push(root);
    const context = { currentPlaceId: 'a', worldDay: 1, travel: null, travelMode: 'foot' }, initial = structuredClone(context);
    let ledger = ['a', 'b'].map((id, index) => ({ id, name: id, aliases: '', kind: 'place', features: [], description: '',
        coordinates: { x: 500 + index * 30, y: 500 }, connections: [{ toId: index ? 'a' : 'b', band: 'regional' }], knowledge: 'known' }));
    const initialLedger = structuredClone(ledger), tables = { visited: Array.from({ length: 31 }, (_, x) => Array.from({ length: 7 }, (_, y) => ({ x: 500 + x, y: 497 + y, biome: 'plains' }))).flat() };
    const initialTables = structuredClone(tables);
    const ctx = () => ({ data: { campaignId: 'fixture', context: structuredClone(context), location: { ...structuredClone(context), ledger: structuredClone(ledger) }, loreChunks: [] },
        refresh: async () => ctx(), table: { read: async name => structuredClone(tables[name] ?? null), write: async (name, value) => { tables[name] = structuredClone(value); } },
        write: { setLocationLedger: rows => { ledger = structuredClone(rows); }, updateContext: patch => Object.assign(context, structuredClone(patch)) } });
    const runtime = createWorldMapRuntime({ isolated: true, inputs: { now: 1700000000000, journeyId: 'recorded-journey', worldSeed: 'recorded-seed' } });
    await runtime.hydrate(ctx());
    const hops = await runtime.storyRoute(ctx(), { campaignId: 'fixture', fromId: 'a', toId: 'b', worldDay: 1, mode: 'foot', expiresAt: 1700000008000 });
    const movement = departMultiHop({ fromId: 'a', toId: 'b', mode: 'foot', hops, ledger, currentWorldDay: 1, recorded: { now: 1700000000000, newId: () => 'recorded-transit' } });
    if (movement.ledgerUpsert) ledger = mergeUpserts(ledger, movement.ledgerUpsert);
    Object.assign(context, movement.contextPatch);
    await runtime.movementConsequences(ctx()); await runtime.drain();
    const targets = { state: '.state.json', locations: '.locations.json', ...Object.fromEntries(Object.keys(tables).map(name => [name, `.mod-worldmap-${name}.json`])) };
    fs.writeFileSync(path.join(root, 'fixture.state.json'), JSON.stringify({ context: initial }));
    fs.writeFileSync(path.join(root, 'fixture.locations.json'), JSON.stringify(initialLedger));
    for (const [name, value] of Object.entries(initialTables)) fs.writeFileSync(path.join(root, 'fixture' + targets[name]), JSON.stringify(value));
    fs.writeFileSync(path.join(root, 'targets.json'), JSON.stringify(targets));
    const journal = createLegacyAcceptanceJournal({ directory: root, storageId: 'fixture', campaignInstance: 'movement-instance', targets, boundary });
    journal.initialize({ head: 'head' });
    journal.begin({ logicalKey: 'movement', commandId: 'movement', campaignInstance: 'movement-instance', expectedHead: 'head', semantic: { revision: 'revision', hash: 'hash' },
        frozen: { generated: { journeyId: 'recorded-journey', transitId: 'recorded-transit', timestamp: 1700000000000 } } }, () => {});
    const plans = [...Object.entries(tables).map(([name, value]) => ({ id: name, target: name, kind: 'replace', afterBase64: Buffer.from(JSON.stringify(value)).toString('base64') })),
        { id: 'locations', target: 'locations', kind: 'replace', afterBase64: Buffer.from(JSON.stringify(ledger)).toString('base64') },
        { id: 'state', target: 'state', kind: 'json-fields', changes: Object.entries(context).map(([key, value]) => ({ path: ['context', key], after: { present: true, value } })) }];
    const versions = Object.fromEntries(Object.entries(targets).map(([key, suffix]) => [key, byteVersion(fs.existsSync(path.join(root, 'fixture' + suffix)) ? fs.readFileSync(path.join(root, 'fixture' + suffix)) : null)]));
    journal.prepareGroup('movement', plans, versions);
    return { root, targets, tables, context, ledger, plans };
}

function child(root, killAt = '') {
    return new Promise((resolve, reject) => {
        const process = fork(path.resolve('server/__tests__/fixtures/phase3PreparedMovementChild.mjs'), [root, killAt], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        let stderr = '', result;
        process.stderr.on('data', bytes => { stderr += bytes; });
        process.on('message', message => { result = message; if (message.boundary) process.kill('SIGKILL'); });
        process.on('error', reject);
        process.on('exit', code => { if (result && (code === 0 || result.boundary)) resolve(result); else reject(new Error(stderr || `child exited ${code}`)); });
    });
}

const targetNames = ['settings', 'anchors', 'journey', 'position', 'discoveries', 'visited', 'exploration', 'trails', 'encounters', 'locations', 'state'];
for (const boundary of [...targetNames.flatMap(name => [`before-write:${name}`, `after-write:${name}`, `receipt:${name}`]), 'outcome-published']) {
    it(`fresh-process recorded movement survives ${boundary} with zero native/solver/random execution`, async () => {
        const f = await prepared();
        expect(f.plans.map(plan => plan.id)).toEqual(expect.arrayContaining(targetNames));
        expect(await child(f.root, boundary)).toEqual({ boundary });
        expect(await child(f.root)).toEqual({ completed: true });
        for (const [name, value] of Object.entries(f.tables)) expect(JSON.parse(fs.readFileSync(path.join(f.root, 'fixture' + f.targets[name]), 'utf8'))).toEqual(JSON.parse(JSON.stringify(value)));
        expect(JSON.parse(fs.readFileSync(path.join(f.root, 'fixture.state.json'), 'utf8')).context).toEqual(JSON.parse(JSON.stringify(f.context)));
        const bytes = Object.fromEntries(Object.values(f.targets).map(suffix => [suffix, fs.readFileSync(path.join(f.root, 'fixture' + suffix))]));
        expect(await child(f.root)).toEqual({ completed: true });
        for (const [suffix, content] of Object.entries(bytes)) expect(fs.readFileSync(path.join(f.root, 'fixture' + suffix))).toEqual(content);
    });
}

it('can die during recovery and still avoid duplicate trail wear, movement and initialization', async () => {
    const f = await prepared();
    await child(f.root, 'after-write:journey'); await child(f.root, 'after-write:trails'); await child(f.root);
    expect(JSON.parse(fs.readFileSync(path.join(f.root, 'fixture.mod-worldmap-trails.json'), 'utf8'))).toEqual(f.tables.trails);
});
