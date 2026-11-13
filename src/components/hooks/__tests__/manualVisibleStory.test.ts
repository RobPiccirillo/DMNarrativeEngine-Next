import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAppStore } from '../../../store/useAppStore';
import { useRetryStoryAI } from '../useRetryStoryAI';
import { useSwipeVariants } from '../useSwipeVariants';
import { useSceneContinue } from '../useSceneContinue';
import { api } from '../../../services/llm/apiClient';
import { fixtureContext } from '../../../services/turn/__tests__/baseAppGate/fixture';
import type { AppSettings, ChatMessage } from '../../../types';

const transport = vi.hoisted(() => ({ output: '', calls: vi.fn(), refresh: vi.fn(), save: vi.fn() }));
vi.mock('../../../services/chatEngine', () => ({ sendMessage: (_provider: unknown, _messages: unknown,
    chunk: (text: string) => void, done: (text: string) => void) => {
    transport.calls(); chunk(transport.output); done(transport.output);
} }));
vi.mock('../../../services/turn/pendingCommit', () => ({
    getCachedSwipePayload: () => [{ role: 'user', content: 'I wait.' }],
    refreshPendingSnapshotMessage: (...args: unknown[]) => transport.refresh(...args),
    getCachedSwipeInterception: () => undefined,
}));
vi.mock('../../../store/campaignStore', () => ({ saveCampaignState: async () => { transport.save(); } }));

const original = useAppStore.getState();
const variant = { id: 'v1', text: 'The original Story.', sceneStakes: 'calm' as const, tagPresent: false };
function seed(retry: boolean, profile: 'current' | 'constrained-local-v1') {
    const msg: ChatMessage = { id: 'story', role: 'assistant', content: retry ? 'Previous retryable Story.' : variant.text, timestamp: 1,
        ...(retry ? { retryable: true } : { swipeSet: [{ ...variant }], swipeActiveIndex: 0, pendingCommit: true }),
    };
    useAppStore.setState({ ...useAppStore.getInitialState(), context: fixtureContext(), messages: [msg], activeCampaignId: null,
        settings: { presets: [{ id: 'p', storyAIProviderId: 'provider', sampling: { temperature: 0.7 } }], activePresetId: 'p',
            providers: [{ id: 'provider', endpoint: 'http://test', modelName: 'test' }], inferenceProfileId: profile,
        } as unknown as AppSettings,
    });
    return msg;
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(api.archive, 'append'); });
afterEach(() => { cleanup(); useAppStore.setState(original, true); vi.restoreAllMocks(); });

for (const profile of ['current', 'constrained-local-v1'] as const) {
    it.each(['[[SCENE_STAKES: calm]]', ' \n [[SCENE_STAKES: calm]] \n '])(`Retry rejects stripped-empty output and restores retryable Story under ${profile}: %j`, async output => {
        const prior = seed(true, profile); transport.output = output;
        const { result } = renderHook(() => useRetryStoryAI());
        await act(async () => { await result.current.retryStoryAI('story'); });
        expect(useAppStore.getState().messages[0]).toMatchObject({ content: prior.content, retryable: true });
        expect(useAppStore.getState().messages[0].pendingCommit).toBeUndefined();
        expect(useAppStore.getState().messages[0].swipeSet).toBeUndefined();
        expect(transport.refresh).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
        expect(api.archive.append).not.toHaveBeenCalled(); expect(transport.calls).toHaveBeenCalledTimes(1);
    });

    it(`Swipe rejects metadata-only output and retains existing variant under ${profile}`, async () => {
        seed(false, profile); transport.output = '[[SCENE_STAKES: calm]]';
        const { result } = renderHook(() => useSwipeVariants('story'));
        await act(async () => { await result.current.generateSwipe(); });
        expect(useAppStore.getState().messages[0]).toMatchObject({ content: variant.text, swipeSet: [variant], swipeActiveIndex: 0 });
        expect(api.archive.append).not.toHaveBeenCalled(); expect(transport.calls).toHaveBeenCalledTimes(1);
    });

    it(`Continue rejects metadata-only output and restores prior prose under ${profile}`, async () => {
        seed(false, profile); transport.output = '[[SCENE_STAKES: calm]]';
        const { result } = renderHook(() => useSceneContinue('story'));
        await act(async () => { await result.current.runSceneContinue(); });
        expect(useAppStore.getState().messages[0]).toMatchObject({ content: variant.text, swipeSet: [variant] });
        expect(transport.refresh).not.toHaveBeenCalled(); expect(api.archive.append).not.toHaveBeenCalled();
        expect(transport.calls).toHaveBeenCalledTimes(1);
    });

    it(`Continue rejects a stripped scene header plus metadata under ${profile}`, async () => {
        seed(false, profile); transport.output = 'Scene #123 | [[SCENE_STAKES: calm]]';
        const { result } = renderHook(() => useSceneContinue('story'));
        await act(async () => { await result.current.runSceneContinue(); });
        expect(useAppStore.getState().messages[0].content).toBe(variant.text);
        expect(transport.refresh).not.toHaveBeenCalled(); expect(api.archive.append).not.toHaveBeenCalled();
    });

    it(`Retry accepts visible prose with stripped metadata under ${profile}`, async () => {
        seed(true, profile); transport.output = 'Mira nods. [[SCENE_STAKES: tense]]';
        const { result } = renderHook(() => useRetryStoryAI());
        await act(async () => { await result.current.retryStoryAI('story'); });
        expect(useAppStore.getState().messages[0]).toMatchObject({ content: 'Mira nods.', pendingCommit: true,
            swipeSet: [expect.objectContaining({ text: 'Mira nods.', sceneStakes: 'tense' })] });
        expect(useAppStore.getState().messages[0].retryable).toBeUndefined();
    });

    it(`Continue accepts visible prose with stripped metadata under ${profile}`, async () => {
        seed(false, profile); transport.output = 'Mira nods. [[SCENE_STAKES: tense]]';
        const { result } = renderHook(() => useSceneContinue('story'));
        await act(async () => { await result.current.runSceneContinue(); });
        expect(useAppStore.getState().messages[0].content).toContain('Mira nods.');
        expect(useAppStore.getState().messages[0].content).not.toContain('SCENE_STAKES');
        expect(transport.refresh).toHaveBeenCalled();
    });
}
