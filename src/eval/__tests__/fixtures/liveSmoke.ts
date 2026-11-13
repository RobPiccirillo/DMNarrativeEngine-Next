import type { SamplingConfig } from '../../../types';
import { ollamaLiveBody } from '../support/ollamaLive';
import type { SmokeProvider } from '../support/ollamaLive';
import { baseFixture, castFixture, fact, response, scenario } from './scenarios';
import type { EvalScenario } from '../support/types';

export const liveInputs = [
    'I enter the courtyard and look toward the guardhouse.',
    'I ask Mira whether the east bridge is open.',
    'I inspect the brass token without showing it to Aldric.',
    'I ask Aldric which road reaches the north bridge.',
    'I check the north bridge’s current status.',
    'I ask Mira who currently carries the Moon Key.',
    'I remain beside the courtyard gate and watch what happens next.',
] as const;

export type SmokeConfig = {
    inferenceProfileId?: 'current' | 'constrained-local-v1';
    runKind?: 'primary' | 'populated';
    provider: SmokeProvider;
    environment: {
        modelId: string; quantization: string; inferenceServer: string; serverVersion: string;
        contextWindow: number; outputLimit: number; sampling: SamplingConfig;
        cpu: string; ramGiB: number; gpu: string | null; vramGiB: number | null;
        offload: { mode: string; layers: number | null; gpuPercent?: number; cpuPercent?: number }; threads: number | null; batch: number | null;
        modelStatus: 'cold' | 'warm';
        endpointRoles: { story: 'local-story'; auxiliary: 'local-story' | null; utility: 'local-story' | null; summariser: null };
    };
    ceilings: { perCallMs: number; totalMs: number };
    observations?: { coherence: string; correctionRetention: string; secretHandling: string; repetition: string; agency: string };
};

export function validateSmokeConfig(value: unknown): asserts value is SmokeConfig {
    const c = value as SmokeConfig;
    const string = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && !/^(?:unknown|todo|replace|<)/i.test(v.trim());
    const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    const optionalNumber = (v: unknown) => v === null || positive(v) || v === 0;
    const e = c?.environment;
    if (c.runKind !== undefined && !['primary', 'populated'].includes(c.runKind)) throw new Error('Invalid live fixture');
    if (c.inferenceProfileId !== undefined && !['current', 'constrained-local-v1'].includes(c.inferenceProfileId)) throw new Error('Invalid inference profile');
    if (!e || ![e.modelId, e.quantization, e.inferenceServer, e.serverVersion, e.cpu].every(string)) throw new Error('Missing model/server/hardware identity');
    if (![e.contextWindow, e.outputLimit, e.ramGiB, c.ceilings?.perCallMs, c.ceilings?.totalMs].every(positive)) throw new Error('Missing context/output/hardware/ceiling limits');
    if (e.outputLimit >= e.contextWindow || c.ceilings.perCallMs > c.ceilings.totalMs || c.ceilings.totalMs > 3_000_000) throw new Error('Invalid bounded smoke limits');
    if (!e.sampling || !Object.keys(e.sampling).length || Object.values(e.sampling).some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Sampling identity is required');
    if (e.sampling.max_tokens !== e.outputLimit) throw new Error('Sampling output limit must match environment');
    if (!(e.gpu === null || string(e.gpu)) || !optionalNumber(e.vramGiB) || !optionalNumber(e.threads) || !optionalNumber(e.batch)) throw new Error('Explicit hardware/thread/batch identity required');
    const percentages = e.offload?.gpuPercent !== undefined || e.offload?.cpuPercent !== undefined;
    const validPercentages = percentages && [e.offload.gpuPercent, e.offload.cpuPercent].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)
        && e.offload.gpuPercent! + e.offload.cpuPercent! === 100;
    if (!e.offload || !string(e.offload.mode) || !optionalNumber(e.offload.layers) || (percentages && !validPercentages)
        || (e.offload.mode !== 'cpu-only' && e.offload.layers === null && !validPercentages)) throw new Error('Explicit offload identity required');
    if (!['cold', 'warm'].includes(e.modelStatus)) throw new Error('Cold/warm identity required');
    if (!e.endpointRoles || e.endpointRoles.story !== 'local-story' || e.endpointRoles.summariser !== null || Object.keys(e.endpointRoles).length !== 4) throw new Error('Only the declared local roles are available');
    if (c.runKind === 'populated') {
        if (e.endpointRoles.auxiliary !== 'local-story' || e.endpointRoles.utility !== 'local-story') throw new Error('Populated comparison requires explicit auxiliary and utility roles on the same local server');
    } else if (e.endpointRoles.auxiliary !== null || e.endpointRoles.utility !== null) throw new Error('Only the declared local Story role is available');
    if (!c.provider || c.provider.modelName !== e.modelId || !['openai', 'ollama'].includes(c.provider.apiFormat ?? 'openai')) throw new Error('Configure the named local model using openai or ollama mode');
    if (c.provider.think !== undefined && (c.provider.apiFormat !== 'ollama' || c.provider.think !== false)) throw new Error('Explicit think: false is supported only in native Ollama smoke mode');
    const u = new URL(c.provider.endpoint);
    if (!['http:', 'https:'].includes(u.protocol) || !/^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname) || u.username || u.password || u.search || u.hash) throw new Error('Smoke endpoint must be a local inference base URL');
    if (c.provider.apiFormat === 'ollama') {
        if (u.pathname.replace(/\/+$/, '') !== '') throw new Error('Native Ollama smoke endpoint must be the server root, without /v1 or /api/chat');
        ollamaLiveBody({ messages: [] }, c.provider, e.sampling);
    }
    if (c.observations && (Object.keys(c.observations).some(k => !['coherence', 'correctionRetention', 'secretHandling', 'repetition', 'agency'].includes(k)) || Object.values(c.observations).some(v => !string(v)))) throw new Error('Use explicit not_reviewed for unreviewed observations');
}

