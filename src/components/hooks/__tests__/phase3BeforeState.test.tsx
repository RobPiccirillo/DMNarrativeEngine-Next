import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { useAppStore } from '../../../store/useAppStore';
import { useSwipeVariants } from '../useSwipeVariants';
import { useMessageEditor } from '../useMessageEditor';
import { commitPendingTurn, clearPendingTurnSnapshot, reconcilePendingCommitOnLaunch } from '../../../services/turn/pendingCommit';
import { fixtureContext, fixtureSettings } from '../../../services/turn/__tests__/baseAppGate/fixture';

const io = vi.hoisted(() => ({ output: '', archived: true, calls: [] as unknown[] }));
vi.mock('../../../services/chatEngine', () => ({
    sendMessage: (_p: unknown, messages: unknown, chunk: (s: string) => void, done: (s: string) => void) => {
        io.calls.push({ kind: 'story', messages }); chunk(io.output); done(io.output);
    },
}));
vi.mock('../../../services/turn/postTurnPipeline', () => ({
    runPostTurnPipeline: async (...args: unknown[]) => {
        io.calls.push({ kind: 'pipeline-seam', text: args[2], options: args[5], archived: io.archived });
        return { archived: io.archived };
    },
}));
vi.mock('../../../store/campaignStore', () => ({
    saveCampaignState: async (id: string, state: unknown) => { io.calls.push({ kind: 'state-save', id, state }); },
    saveDivergenceRegister: async () => {},
}));
vi.mock('../../../services/turn/sceneStakesTag', async original => ({
    ...await original<object>(), classifySceneStakes: async () => 'calm',
}));

const original = useAppStore.getState();
afterEach(() => { cleanup(); clearPendingTurnSnapshot(); useAppStore.setState(original, true); vi.restoreAllMocks(); });

it.skipIf(process.env.PHASE3_CAPTURE_BEFORE !== '1')('captures pre-change swipe/edit/regenerate/switch/archive-failure/reload transitions', async () => {
    vi.useFakeTimers();
    io.calls = [];
    const evidence: unknown[] = [];
    const capture = (boundary: string) => evidence.push(JSON.parse(JSON.stringify({ boundary,
        activeCampaignId: useAppStore.getState().activeCampaignId, messages: useAppStore.getState().messages, calls: io.calls })));
    const seed = () => {
        clearPendingTurnSnapshot(); io.calls = []; io.archived = true;
        useAppStore.setState({ ...useAppStore.getInitialState(), activeCampaignId: 'phase3-before',
            context: fixtureContext(), settings: { ...fixtureSettings(), aiTier: 'lite', autoCondenseEnabled: false,
                providers: [{ id: 'provider', name: 'Before-state fixture', type: 'openai', endpoint: 'http://test', modelName: 'test', apiKey: '' }],
                presets: [{ id: 'preset', name: 'Before-state fixture', storyAIProviderId: 'provider', sampling: { temperature: 0.7 } }], activePresetId: 'preset',
            } as never,
            messages: [{ id: 'user', role: 'user', content: 'I wait.', timestamp: 0 },
                { id: 'story', role: 'assistant', content: 'Initial Story.', timestamp: 1, pendingCommit: true,
                    swipeSet: [{ id: 'old-variant', text: 'Initial Story.', sceneStakes: 'calm', tagPresent: true }], swipeActiveIndex: 0 }],
        });
    };
    seed(); capture('pending-before-next-send');
    await commitPendingTurn(); capture('normal-acceptance-at-pipeline-seam');
    seed();
    const swipe = renderHook(() => useSwipeVariants('story'));
    for (const output of ['Swipe one.', 'Swipe two.']) {
        io.output = output;
        const { capturePendingTurnSnapshot } = await import('../../../services/turn/pendingCommit');
        capturePendingTurnSnapshot({ ...useAppStore.getState(), getMessages: () => useAppStore.getState().messages } as never,
            [{ role: 'user', content: 'I wait.' }], 'I wait.');
        await act(async () => { await swipe.result.current.generateSwipe(); });
        capture(output);
    }
    expect(useAppStore.getState().messages[1].swipeSet).toHaveLength(3);
    act(() => swipe.result.current.setSwipeIndex(1)); capture('selected-first-swipe');
    act(() => swipe.result.current.updateVariantText('Edited swipe.')); capture('edited-first-swipe');
    const revisionBeforeEdit = useAppStore.getState().messages[1].swipeSet![1].id;
    expect(useAppStore.getState().messages[1].content).toBe('Edited swipe.');
    capture(`legacy-edit-keeps-id:${revisionBeforeEdit}`);
    const editor = renderHook(() => useMessageEditor({
        messages: useAppStore.getState().messages, activeCampaignId: 'phase3-before',
        rollbackArchive: async timestamp => { io.calls.push({ kind: 'rollback', timestamp }); },
        deleteMessagesFrom: id => useAppStore.getState().deleteMessagesFrom(id),
        updateMessageContent: () => {}, onAfterEdit: () => {},
        onAfterRegenerate: text => { io.calls.push({ kind: 'regenerate-dispatch', text }); },
        deleteMessage: () => {}, archiveDeps: { setArchiveIndex: () => {}, setTimeline: () => {}, setChapters: () => {} },
        deleteDivergenceChapter: () => {},
    }));
    act(() => editor.result.current.handleRegenerate('story'));
    act(() => vi.advanceTimersByTime(50)); capture('regenerate-removes-old-turn');
    seed(); io.archived = false;
    await commitPendingTurn(); capture('archive-failure-retains-pending');
    expect(useAppStore.getState().messages[1].commitFailed).toBe(true);
    io.archived = true; await commitPendingTurn(); capture('retry-saving-runs-pipeline-again');
    seed();
    clearPendingTurnSnapshot(); capture('renderer-death-snapshot-lost');
    await reconcilePendingCommitOnLaunch(); capture('reload-auto-commits-ready-draft');
    seed(); io.archived = false;
    await useAppStore.getState().setActiveCampaign(null); capture('switch-continues-after-failed-archive');
    expect(useAppStore.getState().activeCampaignId).toBeNull();
    vi.useRealTimers();
    const root = 'docs/eval/phase-3/before'; mkdirSync(root, { recursive: true });
    writeFileSync(`${root}/transitions.json`, JSON.stringify({ startingCommit: 'a088d56db92fdf58934204b607485cd711ff3e31',
        scope: 'Real hooks/store/pending coordinator; model, save and post-turn pipeline are explicitly recorded IO seams. Full normal pipeline is captured separately.', evidence }, null, 2));
});
