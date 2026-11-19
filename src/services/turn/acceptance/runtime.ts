import { acceptanceCandidate } from '@narrative/engine/contracts/draftLifecycle';
import type { LegacyAcceptanceCommand } from '@narrative/engine/contracts/legacyAcceptance';
import { API_BASE } from '../../../lib/apiBase';
import { useAppStore } from '../../../store/useAppStore';
import { saveCampaignState } from '../../../store/campaignStore';
import { drainStateSaves } from '../../../store/campaignStateTransport';
import { flushAllPendingSaves, cancelPendingSaves } from '../../../store/slices/campaignSlice';
import { activeDraft, loadDraftLifecycle } from '../drafts/runtime';
import type { TurnState } from '../turnOrchestrator';
import type { ChatMessage } from '../../../types';
import { prepareTurnEffects } from './prepareEffects';
import type { AcceptancePreparation } from './prepareEffects';
import { captureWorldMapSolverInputs, hasPreparedWorldMap, installWorldMapPublication } from './worldmapPreparation.js';

type Store = ReturnType<typeof useAppStore.getState>;
interface Outcome { head: string; revisionId: string; hash: string; worldmapProjection?: unknown }
interface Publication extends AcceptancePreparation { outcome: Outcome; command: LegacyAcceptanceCommand; index: Store['archiveIndex']; chapters: Store['chapters'] }
interface Prepared extends AcceptancePreparation { status: 'prepare' | 'in-progress' | 'duplicate'; logicalKey?: string }

