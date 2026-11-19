import { useAppStore } from '../../../store/useAppStore';
import { gatherContext } from '../contextGatherer';
import { buildPayload } from '../../payload/payloadBuilder';
import { rebuildStateFromLiveStoreLike } from '../../../components/hooks/sceneContinueFallback';
import { activeDraft, assertDraftMutationReady } from './runtime';

export async function rebuildDraftGenerationPayload(messageId: string) {
    assertDraftMutationReady();
    const store = useAppStore.getState(), set = activeDraft();
    if (!set || set.assistantMessageId !== messageId) throw new Error('missing-draft-lifecycle');
    const sourceIndex = store.messages.findIndex(message => message.id === set.sourceMessageId);
    const source = store.messages[sourceIndex];
    if (!source || source.role !== 'user') throw new Error('missing-draft-source');
    const history = store.messages.slice(0, sourceIndex);
    const state = { ...rebuildStateFromLiveStoreLike(store, { clearPinnedChapters: () => {}, deepSearchThisTurn: false }),
        input: source.content, displayInput: set.archivedUserText, messages: history, getMessages: () => history };
    const gathered = await gatherContext(state, source.content, { chapters: store.chapters ?? [], pinnedChapterIds: store.pinnedChapterIds,
        clearPinnedChapters: () => {}, deepSearchThisTurn: false });
    return buildPayload({ settings: store.settings, context: store.context, history, userMessage: source.content,
        condensedUpToIndex: store.condenser.condensedUpToIndex, ...gathered,
        inventoryCategories: gathered.inventoryCategories as (import('../../../types').InventoryItemCategory | 'equipped')[] | undefined,
        npcLedger: store.npcLedger, archiveIndex: store.archiveIndex, chapters: store.chapters, onStageNpcIds: store.onStageNpcIds,
        divergenceRegister: store.divergenceRegister, pinnedExcerpts: store.pinnedExcerpts, locationLedger: store.locationLedger,
    }).messages;
}
