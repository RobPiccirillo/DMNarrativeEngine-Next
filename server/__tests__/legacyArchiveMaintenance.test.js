import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readyLifecycle } from './fixtures/lifecycleCampaign.js';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';
import { maintainLegacyArchive } from '../services/legacyArchiveMaintenance.js';
import { validateLifecycleSources } from '../services/lifecycleValidation.js';
import { assertOrdinaryCampaignWrite, guardOrdinaryCampaignFile } from '../lib/acceptanceWriteGuard.js';
import { managedStateToken, verifyManagedStateSave } from '../services/managedStateSave.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('phase3-maintenance-')) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
} });
async function accepted() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-maintenance-')); roots.push(root);
    const f = await readyLifecycle(path.join(root, 'campaigns'));
    const coordinator = createAcceptanceCoordinator({ directory: f.directory, authorityDirectory: path.join(root, 'authority') });
    const prepared = await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    const committed = await coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command,
        bundle: { groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'] } });
    await coordinator.acknowledge(f.id, committed.logicalKey, committed.outcome.head);
    return { ...f, coordinator, committed };
}
it.each(['remove-assistant', 'remove-user', 'edit-assistant', 'edit-user', 'change-role'])('rejects a raw state PUT attempting %s without recorded archive maintenance', async action => {
    const f = await accepted(), state = JSON.parse(f.read('.state.json')), token = encodeURIComponent(JSON.stringify(managedStateToken(f.directory, f.id)));
    if (action.startsWith('remove-')) state.messages = state.messages.filter(message => message.role !== action.slice(7));
    else if (action.startsWith('edit-')) state.messages.find(message => message.role === action.slice(5)).content = 'Unrecorded edit';
    else state.messages[1].role = 'system';
    expect(() => verifyManagedStateSave(f.directory, f.id, token, state)).toThrow('managed-history-maintenance-required');
});
it('allows a checked chat mirror repair only when it matches the recorded archive maintenance', async () => {
    const f = await accepted();
    maintainLegacyArchive(f.directory, f.id, [{ target: 'archive', after: Buffer.from(f.read('.archive.md').toString().replace('Selected Story.', 'Edited history.')) }]);
    const state = JSON.parse(f.read('.state.json')), token = encodeURIComponent(JSON.stringify(managedStateToken(f.directory, f.id)));
    state.messages[1].content = 'Edited history.';
    expect(() => verifyManagedStateSave(f.directory, f.id, token, state)).not.toThrow();
    f.write('.state.json', state); expect(validateLifecycleSources(f.read).valid).toBe(true);
    state.messages[1].content = 'A second unrecorded edit';
    expect(() => verifyManagedStateSave(f.directory, f.id, encodeURIComponent(JSON.stringify(managedStateToken(f.directory, f.id))), state)).toThrow('managed-history-maintenance-required');
    f.write('.state.json', state); expect(validateLifecycleSources(f.read).errors).toContain('completed-message-prose-conflict');
});
it('records changed accepted scenes and a new head while preserving historical acceptance receipts', async () => {
    const f = await accepted(), original = JSON.parse(f.read('.acceptance.json'));
    maintainLegacyArchive(f.directory, f.id, [{ target: 'archive', after: Buffer.from(f.read('.archive.md').toString().replace('Selected Story.', 'Edited history.')) }]);
    const journal = JSON.parse(f.read('.acceptance.json'));
    expect(journal.commands).toEqual(original.commands);
    expect(journal.head).not.toBe(original.head); expect(journal.generation).toBe(original.generation + 1);
    expect(journal.maintenance[0]).toMatchObject({ status: 'completed', beforeHead: original.head, affectedScenes: ['001'] });
    expect(validateLifecycleSources(f.read)).toMatchObject({ valid: true });
    expect((await f.coordinator.preflight(f.id, f.candidate, 'old-token')).outcome).toEqual(f.committed.outcome);
    expect(() => guardOrdinaryCampaignFile(path.join(f.directory, f.id + '.archive.md'))).toThrow('raw-managed-archive-write-rejected');
    f.write('.archive.md', 'Unrecorded edit');
    expect(validateLifecycleSources(f.read).errors).toContain('archive-head-content-conflict');
});
it('a crash during maintenance preserves original receipts and closes every cooperating writer and unseen acceptance', async () => {
    const f = await accepted(), original = JSON.parse(f.read('.acceptance.json'));
    expect(() => maintainLegacyArchive(f.directory, f.id, [{ target: 'archive', after: Buffer.from('changed') }], point => {
        if (point === 'after-maintenance-write:archive') throw new Error('power-cut');
    })).toThrow('power-cut');
    expect(JSON.parse(f.read('.acceptance.json')).commands).toEqual(original.commands);
    expect(() => assertOrdinaryCampaignWrite(f.directory, f.id)).toThrow('archive-maintenance-recovery-required');
    expect(validateLifecycleSources(f.read)).toMatchObject({ valid: false, errors: expect.arrayContaining(['archive-maintenance-recovery-required']) });
    await expect(f.service.inspect(f.id)).rejects.toThrow('archive-maintenance-recovery-required');
    expect((await f.coordinator.preflight(f.id, f.candidate, 'old-token')).outcome).toEqual(f.committed.outcome);
});
it('clear preserves the reservation high-water and cannot recreate an earlier head', async () => {
    const f = await accepted(), journal = JSON.parse(f.read('.acceptance.json'));
    maintainLegacyArchive(f.directory, f.id, ['archive', 'index', 'chapters', 'timeline'].map(target => ({ target, after: null })));
    const cleared = JSON.parse(f.read('.acceptance.json'));
    expect(cleared.highWater).toBe(journal.highWater); expect(cleared.head).not.toBe(journal.head);
    expect(validateLifecycleSources(f.read)).toMatchObject({ valid: true });
});
