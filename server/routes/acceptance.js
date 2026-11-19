import { Router } from 'express';
import { validateCampaignId } from '../lib/fileStore.js';
import { serverTableRegistry } from '../lib/tableRegistry.js';
import { createAcceptanceCoordinator } from '../services/acceptanceCoordinator.js';
import { createAcceptanceArchiveEmbedding } from '../services/acceptanceArchiveEmbedding.js';

export function createAcceptanceRouter(coordinator = createAcceptanceCoordinator({ modTargets: () => Object.fromEntries(
    serverTableRegistry.list().filter(table => table.name.startsWith('mod.')).map(table => [table.name, table.fileSuffix]),
), dispatchArchiveEmbedding: createAcceptanceArchiveEmbedding() })) {
    const router = Router();
    const handle = action => async (req, res) => {
        try { validateCampaignId(req.params.id); res.json(await action(req)); }
        catch (error) { res.status(error.statusCode ?? 500).json({ code: error.code ?? error.message ?? 'acceptance-persistence-failure' }); }
    };
    router.post('/api/campaigns/:id/acceptance/prepare', handle(req => coordinator.preflight(req.params.id, req.body.candidate, req.body.storageToken)));
    router.post('/api/campaigns/:id/acceptance/worldmap-inputs', handle(req => coordinator.freezeWorldMap(req.params.id, req.body.ticketId, req.body.runtimeInput)));
    router.post('/api/campaigns/:id/acceptance/commit', handle(req => coordinator.commit(req.params.id, req.body)));
    router.post('/api/campaigns/:id/acceptance/recover', handle(req => coordinator.recover(req.params.id, req.body.logicalKey)));
    router.post('/api/campaigns/:id/acceptance/acknowledge', handle(req => coordinator.acknowledge(req.params.id, req.body.logicalKey, req.body.head)));
    router.post('/api/campaigns/:id/acceptance/publication', handle(req => coordinator.publication(req.params.id, req.body.logicalKey)));
    return router;
}
