import { describe, expect, it } from 'vitest';
import { checkWriterBoundaries, loadScans } from '../../../scripts/architecture/inventory.mjs';
import { scanSource, isProductionSource } from '../../../scripts/architecture/surfaces.mjs';
import { fixture, registry } from './fixtures';

describe('focused writer boundary gate', () => {
    it('covers all recognized current production mutation surfaces', () => {
        expect(checkWriterBoundaries(registry, loadScans(process.cwd()))).toEqual([]);
    });

    it('accepts an explicitly registered store writer', () => {
        const scan = scanSource('src/store/example.ts', 'export function updateThing() { set({ inventoryItems: [] }); }');
        expect(checkWriterBoundaries(fixture(), [scan])).toEqual([]);
    });

    it.each([
        'export function surprise() { set({ inventoryItems: [] }); }',
        'export function surprise() { useAppStore.setState({ messages: [] }); }',
        'export function surprise() { fs.writeFileSync(path, body); }',
        'export function surprise() { writeJson(path, body); }',
        'router.put("/api/new-state", (req) => writeJson(path, req.body));',
        'export function surprise() { ctx.table.write("rows", []); }',
        'export const newTrack: PostTurnTrack = { run(ctx) { ctx.guardedUpdateContext({}); } };',
    ])('rejects a new unclassified recognizable mutation: %s', code => {
        const errors = checkWriterBoundaries({ writers: [] }, [scanSource('src/newWriter.ts', code)]);
        expect(errors.join('\n')).toContain('src/newWriter.ts:');
        expect(errors.join('\n')).toContain('unclassified writer');
    });

    it('rejects an additional write inside an already covered function', () => {
        const scan = scanSource('src/store/example.ts', 'export function updateThing() { set({}); set({}); }');
        expect(checkWriterBoundaries(fixture(), [scan]).join('\n')).toContain('expected 1, found 2');
    });

    it('rejects stale source/symbol references', () => {
        expect(checkWriterBoundaries(fixture(), [scanSource('src/store/example.ts', 'export function renamed() {}')]).join('\n')).toContain('missing source symbol');
        expect(checkWriterBoundaries(fixture(), []).join('\n')).toContain('Missing inventory source');
    });

    it('surfaces computed/native escape hatches as unverified rather than proving safety', () => {
        const scan = scanSource('src/dynamic.ts', 'function unsafe(ctx, key) { ctx[key]({}); return import(url); }');
        expect(scan.opaque.map((s: { category: string }) => s.category)).toEqual(['computed-call', 'native-module']);
        expect(registry.limitations.join('\n')).toContain('alias/data-flow');
    });

    it('does not interpret comments/strings or unrelated reads as writers', () => {
        const scan = scanSource('src/read.ts', '/* set({}) */ const text = "fs.writeFileSync(x)"; api.archive.getIndex(id);');
        expect(scan.writers).toEqual([]);
    });

    it('checks production module sources and excludes test/fixture declarations', () => {
        expect(isProductionSource('mods/new-mod/index.js')).toBe(true);
        expect(isProductionSource('public/bundled-mods/new/index.js')).toBe(true);
        expect(isProductionSource('src/__tests__/writer.test.ts')).toBe(false);
        expect(isProductionSource('src/types/contracts.d.ts')).toBe(false);
    });
});
