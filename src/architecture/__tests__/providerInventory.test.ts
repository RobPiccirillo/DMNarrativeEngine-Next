import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { scanProviderSource, scanServerProviderSites, validateProviderSites } from '../../../scripts/architecture/provider-surfaces.mjs';
const path = 'docs/architecture/inference-inventory.json';
const inventory = JSON.parse(fs.readFileSync(path, 'utf8'));
const operations = new Set(inventory.families.map((f: { operation: string }) => f.operation));
describe('single logical/provider inference inventory', () => {
    it('registers every recognized current server/provider surface', () => {
        expect(validateProviderSites(scanServerProviderSites(process.cwd()), inventory.providerSites, operations)).toEqual([]);
        expect(inventory.providerSites).toHaveLength(14);
    });
    it.each([
        'fetch("http://provider/v1/chat/completions", {});',
        'client.post("http://provider/api/chat", {});',
        'model.generate(text, {});',
    ])('rejects a synthetic new recognizable bypass %s', source => {
        const current = [...scanServerProviderSites(process.cwd()), ...scanProviderSource('server/new.js', source)];
        expect(validateProviderSites(current, inventory.providerSites, operations)).not.toEqual([]);
    });
    it('does not confuse string checks or wrapper callbacks with provider executions', () => {
        const sites = scanProviderSource('server/example.js', 'url.endsWith("/chat/completions"); wrapAsync(() => fetch(target));');
        expect(sites.map((s: { callee: string }) => s.callee)).toEqual(['fetch']);
    });
    it('retains prior families and source assignments except the explicit Phase 1L manual-context relocation', () => {
        const original = JSON.parse(execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' }));
        expect(inventory.families.slice(0, original.families.length)).toEqual(original.families);
        const unchanged = (sites: typeof inventory.sites) => sites
            .filter((site: { id: string }) => site.id !== 'src/services/turn/hostFacade.ts#facade.model.call:1')
            .map((site: { id: string }) => site.id === 'src/services/context-gatherer/deepSearchGather.ts#callManualModel:1'
                ? { ...site, id: 'src/services/context-gatherer/deepSearchGather.ts#facade.model.call:1', callee: 'facade.model.call' } : site);
        expect(unchanged(inventory.sites)).toEqual(unchanged(original.sites));
        expect(inventory.sites.find((site: { id: string }) => site.id === 'src/services/turn/hostFacade.ts#facade.model.call:1')?.operations)
            .toEqual(['deep-search-chapters', 'deep-search-scenes', 'deep-search-summarize', 'deep-search-merge']);
    });
    it('keeps dynamic extension and absent caller contexts explicitly unverified', () => {
        expect(inventory.providerBoundaries.some((b: { note: string }) => b.note.includes('UNVERIFIED'))).toBe(true);
        expect(inventory.providerBoundaries.some((b: { note: string }) => b.note.includes('without supplied logical context remain unverified'))).toBe(true);
    });
    it('generates the same projection twice', () => {
        const script = 'scripts/architecture/check-inference.mjs';
        const before = fs.readFileSync('docs/architecture/inference-inventory.md', 'utf8');
        execFileSync(process.execPath, [script, '--write-doc']);
        execFileSync(process.execPath, [script, '--write-doc']);
        expect(fs.readFileSync('docs/architecture/inference-inventory.md', 'utf8')).toBe(before);
    });
});
