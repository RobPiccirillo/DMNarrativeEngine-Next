import { it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { liveInputs, liveScenario, validateSmokeConfig } from './fixtures/liveSmoke';
import { runScenario } from './support/runScenario';
import { hash } from './support/artifacts';
import { measurements } from './support/observe';

it('runs exactly seven actual local-model turns, only with explicit configuration', async () => {
    if (process.env.EVAL_LIVE_OPT_IN !== '1' || !process.env.EVAL_LIVE_CONFIG) throw new Error('Explicit eval:live opt-in and config required');
    const config: unknown = JSON.parse(readFileSync(process.env.EVAL_LIVE_CONFIG, 'utf8'));
    validateSmokeConfig(config);
    const identity = {
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        harnessVersion: 'phase-0-v0',
        harnessHash: hash(['support/runScenario.ts', 'support/observe.ts', 'support/replayIO.ts', 'support/ollamaLive.ts', 'support/artifacts.ts', 'support/types.ts', 'fixtures/liveSmoke.ts', 'fixtures/scenarios.ts', 'liveSmoke.smoke.ts'].map(p => readFileSync(`src/eval/__tests__/${p}`, 'utf8')).join('\n')),
        lockfileHash: hash(readFileSync('package-lock.json')),
        scriptHash: hash(JSON.stringify(liveInputs)),
        environment: config.environment,
        transport: { apiFormat: config.provider.apiFormat ?? 'openai', think: config.provider.think ?? null },
        fixture: { mods: [], tier: 'lite', relationshipMemory: false, planner: false, syntheticApi: true },
        ceilings: config.ceilings,
        coverage: 'Frontend orchestration and actual local inference; synthetic campaign API. Excludes backend disk persistence, vector infrastructure, server NLP and its separate utility requests.',
    };
    mkdirSync('.eval-output/live', { recursive: true });
    for (const file of ['result.json', 'failure.json', 'progress.json']) if (existsSync(`.eval-output/live/${file}`)) unlinkSync(`.eval-output/live/${file}`);
    writeFileSync('.eval-output/live/manifest.json', JSON.stringify(identity, null, 2) + '\n');
    const turns: { ordinal: number; draftMs: number; commitMs: number }[] = [];
    const observations = { coherence: 'not_reviewed', correctionRetention: 'not_reviewed', secretHandling: 'not_reviewed', repetition: 'not_reviewed', agency: 'not_reviewed', ...config.observations };
    let partialCalls: unknown[] = [];
    try {
        const run = await runScenario(liveScenario(config), {
            live: { provider: { ...config.provider, maxOutputTokens: config.environment.outputLimit }, sampling: config.environment.sampling, ...config.ceilings },
            afterTurn: t => { turns.push(t); writeFileSync('.eval-output/live/progress.json', JSON.stringify({ turns }, null, 2) + '\n'); },
            captureCalls: (calls, timings) => { partialCalls = calls.map(c => ({ ...c, attempts: c.attempts.map((a, i) => ({ ...a, ...measurements(timings.get(c)![i]) })) })); },
        });
        const calls = run.calls.map(c => ({ ...c, attempts: c.attempts.map((a, i) => ({ ...a, ...measurements(run.timings.get(c)![i]) })) }));
        expect(turns).toHaveLength(7);
        expect(calls).toHaveLength(7);
        expect(calls.every(c => c.status === 'success')).toBe(true);
        writeFileSync('.eval-output/live/result.json', JSON.stringify({ status: 'complete', identity, turns, calls, observations, result: run.result, unexpectedCalls: calls.filter(c => c.purpose !== 'story-generation'), failures: calls.filter(c => c.status !== 'success') }, null, 2) + '\n');
    } catch (e) {
        writeFileSync('.eval-output/live/failure.json', JSON.stringify({ status: 'incomplete', identity, turns, calls: partialCalls, observations, failure: e instanceof Error ? e.message : 'smoke-failed' }, null, 2) + '\n');
        throw e;
    }
});

