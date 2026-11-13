import { afterEach, expect, it, vi } from 'vitest';
import { runAgencyTick } from '../../npc/agency/agencyEngine';
import * as timeskip from '../../npc/agency/agencyTimeskipRun';
import { backgroundQueue } from '../../infrastructure/backgroundQueue';
import type { TurnState, TurnCallbacks } from '../../turn/turnOrchestrator';
import type { NPCEntry } from '../../../types';

afterEach(() => vi.restoreAllMocks());
it('keeps deterministic timeskip state and its existing narration seam without enqueuing prose inference', () => {
    const simulate = vi.spyOn(timeskip, 'runTimeskip').mockReturnValue({ ticksConsumed: 4, deltas: [], updatedNPCs: [], narration: 'Aldric has advanced his work at the bridge.' });
    const queued = vi.spyOn(backgroundQueue, 'pushModel');
    const state = { settings: { aiTier: 'max', inferenceProfileId: 'constrained-local-v1' }, context: { agencyTick: 3 },
        getUtilityEndpoint: () => ({ endpoint: 'http://local', modelName: 'm', apiKey: '' }), getFreshProvider: () => ({ endpoint: 'http://local', modelName: 'm', apiKey: '' }),
    } as unknown as TurnState;
    const callbacks = { updateContext: vi.fn(), updateNPC: vi.fn(), addMessage: vi.fn() } as unknown as TurnCallbacks;
    runAgencyTick(state, callbacks, [{ id: 'aldric', name: 'Aldric', populated: true, tier: 'named', goalRecords: [] } as NPCEntry], '3 weeks later');
    expect(simulate).toHaveBeenCalledOnce();
    expect(callbacks.updateContext).toHaveBeenCalledWith({ agencyTick: 7 });
    expect(callbacks.addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'system', name: 'timeskip-seam', content: '[Time passes] Aldric has advanced his work at the bridge.' }));
    expect(queued).not.toHaveBeenCalled();
});
