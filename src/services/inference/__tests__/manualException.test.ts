import { expect, it, vi } from 'vitest';
import { gatherDeepSearch } from '../../context-gatherer/deepSearchGather';
import { buildHostFacade } from '../../turn/hostFacade';
import { useAppStore } from '../../../store/useAppStore';
import type { TurnState, TurnCallbacks } from '../../turn/turnOrchestrator';
import type { ModelRequest, ModelResponse } from '../../turn/hostFacade';

vi.mock('../../archive-memory/deepArchiveSearch', () => ({ deepArchiveScan: async (...args: unknown[]) => {
    const call = args[9] as (request: ModelRequest) => Promise<ModelResponse>;
    await call({ prompt: 'Select chapters', trackingLabel: 'deep-search-chapters' });
    return (await call({ prompt: 'Summarize selected evidence', trackingLabel: 'deep-search-summarize' })).content;
} }));

it('unarmed deep search is absent; explicitly armed multi-call work carries manual context', async () => {
    const endpoint = { endpoint: 'http://local', modelName: 'local', apiKey: '' };
    const store = useAppStore.getState();
    const state = { ...store, activeCampaignId: 'manual-test', input: 'Recall the bridge', displayInput: 'Recall the bridge',
        settings: { ...store.settings, aiTier: 'max', inferenceProfileId: 'constrained-local-v1' },
        getUtilityEndpoint: () => endpoint, getFreshProvider: () => endpoint,
    } as unknown as TurnState;
    const dispatch = vi.fn(async () => ({ content: 'Manual evidence' }));
    const facade = buildHostFacade(state, {} as TurnCallbacks, { modelCall: dispatch });
    const deps = { deepSearchThisTurn: false, chapters: [{ sealedAt: 1 }] as TurnState['chapters'] };
    expect(await gatherDeepSearch(state, deps, state.input, undefined, facade)).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
    expect(await gatherDeepSearch(state, { ...deps, deepSearchThisTurn: true }, state.input, undefined, facade)).toBe('Manual evidence');
    expect(dispatch).toHaveBeenCalledTimes(2);
});
