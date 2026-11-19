import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMessageEditor } from '../useMessageEditor';
import { useAppStore } from '../../../store/useAppStore';
import { api } from '../../../services/llm/apiClient';
import type { ChatMessage } from '../../../types';

vi.mock('../../../services/llm/apiClient', () => ({ api: {
    archive: { updateSceneAssistant: vi.fn(), deleteScene: vi.fn(), getIndex: vi.fn(async () => []) },
    backups: { create: vi.fn(async () => undefined) }, timeline: { get: vi.fn(async () => []) }, chapters: { list: vi.fn(async () => []) },
} }));
const original = useAppStore.getState();
beforeEach(() => { vi.clearAllMocks(); useAppStore.setState({ activeCampaignId: 'managed', draftLifecycle: { campaignId: 'managed', managed: true, status: 'ready' } }); });
afterEach(() => { cleanup(); useAppStore.setState(original, true); });
function dependencies() {
    return { messages: [{ id: 'user', role: 'user', content: 'Wait.', timestamp: 1 },
        { id: 'assistant', role: 'assistant', content: 'Accepted Story.', timestamp: 2, sceneId: '001', draftSetId: 'historical-draft' }] as ChatMessage[],
    rollbackArchive: vi.fn(async () => {}), deleteMessagesFrom: vi.fn(), updateMessageContent: vi.fn(), onAfterEdit: vi.fn(), onAfterRegenerate: vi.fn(), onRegenerateDraft: vi.fn(async () => {}),
    activeCampaignId: 'managed', deleteMessage: vi.fn(), archiveDeps: { setArchiveIndex: vi.fn(), setTimeline: vi.fn(), setChapters: vi.fn() }, deleteDivergenceChapter: vi.fn() };
}
it('keeps accepted prose and its edit open when archive maintenance is rejected', async () => {
    const deps = dependencies(), { result } = renderHook(() => useMessageEditor(deps));
    act(() => result.current.startEditing(deps.messages[1])); act(() => result.current.setInlineDraft('Edited Story.'));
    vi.mocked(api.archive.updateSceneAssistant).mockResolvedValue(undefined);
    await act(async () => { await result.current.handleEditSubmit(); });
    expect(deps.updateMessageContent).not.toHaveBeenCalled(); expect(result.current.editingMessageId).toBe('assistant'); expect(result.current.inlineDraft).toBe('Edited Story.');
});
it('updates accepted prose only after the archive confirms the maintenance', async () => {
    const deps = dependencies(), { result } = renderHook(() => useMessageEditor(deps));
    act(() => result.current.startEditing(deps.messages[1])); act(() => result.current.setInlineDraft('Edited Story.'));
    vi.mocked(api.archive.updateSceneAssistant).mockResolvedValue({ ok: true, userContent: 'Wait.' });
    await act(async () => { await result.current.handleEditSubmit(); });
    expect(deps.updateMessageContent).toHaveBeenCalledWith('assistant', 'Edited Story.'); expect(result.current.editingMessageId).toBeNull();
});
it('keeps an accepted message visible when its server deletion is rejected', async () => {
    const deps = dependencies(), { result } = renderHook(() => useMessageEditor(deps));
    vi.mocked(api.archive.deleteScene).mockResolvedValue(undefined);
    await act(async () => { await result.current.handleDeleteOutput('assistant'); });
    expect(deps.deleteMessage).not.toHaveBeenCalled(); expect(deps.deleteDivergenceChapter).not.toHaveBeenCalled();
});
it('uses accepted-history rollback for regeneration and preserves the next input when rollback is rejected', async () => {
    const deps = dependencies(); deps.rollbackArchive.mockRejectedValue(new Error('acceptance-write-owned'));
    const { result } = renderHook(() => useMessageEditor(deps));
    await act(async () => { await result.current.handleRegenerate('assistant'); });
    expect(deps.rollbackArchive).toHaveBeenCalledWith(1); expect(deps.onRegenerateDraft).not.toHaveBeenCalled(); expect(deps.deleteMessagesFrom).not.toHaveBeenCalled(); expect(deps.onAfterRegenerate).not.toHaveBeenCalled();
});
