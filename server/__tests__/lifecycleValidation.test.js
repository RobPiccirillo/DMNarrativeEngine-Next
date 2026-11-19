import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readyLifecycle } from './fixtures/lifecycleCampaign.js';
import { validateLifecycleSources } from '../services/lifecycleValidation.js';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('phase3-validation-')) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
} });
async function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-validation-')); roots.push(root);
    const f = await readyLifecycle(path.join(root, 'campaigns'));
    const coordinator = createAcceptanceCoordinator({ directory: f.directory, authorityDirectory: path.join(root, 'authority') });
    const prepared = await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    const committed = await coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command,
        bundle: { groups: ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'] } });
    await coordinator.acknowledge(f.id, committed.logicalKey, committed.outcome.head);
    return f;
}
it.each(['null-command', 'null-step', 'unknown-target', 'wrong-command', 'wrong-origin', 'wrong-generation', 'bad-maintenance', 'bad-patches', 'bad-alias', 'missing-messages', 'changed-completed-text', 'missing-stamp', 'changed-user', 'duplicate-assistant', 'missing-assistant'])('returns a closed independent result for %s', async kind => {
    const f = await fixture(), journal = JSON.parse(f.read('.acceptance.json'));
    if (kind === 'null-command') journal.commands.push(null);
    if (kind === 'null-step') journal.commands[0].steps.push(null);
    if (kind === 'unknown-target') journal.commands[0].steps[0].target = 'outside';
    if (kind === 'wrong-command') journal.commands[0].frozen.command.commandId = 'forged';
    if (kind === 'wrong-origin') journal.commands[0].frozen.command.provenance.origin = 'model';
    if (kind === 'wrong-generation') journal.generation++;
    if (kind === 'bad-maintenance') journal.maintenance = {};
    if (kind === 'bad-patches') journal.commands[0].steps.find(step => step.kind === 'json-fields').patches = [null];
    if (kind === 'bad-alias') { const drafts = JSON.parse(f.read('.drafts.json')); drafts.storageGuard.assetAliases = { '/assets/portraits/a.png': 'javascript:alert(1)' }; f.write('.drafts.json', drafts); }
    if (['missing-messages', 'changed-completed-text', 'missing-stamp', 'changed-user', 'duplicate-assistant', 'missing-assistant'].includes(kind)) {
        const state = JSON.parse(f.read('.state.json'));
        if (kind === 'missing-messages') state.messages = [];
        if (kind === 'changed-completed-text') state.messages[1].content = 'Unrecorded edited Story.';
        if (kind === 'missing-stamp') delete state.messages[1].acceptanceBinding;
        if (kind === 'changed-user') state.messages[0].content = 'Different source';
        if (kind === 'duplicate-assistant') state.messages.push(state.messages[1]);
        if (kind === 'missing-assistant') state.messages.splice(1, 1);
        f.write('.state.json', state);
    }
    f.write('.acceptance.json', journal);
    expect(() => validateLifecycleSources(f.read)).not.toThrow(); expect(validateLifecycleSources(f.read)).toMatchObject({ managed: true, valid: false, unresolved: expect.any(Boolean) });
});
it('rejects duplicate JSON keys and invalid UTF-8 without rewriting the original evidence', async () => {
    const f = await fixture();
    const file = path.join(f.directory, f.id + '.acceptance.json');
    for (const bytes of [Buffer.from('{"schemaVersion":1,"schemaVersion":1}'), Buffer.from([0xff])]) {
        fs.writeFileSync(file, bytes); expect(validateLifecycleSources(f.read).valid).toBe(false); expect(fs.readFileSync(file)).toEqual(bytes);
    }
});
