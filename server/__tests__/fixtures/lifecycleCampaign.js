import fs from 'node:fs';
import path from 'node:path';
import { createDraftLifecycleService } from '../../services/draftLifecycleService.js';
import { acceptanceCandidate } from '@narrative/engine/contracts/draftLifecycle';

export async function readyLifecycle(directory, id = 'source', text = 'Selected Story.') {
    fs.mkdirSync(directory, { recursive: true });
    const write = (suffix, value) => fs.writeFileSync(path.join(directory, id + suffix), typeof value === 'string' ? value : JSON.stringify(value));
    write('.json', { id, name: 'Synthetic portable campaign' });
    write('.state.json', { context: {}, condenser: { condensedUpToIndex: -1 }, pinnedExcerpts: [], messages: [
        { id: 'user', role: 'user', content: 'Wait.', timestamp: 1 }, { id: 'assistant', role: 'assistant', content: text, timestamp: 2 },
    ] });
    const service = createDraftLifecycleService({ directory, authorityDirectory: path.join(directory, '..', 'authority') });
    const begun = await service.transition(id, { action: 'begin', kind: 'initial', profileId: 'current', sourceMessageId: 'user', assistantMessageId: 'assistant', archivedUserText: 'Wait.' });
    const finished = await service.transition(id, { action: 'finish', setId: begun.document.activeSetId, attemptId: begun.attempt.id, status: 'completed', text, expectedVersion: begun.version });
    return { directory, id, service, view: finished, candidate: acceptanceCandidate(finished.document.sets[0], text), write,
        read: suffix => { const file = path.join(directory, id + suffix); return fs.existsSync(file) ? fs.readFileSync(file) : null; } };
}
