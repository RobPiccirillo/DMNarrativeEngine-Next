import { describe, it, expect } from 'vitest';
// @ts-expect-error Architecture script is exercised directly, with no declaration wrapper.
import { checkMigrationSource } from '../../../scripts/architecture/check-migration.mjs';
import { scanSource } from '../../../scripts/architecture/surfaces.mjs';
import { checkWriterBoundaries } from '../../../scripts/architecture/inventory.mjs';

describe('Phase 2 migration capability fence',()=> {
    it('rejects gameplay and bootstrap imports, direct SQLite, live writers and providers',()=> {
        for (const [file, dependency] of [['src/services/turn/turnOrchestrator.ts','../../../server/db/campaignDb.js'],['server/routes/campaigns.js','../db/campaignDb.js'],['server.js','./server/db/campaignDb.js']]) {
            expect(checkMigrationSource(file,`import x from '${dependency}'`).length).toBeGreaterThan(0);
        }
        expect(checkMigrationSource('src/x.ts',"import Db from 'better-sqlite3'")).toHaveLength(1);
        expect(checkMigrationSource('server/services/campaignMigration/bad.js',"import x from '../../lib/embedder.js'; x.loadExtension('sqlite-vec')")).toHaveLength(2);
        expect(checkMigrationSource('server/services/campaignMigration/bad.js',"db.exec('CREATE TABLE invented_truth(x)')").join(' ')).toContain('DDL outside migrations');
        const sql=scanSource('server/services/campaignMigration/bad.js',"export function mutate() { arbitrary.run(1); }");
        expect(checkWriterBoundaries({writers:[]},[sql]).join(' ')).toContain('unclassified writer');
    });
    it('allows artifact-only imports and the existing vector exception',()=> {
        expect(checkMigrationSource('server/services/campaignMigration.js',"import x from '../db/campaignDb.js'")).toEqual([]);
        expect(checkMigrationSource('server/lib/vectorStore.js',"import Db from 'better-sqlite3'")).toEqual([]);
    });
});
