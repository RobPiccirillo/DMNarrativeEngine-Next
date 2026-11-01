import { readFileSync } from 'node:fs';

export const registry = JSON.parse(readFileSync('docs/architecture/writer-inventory.json', 'utf8'));
export const freeze = JSON.parse(readFileSync('docs/architecture/extension-freeze.json', 'utf8'));

export function fixture() {
    return {
        schemaVersion: 1,
        domains: [{ id: 'inventory', description: 'Inventory ownership' }],
        writers: [{
            writerId: 'test.inventory', source: 'src/store/example.ts', symbols: ['updateThing'],
            role: 'producer', domains: [{ id: 'inventory', authority: 'tracked-state', fields: ['inventoryItems'] }],
            operations: ['patch'], trigger: 'user action', lifecycleStage: 'store action',
            mutationOrigin: 'user', modelInvolvement: 'none', storageTargets: ['campaign state JSON'],
            legacyStatus: 'transitional-legacy', targetAuthoritativeOwner: false,
            migrationDebt: 'Legacy manual and model writes need domain migration.', competitionGroups: [],
            feedsInto: [], migration: { phase: '5A' }, surfaceCounts: { 'updateThing::store::set': 1 },
        }],
        competitionGroups: [], forwarders: [], nonWriters: [],
    };
}
