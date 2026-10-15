import type { AppSettings, DivergenceEntry, NPCEntry } from '../../../types';
import type { EvalScenario, ScenarioId } from '../support/types';
import { fixtureContext, fixtureDivergenceRegister, fixtureSettings, FIXTURE_GM_COMPLETION, FIXTURE_USER_MESSAGE } from '../../../services/turn/__tests__/baseAppGate/fixture';

export function fact(id: string, text: string, extra: Partial<DivergenceEntry> = {}): DivergenceEntry {
    return { id, text, chapterId: 'CH01', category: 'world_state', sceneRef: '000', npcIds: [], pinned: false, source: 'auto', ...extra };
}

export function baseFixture() {
    return {
        context: fixtureContext(),
        settings: { ...fixtureSettings(), aiTier: 'lite', debugMode: true, enableArchivePlanner: false } as AppSettings,
        register: fixtureDivergenceRegister(),
        npcs: [] as NPCEntry[],
    };
}

export function castFixture() {
    return ['mira', 'aldric'].map(id => ({
        id, name: id === 'mira' ? 'Mira' : 'Aldric', aliases: '', tier: 'walkon',
        appearance: '', faction: '', storyRelevance: '', status: 'healthy', goals: '', voice: '', personality: '', exampleOutput: '', affinity: 0,
        disposition: 'neutral', traits: [], relations: {}, agencyLocked: true,
    } satisfies NPCEntry));
}

export function response(text: string) {
    const a = Math.floor(text.length / 3), b = Math.floor(text.length * 2 / 3);
    return { deltas: [text.slice(0, a), text.slice(a, b), text.slice(b)] };
}

export function scenario(id: ScenarioId): EvalScenario {
    const common = { id, version: 1 as const, seed: 12345 };
    switch (id) {
        case 'canonical-commit': return { ...common, fixture: baseFixture, turns: [{ input: FIXTURE_USER_MESSAGE, response: response(FIXTURE_GM_COMPLETION) }] };
        case 'stale-holder-supersession': return {
            ...common, fixture: () => { const f = baseFixture(); f.register.entries = [fact('holder-old', 'Mira holds the Moon Key.', { stateKey: 'item:moon-key:holder' })]; return f; },
            turns: [{ input: 'I check who currently carries the Moon Key before leaving.', response: response('Kaelen checks the Moon Key at his belt. Mira gathers her cloak.') }],
        };
        case 'scoped-secret-cast-change': return {
            ...common, fixture: () => {
                const f = baseFixture(); f.npcs = castFixture();
                f.settings.rulesBudgetPct = 0.10;
                f.register.entries = [fact('public-bridge', 'The east bridge is closed.'), fact('token-secret', 'The brass token opens the cellar.', { knownBy: ['npc:mira'] }), fact('hidden-seal', 'The cellar contains the royal seal.', { knownBy: [] }), fact('player-maker', 'The player recognizes the token’s maker.', { knownBy: ['player'] })];
                return f;
            }, turns: [
                { input: 'I ask Mira what the brass token is used for.', cast: ['mira'], response: response('Mira turns the token between two fingers and asks where you found it.') },
                { input: 'I ask Aldric whether the east bridge is open.', cast: ['aldric'], response: response('Aldric shakes his head. The east bridge remains closed.') },
            ],
        };
        case 'manual-correction-retention': return {
            ...common, fixture: () => { const f = baseFixture(); f.register.entries = [fact('bridge-status', 'The north bridge is open.')]; return f; },
            turns: [
                { input: 'I stop near the north bridge and inspect the road.', response: response('Rain gathers in the wheel ruts beside the north bridge.') },
                { input: 'I check the north bridge’s current status before choosing a route.', correction: true, response: response('The north bridge is closed. A barrier blocks the approach.') },
            ],
        };
        case 'call-ledger-pro': return {
            ...common, fixture: () => { const f = baseFixture(); f.settings.aiTier = 'pro'; return f; },
            turns: [
                { input: 'I inspect the courtyard gate before approaching the guardhouse.', response: response('The courtyard gate stands open. Rain darkens the guardhouse roof.') },
                { input: 'I wait beside the courtyard gate and watch the guardhouse.', response: response('A shutter opens above the guardhouse door, then closes again.') },
            ],
        };
    }
}
