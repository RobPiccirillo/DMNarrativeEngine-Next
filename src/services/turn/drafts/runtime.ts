import type { AttemptKind, AttemptRef, DraftRef, DraftRevision, DraftSet, GenerationAttempt, RevisionRef } from '@narrative/engine/contracts/draftLifecycle';
import type { ChatMessage, SwipeVariant } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { saveCampaignState } from '../../../store/campaignStore';
import { API_BASE } from '../../../lib/apiBase';
import { rememberStateSaveToken } from '../../../store/campaignStateTransport';
import type { StateSaveToken } from '../../../store/campaignStateTransport';

export interface LifecycleView {
    campaignId: string;
    managed: boolean;
    version?: string;
    head?: string;
    saveToken?: StateSaveToken;
    document?: { schemaVersion: 1; campaignInstance: string; activeSetId: DraftRef | null; sets: DraftSet[]; conflicts: { code: string }[];
        storageGuard?: { format: 'legacy-storage-scope-v1'; storageId: string; token: string; phase: string; assetAliases?: Record<string, string> } };
    pendingAcceptance?: { logicalKey: string; status: string } | null;
    unacknowledged?: { logicalKey: string; outcome: unknown }[];
    status: 'ready' | 'saving' | 'unsaved' | 'conflict' | 'recovering';
    error?: string;
    unsavedRequest?: Record<string, unknown>;
}

export interface DraftAttemptHandle { campaignId: string; setId: DraftRef; attemptId: AttemptRef; kind: AttemptKind; selectionVersion?: string; displayEpoch?: number }
const displayEpochs = new Map<string, number>();
const displayKey = (campaign: string, set: string) => campaign + ':' + set;
export function ownsDraftDisplay(handle: DraftAttemptHandle): boolean {
    const view = useAppStore.getState().draftLifecycle, set = activeDraft(view);
    return view?.campaignId === handle.campaignId && view.status === 'ready' && set?.id === handle.setId
        && set.selectionVersion === handle.selectionVersion && (displayEpochs.get(displayKey(handle.campaignId, handle.setId)) ?? 0) === handle.displayEpoch
        && set.attempts.some(attempt => attempt.id === handle.attemptId && attempt.status === 'streaming');
}
export interface DraftRuntimeCallbacks {
    begin: (messageId: string, kind: AttemptKind, generationPosition?: string) => Promise<DraftAttemptHandle | null>;
    finish: (handle: DraftAttemptHandle | null, status: 'completed' | 'failed' | 'aborted', variant?: Pick<SwipeVariant, 'text' | 'sceneStakes' | 'tagPresent'>, select?: boolean) => Promise<void>;
}

const queues = new Map<string, Promise<unknown>>();
function serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    const tail = next.catch(() => {}); queues.set(id, tail);
    void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
    return next;
}

export function activeDraft(view = useAppStore.getState().draftLifecycle): DraftSet | undefined {
    return view?.document?.sets.find(set => set.id === view.document?.activeSetId);
}

function project(id: string, view: LifecycleView, applyText: boolean, syncVariants = applyText): void {
    const store = useAppStore.getState();
    if (store.activeCampaignId !== id) return;
    const set = activeDraft(view);
    let messages = store.messages;
    if (set) {
        const revisions = new Map(set.revisions.map(revision => [revision.id, revision]));
        const selected = revisions.get(set.selectedRevisionId!);
        const variants: SwipeVariant[] = set.revisionOrder.map(revisionId => {
            const revision = revisions.get(revisionId)!;
            return { id: revision.id, revisionId: revision.id, text: revision.text, contentHash: revision.hash,
                sceneStakes: revision.metadata?.sceneStakes ?? 'calm', tagPresent: revision.metadata?.tagPresent ?? false };
        });
        messages = messages.map(message => message.id !== set.assistantMessageId ? message : {
            ...message, draftSetId: set.id, selectedRevisionId: set.selectedRevisionId, displayedRevisionId: set.displayedRevisionId,
            draftStatus: set.state, draftHash: selected?.hash,
            ...(syncVariants && selected ? { swipeSet: variants, swipeActiveIndex: variants.findIndex(variant => variant.id === selected.id), pendingCommit: true } : {}),
            ...(applyText && selected ? { content: selected.text, displayContent: selected.text } : {}),
            ...(set.attempts.some(attempt => attempt.status === 'interrupted') && !selected ? { draftStatus: 'interrupted', retryable: undefined, precontext: undefined } : {}),
        });
    }
    useAppStore.setState({ draftLifecycle: view, messages });
}

async function transport(id: string, body?: Record<string, unknown>): Promise<LifecycleView & { attempt?: GenerationAttempt; revision?: DraftRevision }> {
    const response = await fetch(`${API_BASE}/campaigns/${id}/lifecycle`, body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : undefined);
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.code ?? `HTTP ${response.status}`), { code: value.code, status: response.status });
    rememberStateSaveToken(id, value.saveToken);
    return { ...value, campaignId: id, status: 'ready' };
}

export async function loadDraftLifecycle(id: string, restore = false): Promise<LifecycleView> {
    try {
        let view = await transport(id);
        const set = activeDraft(view);
        if (restore && set && set.attempts.some(attempt => attempt.status === 'streaming') && !view.pendingAcceptance) {
            view = await transport(id, { action: 'restore', setId: set.id, expectedVersion: view.version });
        }
        if (view.document?.conflicts.length) view = { ...view, status: 'conflict', error: view.document.conflicts[0].code };
        project(id, view, true); return view;
    } catch (error) {
        const view: LifecycleView = { campaignId: id, managed: true, status: 'conflict', error: error instanceof Error ? error.message : String(error) };
        project(id, view, false); throw error;
    }
}

