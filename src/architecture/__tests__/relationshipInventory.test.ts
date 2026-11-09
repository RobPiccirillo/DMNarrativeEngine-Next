import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkWriterBoundaries, validateInventory, renderInventory } from '../../../scripts/architecture/inventory.mjs';
import { scanSource } from '../../../scripts/architecture/surfaces.mjs';
import { registry } from './fixtures';

const writer = (id: string) => registry.writers.find((entry: { writerId: string }) => entry.writerId === id);

describe('relationship-memory semantic producers and sinks', () => {
    it('records the manual editor as a user semantic producer with explicit provenance', () => {
        const manual = writer('relationships.manual-editor');
        expect(manual).toMatchObject({
            source: 'src/components/character/RelationshipMemoryEditor.tsx', role: 'producer',
            mutationOrigin: 'user', modelInvolvement: 'none', legacyStatus: 'transitional-legacy', targetAuthoritativeOwner: false,
            domains: [{ id: 'relationship-records', authority: 'derived-interpretation', fields: expect.arrayContaining(['source: user']) }],
            operations: expect.arrayContaining(['create', 'edit']), symbols: expect.arrayContaining(['saveDraft', 'persist']), migration: { phase: '6' },
        });
    });

    it('recognizes the real manual editor boundaries and requires their classification', () => {
        const manual = writer('relationships.manual-editor');
        const scan = scanSource(manual.source, readFileSync(manual.source, 'utf8'));
        expect(scan.writers.map(s => s.detail)).toEqual(expect.arrayContaining(['saveRelationshipMemories', 'setRelationshipMemories', 'addRelationshipMemoryFault']));
        expect(checkWriterBoundaries({ writers: [manual] }, [scan])).toEqual([]);
        expect(checkWriterBoundaries({ writers: [] }, [scan]).join('\n')).toContain('unclassified writer');
    });

    it.each(['saveRelationshipMemories(id, rows)', 'setRelationshipMemories(mc, npc)', 'addRelationshipMemoryFault(fault)'])('rejects an equivalent unclassified manual producer using %s', call => {
        const scan = scanSource('src/components/NewManualEditor.tsx', `export function saveDraft() { ${call}; }`);
        expect(checkWriterBoundaries({ writers: [] }, [scan]).join('\n')).toContain('unclassified writer');
    });

    it('keeps user and model producers distinct and names their legacy competition', () => {
        const manual = writer('relationships.manual-editor');
        const model = writer('track.relationship-memory-track');
        expect(model).toMatchObject({ role: 'producer', modelInvolvement: 'model', targetAuthoritativeOwner: false });
        expect(model.mutationOrigin).toContain('model-output');
        expect(registry.competitionGroups.find((group: { groupId: string }) => group.groupId === 'relationship-memory-writers'))
            .toMatchObject({ domain: 'relationship-records', writers: [manual.writerId, model.writerId], migrationPhase: '6' });
        expect(manual.competitionGroups).toContain('relationship-memory-writers');
        expect(model.competitionGroups).toContain('relationship-memory-writers');
    });

    it('links both producers to the dedicated client, HTTP and file sink chain', () => {
        expect(writer('relationships.manual-editor').feedsInto).toEqual(['store.campaign.relationships', 'sink.relationship-save']);
        expect(writer('track.relationship-memory-track').feedsInto).toEqual(['relationships.state', 'sink.relationship-save']);
        expect(writer('sink.relationship-save')).toMatchObject({ role: 'sink', feedsInto: ['sink.relationship-route'] });
        expect(writer('sink.relationship-route')).toMatchObject({ role: 'sink', source: 'server/routes/campaigns.js', feedsInto: ['sink.file-store'] });
        expect(writer('sink.relationship-route').storageTargets).toEqual([
            'data/campaigns/<id>.relationship-memory.npc-to-mc.json', 'data/campaigns/<id>.relationship-memory.npc-to-npc.json',
        ]);
    });

    it('distinguishes store projection/fault sinks from persistence and removes stale save/archive links', () => {
        for (const id of ['relationships.state', 'store.campaign.relationships']) {
            expect(writer(id)).toMatchObject({ role: 'sink', feedsInto: [] });
            expect(writer(id).storageTargets.join(' ')).toContain('Zustand');
        }
        for (const id of ['relationships.manual-editor', 'track.relationship-memory-track', 'relationships.state', 'store.campaign.relationships', 'sink.relationship-save']) {
            expect(writer(id).feedsInto).not.toContain('store.campaign.saves');
            expect(writer(id).feedsInto).not.toContain('sink.archive-repository');
        }
        expect(writer('sink.relationship-save').domains[0].fields).not.toContain('relationshipMemoryFaults');
    });

    it('assigns the real relationship HTTP surface only to its dedicated sink', () => {
        const prefix = "route:PUT:'/api/campaigns/:id/relationship-memory'";
        expect(Object.keys(writer('sink.relationship-route').surfaceCounts)).toEqual([
            prefix + '::mutation-call::writeJson', prefix + '::route::router.put',
        ]);
        expect(Object.keys(writer('sink.campaign-routes').surfaceCounts).some(key => key.startsWith(prefix))).toBe(false);
    });

    it('preserves integrity and deterministic generated output after the corrections', () => {
        expect(validateInventory(registry)).toEqual([]);
        expect(renderInventory(registry)).toBe(renderInventory({ ...registry, writers: [...registry.writers].reverse() }));
        expect(renderInventory(registry)).toBe(readFileSync('docs/architecture/writer-inventory.md', 'utf8').replace(/\r\n/g, '\n'));
    });
});
