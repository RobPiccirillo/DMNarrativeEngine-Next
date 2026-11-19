import { Router } from 'express';
import { validateCampaignId } from '../lib/fileStore.js';
import { createDraftLifecycleService } from '../services/draftLifecycleService.js';

export function createLifecycleRouter(service = createDraftLifecycleService()) {
    const router = Router();
    const handle = action => async (req, res) => {
        try { validateCampaignId(req.params.id); res.json(await action(req)); }
        catch (error) { res.status(error.statusCode ?? 500).json({ code: error.code ?? error.message ?? 'lifecycle-persistence-failure' }); }
    };
    router.get('/api/campaigns/:id/lifecycle', handle(req => service.inspect(req.params.id)));
    router.post('/api/campaigns/:id/lifecycle', handle(req => service.transition(req.params.id, req.body)));
    return router;
}
