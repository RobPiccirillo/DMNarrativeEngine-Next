import { scanInventory } from '../../../inventoryParser';
import { enqueueTurnEffect } from '../../acceptance/effectAdapter';
import { tierAllows } from '../../aiTier';
import type { PostCommitTrackContext, PostTurnTrack } from '../types';
import { assertStillActive } from '../guarded';

export const inventoryScanTrack: PostTurnTrack<PostCommitTrackContext> = {
    id: 'track.inventory-scan',
    name: 'Inventory Scan',
    description: 'Updates the structured inventory from recent messages.',
    toggleable: true,
    defaultEnabled: true,
    trigger: 'automatic',
    callsModel: true,
    shouldRun: (ctx) => ctx.state.settings.inferenceProfileId !== 'constrained-local-v1' && ctx.bookkeepingDue
        && ctx.bkAvailable
        && tierAllows(ctx.facade?.config.aiTier ?? ctx.state.settings.aiTier, 'inventoryScan'),
    async run(ctx) {
        enqueueTurnEffect(ctx.effects, 'Inventory-Scan', async () => {
            if (!assertStillActive(ctx.activeCampaignId, 'Inventory-Scan')) return;
            const newItems = await scanInventory(
                ctx.facade ? undefined : ctx.bkProvider,
                ctx.scanMessages,
                ctx.inventoryItems,
                ctx.storyModelCall,
            );
            if (!assertStillActive(ctx.activeCampaignId, 'Inventory-Scan')) return;
            ctx.guardedUpdateContext({
                inventory: newItems.map(it => `- ${it.qty > 1 ? `${it.qty}x ` : ''}${it.name}`).join('\n'),
                inventoryItems: newItems,
                inventoryLastScene: ctx.sceneId,
            });
            (ctx.facade?.write.setInventoryItems ?? ctx.guardedSetInventoryItems)(newItems);
            console.log(`[Auto Bookkeeping] Inventory updated at scene #${ctx.sceneId}`);
        }).catch(err => console.warn('[Auto Bookkeeping] Inventory scan failed:', err));
    },
};
