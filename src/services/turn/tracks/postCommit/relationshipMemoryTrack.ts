import { readRelationshipMemoryState, writeRelationshipMemoryState } from '../../../../store/relationshipMemoryState';
import { saveRelationshipMemories } from '../../../../store/relationshipMemoryStore';
import { getRelationshipMemoryParticipants, mergeRelationshipMemoryCollections, rateRelationshipMemory } from '../../../archive-memory/relationshipMemory';
import { enqueueTurnEffect } from '../../acceptance/effectAdapter';
import { hasHostModelRole } from '../../hostFacade';
import type { PostTurnTrack, PostCommitTrackContext } from '../types';
import { assertStillActive } from '../guarded';

export const relationshipMemoryTrack: PostTurnTrack<PostCommitTrackContext> = {
    id: 'track.relationship-memory',
    name: 'Relationship Memory',
    description: 'Records sparse directed memories from committed scenes.',
    toggleable: false,
    defaultEnabled: true,
    trigger: 'automatic',
    callsModel: true,
    shouldRun: (ctx) => ctx.state.settings.inferenceProfileId !== 'constrained-local-v1' && Boolean(
        ctx.freshContext.relationshipMemory === true &&
        ctx.facade &&
        hasHostModelRole(ctx.facade, 'utility') &&
        ctx.activeCampaignId &&
        ctx.lastAssistantContent,
    ),
    async run(ctx) {
        if (!ctx.facade || !ctx.activeCampaignId) return;
        const participants = getRelationshipMemoryParticipants(
            ctx.lastAssistantContent,
            ctx.state.npcLedger,
            ctx.freshContext.playerCharacter,
        );
        if (participants.onStageNpcs.length === 0) return;

        const sceneText = ctx.displayInput + '\n\n' + ctx.lastAssistantContent;
        const readState = ctx.effects?.readRelationships ?? readRelationshipMemoryState;
        const writeState = ctx.effects?.writeRelationships ?? writeRelationshipMemoryState;
        enqueueTurnEffect(ctx.effects, 'Relationship-Memory:' + ctx.sceneId, async () => {
            if (!assertStillActive(ctx.activeCampaignId, 'Relationship-Memory')) return;
            const result = await rateRelationshipMemory(
                ctx.sceneId,
                sceneText,
                participants,
                request => ctx.facade!.model.call('utility', { ...request, timeoutMs: 15000 }),
            );
            if (!assertStillActive(ctx.activeCampaignId, 'Relationship-Memory')) return;

            if (result.faults.length > 0) {
                const current = readState();
                writeState({
                    relationshipMemoryFaults: [...current.relationshipMemoryFaults, ...result.faults],
                });
            }
            if (result.npcToMc.length === 0 && result.npcToNpc.length === 0) return;

            const state = readState();
            const merged = mergeRelationshipMemoryCollections(
                state.relationshipMemoriesNpcToMc,
                state.relationshipMemoriesNpcToNpc,
                result,
            );
            await (ctx.effects?.saveRelationships ?? saveRelationshipMemories)(ctx.activeCampaignId, merged);
            if (!assertStillActive(ctx.activeCampaignId, 'Relationship-Memory')) return;
            writeState({
                relationshipMemoriesNpcToMc: merged.npcToMc,
                relationshipMemoriesNpcToNpc: merged.npcToNpc,
            });
        }).catch(error => {
            console.warn('[PostTurn] Background relationship memory failed:', error);
            if (assertStillActive(ctx.activeCampaignId, 'Relationship-Memory')) {
                const current = readState();
                writeState({
                    relationshipMemoryFaults: [
                        ...current.relationshipMemoryFaults,
                        { sceneId: ctx.sceneId, message: 'Relationship memory storage failed.' },
                    ],
                });
            }
        });
    },
};