async function request<T>(id: string, action: string, body: object): Promise<T> {
    const response = await fetch(`${API_BASE}/campaigns/${id}/acceptance/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.code ?? `acceptance-http-${response.status}`);
    return value;
}

async function install(id: string, logicalKey: string): Promise<void> {
    const publication = await request<Publication>(id, 'publication', { logicalKey });
    if (useAppStore.getState().activeCampaignId !== id) throw new Error('acceptance-campaign-changed');
    cancelPendingSaves();
    const state = publication.state;
    installWorldMapPublication(publication.command, publication.outcome, useAppStore, state, publication.modTables, () => useAppStore.setState({
        context: state.context, messages: state.messages, condenser: state.condenser,
        pinnedExcerpts: (state as typeof state & { pinnedExcerpts?: Store['pinnedExcerpts'] }).pinnedExcerpts ?? [],
        bookkeepingTurnCounter: state.bookkeepingTurnCounter ?? useAppStore.getState().bookkeepingTurnCounter,
        onStageNpcIds: (state as typeof state & { onStageNpcIds?: string[] }).onStageNpcIds ?? [],
        npcSuggestions: state.npcSuggestions ?? [], locationSuggestions: state.locationSuggestions ?? [],
        npcLedger: publication.npcs, locationLedger: publication.locations, archiveIndex: publication.index, chapters: publication.chapters,
        timeline: publication.timeline, divergenceRegister: publication.divergence ?? useAppStore.getState().divergenceRegister,
        relationshipMemoriesNpcToMc: publication.relationships.npcToMc, relationshipMemoriesNpcToNpc: publication.relationships.npcToNpc,
        modTables: publication.modTables, inventoryItems: state.context.inventoryItems, characterProfileData: state.context.characterProfileData,
        playerCharacter: state.context.playerCharacter ?? null,
    }));
    await request(id, 'acknowledge', { logicalKey, head: publication.outcome.head });
    await loadDraftLifecycle(id);
}

export async function acceptManagedTurn(original: TurnState, messages: ChatMessage[]): Promise<void> {
    const initial = useAppStore.getState(), id = initial.activeCampaignId, view = initial.draftLifecycle;
    if (!id || !view?.managed || view.campaignId !== id) throw new Error('missing-managed-acceptance-binding');
    try {
        const pending = view.pendingAcceptance;
        if (pending) {
            const command = pending as typeof pending & { effectGroup?: unknown };
            if (command.effectGroup) { await request(id, 'recover', { logicalKey: command.logicalKey }); await install(id, command.logicalKey); return; }
        }
        const unacknowledged = view.unacknowledged?.[0];
        if (unacknowledged) { await install(id, unacknowledged.logicalKey); return; }
        const set = activeDraft(view);
        if (!set) return;
        if (view.unsavedRequest || view.document?.conflicts.length) throw new Error('draft-recovery-required');
        const message = initial.messages.find(message => message.id === set.assistantMessageId);
        if (!message) throw new Error('missing-selected-message');
        const candidate = acceptanceCandidate(set, message.content);
        let runtimeInput: unknown;
        if (!pending) {
            await flushAllPendingSaves(); await drainStateSaves(id);
            const latest = useAppStore.getState();
            if (latest.activeCampaignId !== id) throw new Error('acceptance-campaign-changed');
            await saveCampaignState(id, { context: latest.context, messages: latest.messages, condenser: latest.condenser, pinnedExcerpts: latest.pinnedExcerpts });
            if (hasPreparedWorldMap()) runtimeInput = await captureWorldMapSolverInputs(id);
            cancelPendingSaves();
        }
        const prepared = await request<Prepared>(id, 'prepare', { candidate, storageToken: view.saveToken?.storageToken });
        if (prepared.status !== 'prepare') {
            if (!prepared.logicalKey) throw new Error('missing-acceptance-logical-key');
            if (prepared.status === 'in-progress') await request(id, 'recover', { logicalKey: prepared.logicalKey });
            await install(id, prepared.logicalKey); return;
        }
        const logicalKey = `${prepared.command.campaignInstance}/narrative-evidence/command-id/${prepared.command.commandId}`;
        await loadDraftLifecycle(id);
        useAppStore.setState({ draftLifecycle: { ...useAppStore.getState().draftLifecycle!, status: 'recovering' } });
        if (hasPreparedWorldMap()) {
            prepared.runtimeInput ??= runtimeInput ?? await captureWorldMapSolverInputs(id);
            const frozen = await request<{ worldmapRuntime: unknown }>(id, 'worldmap-inputs', { ticketId: prepared.ticketId, runtimeInput: prepared.runtimeInput });
            prepared.runtimeInput = frozen.worldmapRuntime;
        }
        const revision = set.revisions.find(revision => revision.id === candidate.revisionId)!;
        const effects = await prepareTurnEffects(prepared, original, messages, revision.text);
        await request(id, 'commit', { ticketId: prepared.ticketId, command: prepared.command, bundle: effects.bundle });
        await install(id, logicalKey);
        for (const notify of effects.notifications) notify();
    } catch (error) {
        if (useAppStore.getState().activeCampaignId === id) {
            await loadDraftLifecycle(id).catch(() => {});
            const current = useAppStore.getState().draftLifecycle;
            if (current) useAppStore.setState({ draftLifecycle: { ...current,
                status: error instanceof Error && error.message === 'generation-movement-context-unavailable-regenerate' && !current.pendingAcceptance ? 'ready' : 'conflict',
                error: error instanceof Error ? error.message : String(error) } });
        }
        throw error;
    }
}

export async function recoverManagedAcceptance(id: string): Promise<void> {
    const view = await loadDraftLifecycle(id, true);
    if (view.pendingAcceptance) {
        const pending = view.pendingAcceptance as NonNullable<typeof view.pendingAcceptance> & { effectGroup?: unknown };
        if (!pending.effectGroup) {
            useAppStore.setState({ draftLifecycle: { ...view, status: 'conflict', error: 'acceptance-preparation-interrupted' } }); return;
        }
        await request(id, 'recover', { logicalKey: pending.logicalKey }); await install(id, pending.logicalKey);
    } else if (view.unacknowledged?.length) await install(id, view.unacknowledged[0].logicalKey);
}
