import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { isInferenceClassification } from '@narrative/engine';
import * as intro from '../../services/npc-generation/charIntroEngine';
import { runArchivePlanner } from '../../services/archive-memory/archivePlanner';
import { rateImportance } from '../../services/archive-memory/importanceRater';
import { extractSceneEvents } from '../../services/archive-memory/sceneEventExtractor';
import { fixtureContext, fixtureProvider } from '../../services/turn/__tests__/baseAppGate/fixture';
import { scenario } from './fixtures/scenarios';
import { runScenario } from './support/runScenario';
import { observe } from './support/observe';
import { classifyInference, inferenceFamilies } from './support/inferenceClassification';
import { phase0CallProjection } from './support/types';
import { syntheticIO } from './support/replayIO';
import { llmCall } from '../../utils/llmCall';
import { queueLocationEnrichment } from '../../services/locationEnrich';
import inventory from '../../../docs/architecture/inference-inventory.json';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('frontend inference inventory and canonical ledger', () => {
    it('has unique validated classifications and rejects unknown purposes', () => {
        expect(new Set(inferenceFamilies.map(f => f.operation)).size).toBe(inferenceFamilies.length);
        expect(inferenceFamilies.every(f => isInferenceClassification(f.classification))).toBe(true);
        expect(classifyInference('unknown')).toBeUndefined();
    });
    it('gates recognizable source sites against the reviewed development inventory', () => {
        expect(execFileSync(process.execPath, ['scripts/architecture/check-inference.mjs'], { encoding: 'utf8' })).toContain('Inference gate PASS');
    });
    it.each([
        ['gatherPlannerSceneIds', 'src/services/context-gatherer/archiveRecall.ts#facade.model.call:1', ['archive-planner']],
        ['gatherArchiveRecall', 'src/services/context-gatherer/archiveRecall.ts#facade.model.call:2', ['archive-funnel']],
        ['gatherRelationshipStances', 'src/services/turn/contextGatherer.ts#facade.model.call:1', ['npc-stance']],
        ['gatherMemoryRecallViaRole', 'src/services/turn/contextGatherer.ts#facade.model.call:2', ['archive-funnel']],
        ['runCommitPendingTurn', 'src/services/turn/pendingCommit.ts#facade.model.call:1', ['scene-stakes-classify']],
        ['runArchiveTrack importance callback', 'src/services/turn/postTurnPipeline.ts#facade.model.call:1', ['importance-rating']],
        ['runArchiveTrack bookkeeping callback', 'src/services/turn/postTurnPipeline.ts#facade.model.call:2', ['profile-scan', 'trait-scan', 'inventory-scan', 'location-scan']],
        ['brokerJsonCall', 'src/services/turn/tracks/npcTrack.ts#facade.model.call:1', ['npc-update', 'npc-drives-backfill']],
        ['runNPCTrack validator', 'src/services/turn/tracks/npcTrack.ts#facade.model.call:2', ['npc-validate']],
        ['runIntroEngineStage', 'src/services/turn/turnStages.ts#facade.model.call:1', ['character-intro']],
        ['runDirectorStage', 'src/services/turn/turnStages.ts#facade.model.call:2', ['director-brief']],
        ['runGenerationStage', 'src/services/turn/turnStages.ts#sendMessage:1', ['story-generation']],
        ['generateNPCPortrait', 'src/services/npc-generation/portrait.ts#llmFetch:1', ['scene-images']],
        ['native model.call broker', 'src/services/mods/modContext.ts#facade.model.call:1', ['extension-model-access']],
        ['native model.callJson broker', 'src/services/mods/modContext.ts#facade.model.callJson:1', ['extension-model-access']],
        ['sandbox model broker', 'src/services/mods/sandbox/sandboxHost.ts#facade.model.call:1', ['extension-model-access']],
    ])('registers the exact known families for %s', (_symbol, id, operations) => {
        expect(inventory.sites.find(site => site.id === id)?.operations).toEqual(operations);
    });
    it('keeps shared host and provider transports broader than one caller purpose', () => {
        for (const site of inventory.sites.filter(site => site.file === 'src/services/turn/hostFacade.ts')) {
            expect(site.operations).toEqual(expect.arrayContaining(['archive-funnel', 'npc-stance', 'profile-scan', 'extension-model-access']));
        }
        for (const site of inventory.sites.filter(site => site.file === 'src/services/llm/llmService.ts')) {
            expect(site.operations).toEqual(expect.arrayContaining(['story-generation', 'swipe-generation', 'ask-gm-handoff-summary', 'npc-update', 'unlabelled-manual-utilities']));
        }
        expect(inventory.sites.find(site => site.id === 'src/utils/llmCall.ts#llmFetch:1')?.operations)
            .toEqual(expect.arrayContaining(['director-brief', 'archive-planner', 'fact-clusterer', 'location-enrich', 'extension-model-access']));
    });
    it('describes queueLocationEnrichment as a void background launch', () => {
        expectTypeOf(queueLocationEnrichment).returns.toEqualTypeOf<void>();
        expect(classifyInference('location-enrich')).toMatchObject({ trigger: 'manual-utility', execution: 'background', blocking: 'nothing-user-visible' });
    });
    it('classifies real Pro Director/Story invocations in unchanged order and count', async () => {
        const { calls, result } = await runScenario(scenario('call-ledger-pro'));
        expect(calls.map(c => c.purpose)).toEqual(['director-brief', 'story-generation', 'director-brief', 'story-generation']);
        expect(calls.map(c => c.inference?.classification.role)).toEqual(['auxiliary', 'story', 'auxiliary', 'story']);
        expect(calls.map(c => c.inference?.classification.requirement)).toEqual(['optional', 'required-story-completion', 'optional', 'required-story-completion']);
        for (const c of calls) {
            expect(c.inference?.logicalInvocation).toBe(c.ordinal);
            expect(c.inference?.classification.blocking).toBe('visible-story');
            expect(c.attempts).toHaveLength(1);
            expect(phase0CallProjection(c)).not.toHaveProperty('inference');
        }
        expect(result.turns[0]['calls-and-tokens']).toMatchObject({ calls: [phase0CallProjection(calls[0]), phase0CallProjection(calls[1])] });
    });
    it('observes real planner, unlabeled intro, commit importance and background event helpers without adding calls', async () => {
        const o = observe();
        const contents = ['["000"]', 'Tavern', '4', '[]'];
        const dispatched: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async () => {
            o.dispatch();
            const c = o.current()!;
            dispatched.push(c.inference!.classification.operation);
            c.attempts.push({ ordinal: c.attempts.length + 1, stream: false, status: 200, error: null, request: null, usage: null });
            return Response.json({ choices: [{ message: { content: contents.shift() } }] });
        }));
        try {
            const provider = fixtureProvider();
            await runArchivePlanner(provider, 'Return to the tavern', [{ sceneId: '000', timestamp: 0, keywords: [], npcsMentioned: [], userSnippet: '', events: [{ eventType: 'discovery', importance: 3, text: 'Met Mira' }] }]);
            vi.spyOn(Math, 'random').mockReturnValue(0.99);
            const context = { ...fixtureContext(), npcIntroDC: 1, npcIntroEngineActive: true, npcIntroConfig: { initialDC: 1, dcReduction: 1, characters: [{ name: 'Mira', type: 'location' as const, location: 'Tavern', boostKeywords: [] }] } };
            await intro.rollCharacterIntroEngine(context, new Set(), [], provider);
            await rateImportance(provider, 'Hello', 'Mira bows');
            await extractSceneEvents(provider, 'Mira bows');
            expect(dispatched).toEqual(['archive-planner', 'character-intro', 'importance-rating', 'scene-event-extract']);
            expect(o.calls.map(c => c.inference?.classification.blocking)).toEqual(['visible-story', 'visible-story', 'turn-commit', 'nothing-user-visible']);
            expect(o.calls.map(c => c.inference?.classification.execution)).toEqual(['foreground', 'foreground', 'foreground', 'background']);
            expect(o.calls.map(c => c.inference?.classification.role)).toEqual(['utility', 'auxiliary', 'story', 'story']);
            expect(o.calls.every(c => c.attempts.length === 1)).toBe(true);
            expect(o.violations).toEqual([]);
        } finally { o.restore(); }
    });
    it('keeps retry attempts under the original classified invocation', async () => {
        const o = observe(), io = syntheticIO(o);
        io.begin({ deltas: ['Rain.'], attemptStatuses: [503, 200] });
        try {
            await llmCall(fixtureProvider(), 'Brief', { trackingLabel: 'director-brief' });
            expect(o.calls).toHaveLength(1);
            expect(o.calls[0].attempts.map(a => a.ordinal)).toEqual([1, 2]);
            expect(o.calls[0].attempts.map(a => a.status)).toEqual([503, 200]);
            expect(o.calls[0].inference).toMatchObject({ logicalInvocation: 1, classification: { operation: 'director-brief', requirement: 'optional' } });
        } finally { io.restore(); o.restore(); }
    });
    it('exposes manual/media/embedding/extension boundaries without certifying dynamic traffic', () => {
        expect(classifyInference('swipe-generation')).toMatchObject({ trigger: 'explicit-user-action', purpose: 'story', requirement: 'optional' });
        for (const operation of ['vision-describe', 'scene-images', 'speech', 'semantic-embeddings', 'extension-model-access']) {
            expect(inferenceFamilies.find(f => f.operation === operation)?.coverage).toBe('boundary');
        }
    });
});
