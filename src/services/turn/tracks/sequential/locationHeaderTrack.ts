import { applyStoryMovement } from '../../applyStoryMovement';
import { movementPositionKey, parseStoryMovement } from '../../storyMovement';
import { useAppStore } from '../../../../store/useAppStore';
import { anchorSceneLocation, parseLocationHeader } from '../../../locationHeader';
import type { PostTurnTrack, SequentialTrackContext } from '../types';

export const locationHeaderTrack: PostTurnTrack<SequentialTrackContext> = {
    id: 'track.location-header',
    name: 'Location Header Tracking',
    description: 'Synchronizes the committed scene location with Places and its local features.',
    toggleable: false,
    defaultEnabled: true,
    trigger: 'automatic',
    callsModel: false,
    shouldRun: () => true,
    async run(ctx) {
        // Sibling of the 👥 [Present] parse: the GM's 📍 [Location] header is the
        // authoritative per-turn location self-report (requested by defaultRules.ts:51).
        // Engine regex, zero LLM, every tier. The interval-gated scanLocation call in
        // runArchiveTrack stays the cold path (features/connections enrichment). Header
        // absent or unusable → no-op. A committed current place is registered before
        // its pointer is published, allowing map subscribers to resolve it immediately.
        try {
            const sNow = (ctx.effects?.store ?? useAppStore).getState();
            const recorded = ctx.state?.effectAdapter?.recorded;
            const locationInputs = recorded ? { now: recorded.now, newId: () => recorded.newId('location') } : undefined;
            if (sNow.activeCampaignId === ctx.activeCampaignId) {
                // Replies commit later; manual map movement since generation always wins.
                const generationPosition = ctx.effects ? ctx.effects.generationPosition : ctx.state?.context ? movementPositionKey(ctx.state.context) : undefined;
                if (ctx.effects && !generationPosition && (parseLocationHeader(ctx.lastAssistantContent) || parseStoryMovement(ctx.lastAssistantContent).present)) ctx.effects.failRequiredWriter('missing-generation-movement-position');
                if (generationPosition && generationPosition !== movementPositionKey(sNow.context)) return;
                if (await applyStoryMovement(ctx.lastAssistantContent, ctx.activeCampaignId, ctx.effects?.store, ctx.effects?.failRequiredWriter, ctx.effects?.movement, locationInputs)) return;
                const { outcome, created } = anchorSceneLocation(
                    ctx.lastAssistantContent,
                    sNow.locationLedger ?? [],
                    sNow.context.currentPlaceId ?? null,
                    locationInputs,
                );
                if (created) sNow.addLocation(created);
                if (outcome.kind === 'resolved') {
                    ctx.callbacks.updateContext({ currentPlaceId: outcome.placeId, currentFeature: outcome.feature });
                    if (outcome.appendFeature && outcome.feature) {
                        const entry = sNow.locationLedger.find(l => l.id === outcome.placeId);
                        if (entry) sNow.updateLocation(outcome.placeId, { features: [...entry.features, outcome.feature], lastSeenScene: String(ctx.state?.effectAdapter?.recorded?.now ?? Date.now()) });
                    }
                } else if (outcome.kind === 'feature-only') {
                    ctx.callbacks.updateContext({ currentFeature: outcome.feature });
                    if (outcome.appendFeature && sNow.context.currentPlaceId) {
                        const entry = sNow.locationLedger.find(l => l.id === sNow.context.currentPlaceId);
                        if (entry) sNow.updateLocation(entry.id, { features: [...entry.features, outcome.feature] });
                    }
                } else if (outcome.kind === 'unknown') {
                    sNow.addLocationSuggestions([outcome.suggestion]);
                }
            }
        } catch (err) {
            ctx.state?.effectAdapter?.failRequiredWriter('location-header');
            console.warn('[LocationHeader] Parse failed (non-fatal):', err);
        }
    },
};