export function liveScenario(config: SmokeConfig): EvalScenario {
    if (config.runKind === 'populated') {
        const populated = scenario('constrained-populated-max');
        const turns = populated.turns.map(turn => ({ ...turn }));
        turns[1].input = 'I tell Mira I kept our bridge promise, apologize for leaving her waiting, and offer to stand watch while she rests.';
        turns[2].input = 'I walk with Aldric from the east bridge gate to the guardhouse doorway in the same courtyard and wait outside.';
        turns[3].input = 'I ask Mira at the guardhouse doorway how she felt about my apology and offer to stand watch.';
        return { ...populated, turns, fixture: () => {
            const f = populated.fixture();
            f.settings = { ...f.settings, contextLimit: config.environment.contextWindow, inferenceProfileId: config.inferenceProfileId ?? 'current' };
            f.context = { ...f.context, currentPlaceId: 'quality-courtyard', currentFeature: 'east bridge gate', worldDay: 1,
                starter: 'You stand beside the east bridge gate in the courtyard. The guardhouse doorway is a few paces away.',
                sceneNote: 'The gate approach remains visible from the guardhouse doorway. Honor voluntary player movement and established NPC boundaries.' };
            return { ...f, locationLedger: [{ id: 'quality-courtyard', name: 'Bridge Courtyard', aliases: 'courtyard', broadLocation: 'east bridge approach',
                knowledge: 'visited', features: ['east bridge gate', 'guardhouse doorway'], connections: [],
                description: 'The guardhouse doorway stands a few paces from the gate; both share the same courtyard.', firstSeenScene: '000', lastSeenScene: '000', source: 'manual' }] };
        } };
    }
    return {
        id: 'manual-correction-retention', version: 1, seed: 12345,
        fixture: () => {
            const f = baseFixture(); f.npcs = castFixture();
            f.settings.contextLimit = config.environment.contextWindow;
            if (config.inferenceProfileId) f.settings.inferenceProfileId = config.inferenceProfileId;
            f.context.starter = 'You stand in a rain-darkened courtyard beside its gate and guardhouse.';
            f.context.canonState = 'The courtyard adjoins the east and north roads.';
            f.register.entries = [fact('bridge-status', 'The north bridge is open.'), fact('east-bridge', 'The east bridge is closed.'), fact('holder-new', 'Kaelen holds the Moon Key.'), fact('token-secret', 'The brass token opens the cellar.', { knownBy: ['npc:mira'] }), fact('hidden-seal', 'The cellar contains the royal seal.', { knownBy: [] })];
            return {
                ...f, chapterTitle: 'The Courtyard', archiveSource: 'I approach the courtyard gate.\nRain falls between the courtyard gate and guardhouse.',
                history: [
                    { id: 'hist-user-1', role: 'user' as const, content: 'I approach the courtyard gate.', timestamp: 1 },
                    { id: 'hist-gm-1', role: 'assistant' as const, content: 'Rain falls between the courtyard gate and guardhouse.', timestamp: 2, sceneId: '000' },
                ],
            };
        },
        turns: liveInputs.map((input, i) => ({ input, response: response(''), correction: i === 4, cast: i === 1 || i === 5 ? ['mira'] : ['aldric'] })),
    };
}
