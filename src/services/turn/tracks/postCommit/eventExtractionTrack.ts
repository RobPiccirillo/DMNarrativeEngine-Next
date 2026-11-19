import { api } from '../../../llm/apiClient';
import { extractSceneEvents } from '../../../archive-memory/sceneEventExtractor';
import { enqueueTurnEffect } from '../../acceptance/effectAdapter';
import type { PostTurnTrack, PostCommitTrackContext } from '../types';
import { assertStillActive, makeGuarded } from '../guarded';

export const eventExtractionTrack: PostTurnTrack<PostCommitTrackContext> = {
    id: 'track.event-extraction',
    name: 'Event Extraction',
    description: 'Extracts durable scene events after an archive commit.',
    toggleable: true,
    defaultEnabled: true,
    trigger: 'automatic',
    callsModel: true,
    shouldRun: (ctx) => ctx.state.settings.inferenceProfileId !== 'constrained-local-v1' && Boolean(ctx.entry && !ctx.entry.events && ctx.eventExtractionProvider),
    async run(ctx) {
        const entry = ctx.entry;
        const provider = ctx.eventExtractionProvider;
        if (!entry || !provider) return;

        const sceneText = `${ctx.displayInput}\n\n${ctx.lastAssistantContent}`;
        const guardedSetArchiveIndex = makeGuarded(ctx.callbacks.setArchiveIndex, ctx.activeCampaignId, 'setArchiveIndex (Event-Extraction)');
        enqueueTurnEffect(ctx.effects, `Event-Extraction:${ctx.sceneId}`, async () => {
            if (!assertStillActive(ctx.activeCampaignId, 'Event-Extraction')) return;
            const events = await extractSceneEvents(provider, sceneText);
            if (events && events.length > 0) {
                await (ctx.effects?.api ?? api).archive.patchEvents(ctx.activeCampaignId, [{ sceneId: entry.sceneId, events }]);
                const updatedIndex = await (ctx.effects?.api ?? api).archive.getIndex(ctx.activeCampaignId);
                guardedSetArchiveIndex(updatedIndex);
                console.log(`[Archive] Post-turn events extracted for scene #${entry.sceneId}`);
            }
        }).catch(err => console.warn('[PostTurn] Background event extraction failed:', err));
    },
};