async function mutate(id: string, body: Record<string, unknown>, applyText = true, replay = false) {
    const transitionId = replay ? body.transitionId : crypto.randomUUID();
    return serialize(id, async () => {
        const store = useAppStore.getState();
        if (store.activeCampaignId !== id) throw new Error('draft-campaign-changed');
        const view = store.draftLifecycle;
        if (view?.status === 'conflict') throw new Error(view.error ?? 'draft-conflict');
        const request = replay ? body : { ...body, transitionId, ...(view?.managed ? { expectedVersion: view.version } : {}) };
        if (view) project(id, { ...view, status: 'saving', unsavedRequest: request }, false);
        try {
            const result = await transport(id, request);
            project(id, result, applyText, ['finish', 'edit', 'select', 'restore'].includes(String(body.action))); return result;
        } catch (error) {
            if (view) project(id, { ...view, status: 'unsaved', unsavedRequest: request, error: error instanceof Error ? error.message : String(error) }, false);
            throw error;
        }
    });
}

export async function recoverUnsavedDraft(): Promise<void> {
    const view = useAppStore.getState().draftLifecycle;
    if (!view?.unsavedRequest) return;
    await mutate(view.campaignId, view.unsavedRequest, true, true);
    if (view.unsavedRequest.action === 'begin') await loadDraftLifecycle(view.campaignId, true);
    const store = useAppStore.getState();
    if (store.activeCampaignId === view.campaignId) await saveCampaignState(view.campaignId, {
        context: store.context, messages: store.messages, condenser: store.condenser, pinnedExcerpts: store.pinnedExcerpts,
    });
}

export async function beginDraftAttempt(messageId: string, kind: AttemptKind, generationPosition?: string): Promise<DraftAttemptHandle | null> {
    const store = useAppStore.getState(), id = store.activeCampaignId;
    if (!id) return null;
    const index = store.messages.findIndex(message => message.id === messageId);
    const source = store.messages.slice(0, index).reverse().find(message => message.role === 'user');
    if (!source) throw new Error('missing-draft-source');
    await saveCampaignState(id, { context: store.context, messages: store.messages, condenser: store.condenser, pinnedExcerpts: store.pinnedExcerpts });
    if (!store.draftLifecycle || store.draftLifecycle.campaignId !== id) await loadDraftLifecycle(id);
    const result = await mutate(id, { action: 'begin', kind, assistantMessageId: messageId, sourceMessageId: source.id,
        archivedUserText: source.displayContent ?? source.content, profileId: store.settings.inferenceProfileId ?? 'current', ...(generationPosition ? { generationPosition } : {}) }, false);
    const set = activeDraft(result)!;
    return { campaignId: id, setId: set.id, attemptId: result.attempt!.id, kind, selectionVersion: set.selectionVersion, displayEpoch: displayEpochs.get(displayKey(id, set.id)) ?? 0 };
}

export async function finishDraftAttempt(handle: DraftAttemptHandle | null, status: 'completed' | 'failed' | 'aborted',
    variant?: Pick<SwipeVariant, 'text' | 'sceneStakes' | 'tagPresent'>, select = true): Promise<void> {
    if (!handle) return;
    await mutate(handle.campaignId, { action: 'finish', setId: handle.setId, attemptId: handle.attemptId, status,
        ...(variant ? { text: variant.text, metadata: { sceneStakes: variant.sceneStakes, tagPresent: variant.tagPresent } } : {}), select }, select);
    const store = useAppStore.getState();
    if (store.activeCampaignId === handle.campaignId) await saveCampaignState(handle.campaignId, {
        context: store.context, messages: store.messages, condenser: store.condenser, pinnedExcerpts: store.pinnedExcerpts,
    });
}

export async function chooseDraftRevision(messageId: string, revisionId: RevisionRef, displayedText: string): Promise<void> {
    const store = useAppStore.getState(), set = activeDraft();
    if (!store.activeCampaignId || !set || set.assistantMessageId !== messageId) return;
    const key = displayKey(store.activeCampaignId, set.id); displayEpochs.set(key, (displayEpochs.get(key) ?? 0) + 1);
    await mutate(store.activeCampaignId, { action: 'select', setId: set.id, revisionId, displayedText });
}

export async function editDraftRevision(messageId: string, text: string): Promise<void> {
    const store = useAppStore.getState(), set = activeDraft();
    if (!store.activeCampaignId || !set || set.assistantMessageId !== messageId) throw new Error('missing-draft-lifecycle');
    await mutate(store.activeCampaignId, { action: 'edit', setId: set.id, parentRevisionId: set.selectedRevisionId, text });
}

export async function discardDraft(messageId: string): Promise<void> {
    const store = useAppStore.getState(), set = activeDraft();
    if (!store.activeCampaignId || !set || set.assistantMessageId !== messageId) return;
    await mutate(store.activeCampaignId, { action: 'discard', setId: set.id }, false);
}

export function assertDraftMutationReady(): void {
    const view = useAppStore.getState().draftLifecycle;
    if (view && (view.status !== 'ready' || view.document?.conflicts.length || view.pendingAcceptance)) throw new Error(view.error ?? 'draft-recovery-required');
}

export const draftRuntimeCallbacks: DraftRuntimeCallbacks = { begin: beginDraftAttempt, finish: finishDraftAttempt };
export function isManagedDraft(message: ChatMessage): boolean { return Boolean(message.draftSetId); }
