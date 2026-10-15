import type { EndpointConfig, SamplingConfig } from '../../../types';
import { baseFixture, castFixture, fact, response } from './scenarios';
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
    provider: EndpointConfig;
    environment: {
        modelId: string; quantization: string; inferenceServer: string; serverVersion: string;
        contextWindow: number; outputLimit: number; sampling: SamplingConfig;
        cpu: string; ramGiB: number; gpu: string | null; vramGiB: number | null;
        offload: { mode: string; layers: number | null }; threads: number | null; batch: number | null;
        modelStatus: 'cold' | 'warm';
        endpointRoles: { story: 'local-story'; auxiliary: null; utility: null; summariser: null };
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
    if (!e || ![e.modelId, e.quantization, e.inferenceServer, e.serverVersion, e.cpu].every(string)) throw new Error('Missing model/server/hardware identity');
    if (![e.contextWindow, e.outputLimit, e.ramGiB, c.ceilings?.perCallMs, c.ceilings?.totalMs].every(positive)) throw new Error('Missing context/output/hardware/ceiling limits');
    if (e.outputLimit >= e.contextWindow || c.ceilings.perCallMs > c.ceilings.totalMs || c.ceilings.totalMs > 3_000_000) throw new Error('Invalid bounded smoke limits');
    if (!e.sampling || !Object.keys(e.sampling).length || Object.values(e.sampling).some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Sampling identity is required');
    if (e.sampling.max_tokens !== e.outputLimit) throw new Error('Sampling output limit must match environment');
    if (!(e.gpu === null || string(e.gpu)) || !optionalNumber(e.vramGiB) || !optionalNumber(e.threads) || !optionalNumber(e.batch)) throw new Error('Explicit hardware/thread/batch identity required');
    if (!e.offload || !string(e.offload.mode) || !optionalNumber(e.offload.layers) || (e.offload.mode !== 'cpu-only' && e.offload.layers === null)) throw new Error('Explicit offload identity required');
    if (!['cold', 'warm'].includes(e.modelStatus)) throw new Error('Cold/warm identity required');
    if (!e.endpointRoles || e.endpointRoles.story !== 'local-story' || e.endpointRoles.auxiliary !== null || e.endpointRoles.utility !== null || e.endpointRoles.summariser !== null || Object.keys(e.endpointRoles).length !== 4) throw new Error('Only the declared local Story role is available');
    if (!c.provider || c.provider.modelName !== e.modelId || (c.provider.apiFormat ?? 'openai') !== 'openai') throw new Error('Configure the named local model using its OpenAI-compatible base URL');
    const u = new URL(c.provider.endpoint);
    if (!['http:', 'https:'].includes(u.protocol) || !/^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname) || u.username || u.password || u.search || u.hash) throw new Error('Smoke endpoint must be a local inference base URL');
    if (c.observations && (Object.keys(c.observations).some(k => !['coherence', 'correctionRetention', 'secretHandling', 'repetition', 'agency'].includes(k)) || Object.values(c.observations).some(v => !string(v)))) throw new Error('Use explicit not_reviewed for unreviewed observations');
}

export function liveScenario(config: SmokeConfig): EvalScenario {
    return {
        id: 'manual-correction-retention', version: 1, seed: 12345,
        fixture: () => {
            const f = baseFixture(); f.npcs = castFixture();
            f.settings.contextLimit = config.environment.contextWindow;
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
