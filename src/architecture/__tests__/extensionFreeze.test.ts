import { describe, expect, it } from 'vitest';
import { checkExtensionFreeze, loadScans } from '../../../scripts/architecture/inventory.mjs';
import { scanSource, scanManifest } from '../../../scripts/architecture/surfaces.mjs';
import { freeze } from './fixtures';

describe('extension dependency freeze', () => {
    function approved(scan: ReturnType<typeof scanSource>) {
        return { sites: [{ source: scan.file, rationale: 'Reviewed fixture dependency', surfaceCounts: Object.fromEntries(scan.extensions.map(s => [s.key, s.count])) }] };
    }
    it('grandfathers all explicitly enumerated current dependency sites', () => {
        expect(checkExtensionFreeze(freeze, loadScans(process.cwd()))).toEqual([]);
    });

    it.each([
        'import { buildModContext } from "./services/mods/modContext";',
        'import { leaseRole } from "./services/roles/roleRegistry";',
        'import { register } from "./services/mods/interceptors/interceptorRegistry";',
        'import { publish } from "./services/mods/events/eventBus";',
        'export function newFeature(ctx) { return ctx.model.call("story", {}); }',
        'export function newFeature(ctx) { return ctx.table.write("rows", []); }',
        'export function newFeature(ctx) { return ctx.write.updateContext({}); }',
        'export function newFeature(ctx) { return ctx.interceptors.register({}); }',
        'export function nativeLoad() { return import(url); }',
    ])('rejects new production dependency %s', code => {
        expect(checkExtensionFreeze({ sites: [] }, [scanSource('src/newFeature.ts', code)]).join('\n')).toContain('new frozen extension dependency');
    });

    it('resolves adjacent relative imports before identifying a frozen module', () => {
        const scan = scanSource('src/services/mods/newFeature.ts', 'import { buildModContext } from "./modContext";');
        expect(checkExtensionFreeze({ sites: [] }, [scan]).join('\n')).toContain('./modContext');
    });

    it.each([
        'async function load() { return import("./services/mods/modContext"); }',
        'async function load() { return import(`./services/mods/modContext`); }',
        'async function load() { return import("./services/roles/index.js"); }',
    ])('rejects an unreviewed literal dynamic frozen dependency: %s', code => {
        const scan = scanSource('src/newFeature.ts', code);
        expect(scan.extensions).toEqual([expect.objectContaining({ category: 'dynamic-import' })]);
        expect(scan.opaque).toEqual([]);
        expect(checkExtensionFreeze({ sites: [] }, [scan]).join('\n')).toContain('new frozen extension dependency');
        expect(checkExtensionFreeze(approved(scan), [scan])).toEqual([]);
    });

    it('uses the same adjacent resolution for static and literal dynamic imports', () => {
        const scan = scanSource('src/services/mods/newFeature.ts', 'import { buildModContext } from "./modContext"; async function load() { return import("./modContext"); }');
        expect(scan.extensions.map(s => s.detail)).toEqual(['./modContext', './modContext']);
        expect(checkExtensionFreeze({ sites: [] }, [scan])).toHaveLength(2);
    });

    it.each([
        'import { serviceRoles } from "./services/roles"; serviceRoles.provide(roleId, provider);',
        'import { serviceRoles as registry } from "./services/roles/index"; registry.provide(roleId, provider);',
        'import * as roles from "./services/roles/index.ts"; roles.configureModRoles(input);',
        'export { createServiceRoleRegistry } from "./services/roles";',
    ])('freezes public role capability acquisition: %s', code => {
        const scan = scanSource('src/newFeature.ts', code);
        expect(checkExtensionFreeze({ sites: [] }, [scan]).join('\n')).toContain('new frozen extension dependency');
    });

    it('allows unrelated role census/diagnostics/types and unrelated literal imports', () => {
        const scan = scanSource('src/unrelated.ts', 'import { ROLE_IDS, formatRoleFaultReason, type ServiceRole } from "./services/roles"; import type { ServiceRoleRegistry } from "./services/roles"; export { ROLE_IDS } from "./services/roles/index"; async function load() { return import("./services/lore/loreRetriever"); }');
        expect(scan.extensions).toEqual([]);
        expect(scan.opaque).toEqual([]);
        expect(checkExtensionFreeze({ sites: [] }, [scan])).toEqual([]);
    });

    it('keeps nonliteral dynamic imports explicitly opaque and unverified', () => {
        const scan = scanSource('src/dynamic.ts', 'function load(path) { return import(path); }');
        expect(scan.opaque).toEqual([expect.objectContaining({ category: 'native-module', detail: 'import(nonliteral)' })]);
        expect(scan.extensions).toEqual([expect.objectContaining({ category: 'dynamic-module' })]);
        expect(checkExtensionFreeze(approved(scan), [scan])).toEqual([]);
    });

    it('does not exempt new files under mods', () => {
        const scan = scanSource('mods/new/index.js', 'export function activate(ctx) { ctx.table.write("rows", []); }');
        expect(checkExtensionFreeze(freeze, [scan]).join('\n')).toContain('mods/new/index.js:');
    });

    it('rejects stale allowlist entries and requires a source-specific rationale', () => {
        const allowlist = { sites: [{ source: 'src/removed.ts', rationale: '', surfaceCounts: { 'old::capability::ctx.table.write': 1 } }] };
        const errors = checkExtensionFreeze(allowlist, []);
        expect(errors.join('\n')).toContain('Invalid frozen dependency source');
        expect(errors.join('\n')).toContain('Stale extension allowlist');
    });

    it('requires review for additional calls at an existing grandfathered site', () => {
        const scan = scanSource('src/existing.ts', 'function feature(ctx) { ctx.table.write("a", []); }');
        const allowlist = { sites: [{ source: scan.file, rationale: 'Existing dependency', surfaceCounts: Object.fromEntries(scan.extensions.map((s: { key: string; count: number }) => [s.key, s.count])) }] };
        expect(checkExtensionFreeze(allowlist, [scan])).toEqual([]);
        const added = scanSource(scan.file, 'function feature(ctx) { ctx.table.write("a", []); ctx.table.write("b", []); }');
        expect(checkExtensionFreeze(allowlist, [added]).join('\n')).toContain('new frozen extension dependency');
    });

    it('rejects new executable/table manifest capabilities', () => {
        const scan = scanManifest('mods/new/manifest.json', JSON.stringify({ id: 'new', tables: [{ name: 'truth' }], compute: { capabilities: ['model:story'] } }));
        expect(checkExtensionFreeze({ sites: [] }, [scan]).join('\n')).toContain('declaration');
    });

    it('freezes the runtime contributions field and permits explicit grandfathering', () => {
        const scan = scanManifest('mods/new/manifest.json', '{"contributions":[{"id":"tone","order":1,"text":"Stay terse"}]}');
        expect(scan.extensions).toEqual([expect.objectContaining({ category: 'declaration', detail: 'contributions' })]);
        expect(checkExtensionFreeze({ sites: [] }, [scan]).join('\n')).toContain('declaration::contributions:');
        expect(checkExtensionFreeze(approved({ ...scan, opaque: [] }), [scan])).toEqual([]);
    });

    it('covers every current contributions declaration without obsolete promptContributions entries', () => {
        const scans = loadScans(process.cwd()).filter(scan => scan.file.endsWith('manifest.json') && scan.extensions.some(s => s.detail === 'contributions'));
        expect(scans.length).toBeGreaterThan(0);
        const sites = freeze.sites.filter((site: { source: string }) => scans.some(scan => scan.file === site.source));
        expect(checkExtensionFreeze({ sites }, scans)).toEqual([]);
        expect(freeze.sites.some((site: { surfaceCounts: Record<string, number> }) => Object.keys(site.surfaceCounts).some(key => key.includes('::promptContributions:')))).toBe(false);
    });

    it.each([
        [{ id: 'tone', order: 1, text: 'Changed tone' }],
        [{ id: 'tone', order: 1, text: 'Stay terse' }, { id: 'new', order: 2, text: '{{newMacro}}' }],
    ])('rejects a changed or expanded contribution array %j', contributions => {
        const before = scanManifest('mods/existing/manifest.json', '{"contributions":[{"id":"tone","order":1,"text":"Stay terse"}]}');
        const after = scanManifest(before.file, JSON.stringify({ contributions }));
        expect(checkExtensionFreeze(approved({ ...before, opaque: [] }), [after]).join('\n')).toContain('new frozen extension dependency');
    });

    it('ignores ordinary manifest metadata and the unused promptContributions field', () => {
        const before = scanManifest('mods/existing/manifest.json', '{"contributions":[{"id":"tone","order":1,"text":"Stay terse"}]}');
        const after = scanManifest(before.file, '{"name":"Renamed","version":"9","description":"Updated","promptContributions":[{"text":"ignored by runtime"}],"contributions":[{"id":"tone","order":1,"text":"Stay terse"}]}');
        expect(checkExtensionFreeze(approved({ ...before, opaque: [] }), [after])).toEqual([]);
        expect(scanManifest('mods/unrelated/manifest.json', '{"name":"Metadata only","description":"No capability"}').extensions).toEqual([]);
    });

    it('detects changes in existing manifest capabilities and generated worker code', () => {
        const before = scanManifest('mods/existing/manifest.json', '{"native":{"js":"index.js"}}');
        const allowlist = { sites: [{ source: before.file, rationale: 'Existing native implementation', surfaceCounts: Object.fromEntries(before.extensions.map((s: { key: string; count: number }) => [s.key, s.count])) }] };
        const after = scanManifest(before.file, '{"native":{"js":"index.js","generateInterceptor":"newHook"}}');
        expect(checkExtensionFreeze(allowlist, [after]).join('\n')).toContain('new frozen extension dependency');
        const worker = scanSource('src/services/mods/sandbox/workerPrelude.ts', 'const worker = `ctx.write.newCapability()`;');
        expect(worker.extensions.some((s: { category: string }) => s.category === 'embedded-worker')).toBe(true);
        expect(checkExtensionFreeze({ sites: [] }, [worker]).join('\n')).toContain('embedded-worker');
    });

    it('avoids false positives for unrelated imports, properties, comments and text', () => {
        const scan = scanSource('src/unrelated.ts', 'import { read } from "./services/lore/loreRetriever"; /* ctx.table.write() */ const t = "ctx.model.call()"; reader.read();');
        expect(scan.extensions).toEqual([]);
        expect(checkExtensionFreeze({ sites: [] }, [scan])).toEqual([]);
    });
});
