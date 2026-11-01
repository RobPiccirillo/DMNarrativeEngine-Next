import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateInventory, renderInventory, inventorySummary } from '../../../scripts/architecture/inventory.mjs';
import { fixture, registry } from './fixtures';

describe('writer registry integrity', () => {
    it('validates all current writer metadata and references', () => {
        expect(validateInventory(registry)).toEqual([]);
        const summary = inventorySummary(registry);
        expect(summary.producers + summary.sinks).toBe(summary.writers);
        expect(registry.writers.every((w: { targetAuthoritativeOwner: boolean }) => !w.targetAuthoritativeOwner)).toBe(true);
    });

    it('rejects duplicate stable writer IDs', () => {
        const data = fixture(); data.writers.push(structuredClone(data.writers[0]));
        expect(validateInventory(data).join('\n')).toContain('duplicate writerId');
    });

    it.each(['', '../escape.ts', 'C:/outside.ts', 'src/store/no-extension'])('rejects malformed source %s', source => {
        const data = fixture(); data.writers[0].source = source;
        expect(validateInventory(data).join('\n')).toContain('source/symbol');
    });

    it('requires a source symbol and producer/sink role', () => {
        const data = fixture(); data.writers[0].symbols = []; data.writers[0].role = 'forwarder';
        expect(validateInventory(data).join('\n')).toContain('source/symbol');
        expect(validateInventory(data).join('\n')).toContain('producer/sink');
    });

    it.each(['trigger', 'lifecycleStage', 'mutationOrigin', 'modelInvolvement'] as const)('requires %s', field => {
        const data = fixture(); data.writers[0][field] = '';
        expect(validateInventory(data).join('\n')).toContain(field + ' required');
    });

    it.each(['operations', 'storageTargets'] as const)('requires %s', field => {
        const data = fixture(); data.writers[0][field] = [];
        expect(validateInventory(data).join('\n')).toContain(field + ' required');
    });

    it('requires at least one domain', () => {
        const data = fixture(); data.writers[0].domains = [];
        expect(validateInventory(data).join('\n')).toContain('at least one domain');
    });

    it.each(['bad domain', 'future.unregistered'])('rejects invalid or unregistered domain %s', id => {
        const data = fixture(); data.writers[0].domains[0].id = id;
        expect(validateInventory(data).join('\n')).toContain('unknown domain');
    });

    it('rejects invalid authority and legacy status independently', () => {
        const data = fixture(); data.writers[0].domains[0].authority = 'transitional-legacy'; data.writers[0].legacyStatus = 'tracked-state';
        expect(validateInventory(data).join('\n')).toContain('authority/fields');
        expect(validateInventory(data).join('\n')).toContain('legacy status');
    });

    it.each(['', '0', '4BANANA', 'later'])('rejects missing or invalid future phase %s', phase => {
        const data = fixture(); data.writers[0].migration.phase = phase;
        expect(validateInventory(data).join('\n')).toContain('future migration phase');
    });

    it('accepts an explicit preservation rationale instead of a migration phase', () => {
        const data = fixture();
        const writer = { ...data.writers[0], migration: { preservationRationale: 'Preserve operational settings; no campaign ownership.' } };
        expect(validateInventory({ ...data, writers: [writer] })).toEqual([]);
    });

    it('rejects invalid competition references and sink links', () => {
        const data = fixture(); data.writers[0].competitionGroups.push('missing'); data.writers[0].feedsInto.push('missing');
        expect(validateInventory(data).join('\n')).toContain('competition reference');
        expect(validateInventory(data).join('\n')).toContain('persistence sink');
    });

    it('generates a byte-stable projection independent of registry input ordering', () => {
        expect(renderInventory(registry)).toBe(renderInventory({ ...registry, writers: [...registry.writers].reverse() }));
        expect(renderInventory(registry)).toBe(readFileSync('docs/architecture/writer-inventory.md', 'utf8').replace(/\r\n/g, '\n'));
    });
});

describe('static ownership declarations', () => {
    it('rejects two declared target owners for one domain', () => {
        const data = fixture(); data.writers[0].legacyStatus = 'target'; data.writers[0].targetAuthoritativeOwner = true;
        data.writers.push({ ...structuredClone(data.writers[0]), writerId: 'test.second' });
        expect(validateInventory(data).join('\n')).toContain('multiple target authoritative owners');
    });

    it('allows multiple known legacy producers with explicit migration debt', () => {
        const data = fixture(); data.writers.push({ ...structuredClone(data.writers[0]), writerId: 'test.second' });
        expect(validateInventory(data)).toEqual([]);
        data.writers[1].migrationDebt = '';
        expect(validateInventory(data).join('\n')).toContain('legacy producer requires explicit migration debt');
    });

    it('rejects a derived writer claiming target authoritative ownership', () => {
        const data = fixture(); data.writers[0].legacyStatus = 'target'; data.writers[0].targetAuthoritativeOwner = true;
        data.writers[0].domains[0].authority = 'derived-interpretation';
        expect(validateInventory(data).join('\n')).toContain('cannot claim target authoritative ownership');
    });

    it('distinguishes a producer feeding a shared sink from two semantic owners', () => {
        const data = fixture();
        data.writers.push({ ...structuredClone(data.writers[0]), writerId: 'test.sink', role: 'sink' });
        data.writers[0].feedsInto = ['test.sink'];
        expect(validateInventory(data)).toEqual([]);
        expect(inventorySummary(data)).toMatchObject({ producers: 1, sinks: 1 });
    });

    it('does not let a persistence sink claim target ownership', () => {
        const data = fixture(); data.writers[0].role = 'sink'; data.writers[0].legacyStatus = 'target'; data.writers[0].targetAuthoritativeOwner = true;
        expect(validateInventory(data).join('\n')).toContain('cannot claim target authoritative ownership');
    });
});
