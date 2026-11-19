import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLegacyDraftRepository, serverStoryHash } from '../services/legacyDraftRepository.js';
import { upgradeLegacyPending } from '../../packages/engine/src/contracts/draftCompatibility';
import { sealRevision, selectRevision } from '../../packages/engine/src/contracts/draftLifecycle';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'phase3-drafts-'))) throw new Error('unsafe-test-cleanup');
        fs.rmSync(root, { recursive: true, force: true });
    }
});
async function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-drafts-')); roots.push(directory);
    const repository = createLegacyDraftRepository({ directory, storageId: 'fixture', campaignInstance: 'instance' });
    const upgrade = await upgradeLegacyPending({ campaignInstance: 'instance', expectedHead: 'head', hash: serverStoryHash,
        messages: [{ id: 'user', role: 'user', content: 'Wait' }, { id: 'story', role: 'assistant', content: 'Story', pendingCommit: true,
            swipeActiveIndex: 0, swipeSet: [{ id: 'v', text: 'Story' }, { id: 'v2', text: 'Sibling' }] }] });
    if (upgrade.status !== 'ready') throw new Error(upgrade.reason);
    return { directory, repository, document: { schemaVersion: 1, campaignInstance: 'instance', sets: [upgrade.set], activeSetId: upgrade.set.id, conflicts: [] } };
}

it('roundtrips every revision and persisted selection; rejects stale saves', async () => {
    const { directory, repository, document } = await fixture();
    const initial = await repository.save('absent', document);
    const set = document.sets[0];
    const selected = { ...document, sets: [selectRevision(set, set.revisions[1].id, 'selected-version')] };
    const saved = await repository.save(initial.version, selected);
    await expect(repository.save(initial.version, document)).rejects.toThrow('draft-version-conflict');
    const fresh = createLegacyDraftRepository({ directory, storageId: 'fixture', campaignInstance: 'instance' });
    const reloaded = await fresh.load();
    expect(reloaded.version).toBe(saved.version);
    expect(reloaded.document.sets[0]).toEqual(selected.sets[0]);
});

it('rejects both mutation and removal of finalized revision records', async () => {
    const { repository, document } = await fixture();
    const saved = await repository.save('absent', document);
    const changed = structuredClone(document);
    changed.sets[0] = { ...changed.sets[0], selectionVersion: 'changed-version', revisions: [{ ...changed.sets[0].revisions[0], text: 'Changed', hash: await serverStoryHash('Changed') }, changed.sets[0].revisions[1]] };
    await expect(repository.save(saved.version, changed)).rejects.toThrow('immutable-revision-conflict');
    const removed = structuredClone(document);
    removed.sets[0] = { ...removed.sets[0], selectionVersion: 'removed-version', revisions: [removed.sets[0].revisions[0]], revisionOrder: [removed.sets[0].revisions[0].id] };
    await expect(repository.save(saved.version, removed)).rejects.toThrow('immutable-revision-conflict');
    expect((await repository.load()).document).toEqual(document);
});

it('does not let a new save retarget an existing turn source or reuse a selection token', async () => {
    const { repository, document } = await fixture();
    const saved = await repository.save('absent', document), set = document.sets[0];
    await expect(repository.save(saved.version, { ...document, sets: [{ ...set, archivedUserText: 'Different action', selectionVersion: 'changed' }] })).rejects.toThrow('immutable-draft-source-conflict');
    await expect(repository.save(saved.version, { ...document, sets: [{ ...set, selectedRevisionId: set.revisions[1].id, displayedRevisionId: set.revisions[1].id }] })).rejects.toThrow('draft-selection-version-required');
});

it('appends an edited child while preserving all original sibling bytes', async () => {
    const { repository, document } = await fixture();
    const saved = await repository.save('absent', document), set = document.sets[0];
    const child = { ...set.revisions[0], id: set.revisions[1].id.replace('v2', 'edit'), reason: 'edit' as const,
        provenance: 'user-edit' as const, parentRevisionId: set.revisions[0].id, text: 'Edited', hash: await serverStoryHash('Edited') };
    const edited = { ...document, sets: [sealRevision(set, child, 'edited-version')] };
    await repository.save(saved.version, edited);
    expect((await repository.load()).document.sets[0].revisions).toEqual([...set.revisions, child]);
});

it('rejects corrupt content and hash mismatch without replacing source evidence', async () => {
    const { repository, document, directory } = await fixture();
    await repository.save('absent', document);
    const file = path.join(directory, 'fixture.drafts.json');
    const corrupt = structuredClone(document); corrupt.sets[0] = { ...corrupt.sets[0], revisions: [{ ...corrupt.sets[0].revisions[0], text: 'tampered' }, corrupt.sets[0].revisions[1]] };
    fs.writeFileSync(file, JSON.stringify(corrupt)); const bytes = fs.readFileSync(file);
    await expect(repository.load()).rejects.toThrow('revision-hash-conflict'); expect(fs.readFileSync(file)).toEqual(bytes);
    fs.writeFileSync(file, '{'); await expect(repository.load()).rejects.toThrow('corrupt-lifecycle-file');
});

it('a publication failure leaves the original version intact and retryable', async () => {
    const { repository, directory, document } = await fixture();
    const saved = await repository.save('absent', document);
    const failing = createLegacyDraftRepository({ directory, storageId: 'fixture', campaignInstance: 'instance',
        boundary: (point: string) => { if (point === 'temporary-synced') throw new Error('injected-fsync-window-failure'); } });
    await expect(failing.save(saved.version, { ...document, sets: [selectRevision(document.sets[0], document.sets[0].revisions[1].id, 'next')] })).rejects.toThrow('injected-fsync-window-failure');
    expect((await repository.load()).version).toBe(saved.version);
    expect(fs.readdirSync(directory)).toEqual(['fixture.drafts.json']);
});
