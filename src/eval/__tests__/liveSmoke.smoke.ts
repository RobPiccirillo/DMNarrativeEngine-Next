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
    const populated = config.runKind === 'populated';
    const output = populated ? `.eval-output/phase-1l-quality-${config.inferenceProfileId ?? 'current'}` : config.inferenceProfileId === 'constrained-local-v1' ? '.eval-output/phase-1l-live' : '.eval-output/live';
    const identity = {
        inferenceProfileId: config.inferenceProfileId ?? 'current', runKind: config.runKind ?? 'primary',
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        harnessVersion: 'phase-0-v0',
        harnessHash: hash(['support/runScenario.ts', 'support/observe.ts', 'support/replayIO.ts', 'support/ollamaLive.ts', 'support/artifacts.ts', 'support/types.ts', 'fixtures/liveSmoke.ts', 'fixtures/scenarios.ts', 'liveSmoke.smoke.ts'].map(p => readFileSync(`src/eval/__tests__/${p}`, 'utf8')).join('\n')),
        lockfileHash: hash(readFileSync('package-lock.json')),
        scriptHash: hash(JSON.stringify(populated ? liveScenario(config).turns.map(t => t.input) : liveInputs)),
        environment: config.environment,
        transport: { apiFormat: config.provider.apiFormat ?? 'openai', think: config.provider.think ?? null },
        fixture: { mods: [], tier: populated ? 'max' : 'lite', relationshipMemory: populated, planner: populated, syntheticApi: true },
        ceilings: config.ceilings,
        coverage: 'Frontend orchestration and actual local inference; synthetic campaign API. Excludes backend disk persistence, vector infrastructure, server NLP and its separate utility requests.',
    };
    mkdirSync(output, { recursive: true });
    for (const file of ['result.json', 'failure.json', 'progress.json']) if (existsSync(`${output}/${file}`)) unlinkSync(`${output}/${file}`);
    writeFileSync(`${output}/manifest.json`, JSON.stringify(identity, null, 2) + '\n');
    const turns: Parameters<NonNullable<import('./support/runScenario').RunOptions['afterTurn']>>[0][] = [];
    const observations = { coherence: 'not_reviewed', correctionRetention: 'not_reviewed', secretHandling: 'not_reviewed', repetition: 'not_reviewed', agency: 'not_reviewed', ...config.observations };
    let partialCalls: unknown[] = [];
    try {
        const run = await runScenario(liveScenario(config), {
            inferenceProfileId: config.inferenceProfileId, utilityAvailable: populated,
            live: { provider: { ...config.provider, maxOutputTokens: config.environment.outputLimit }, sampling: config.environment.sampling, allowAuxiliary: populated && config.inferenceProfileId !== 'constrained-local-v1', ...config.ceilings },
            afterTurn: t => { turns.push(t); writeFileSync(`${output}/progress.json`, JSON.stringify({ turns }, null, 2) + '\n'); },
            captureCalls: (calls, timings) => { partialCalls = calls.map(c => ({ ...c, attempts: c.attempts.map((a, i) => ({ ...a, ...measurements(timings.get(c)![i]), window: timings.get(c)![i] })) })); },
        });
        const calls = run.calls.map(c => ({ ...c, attempts: c.attempts.map((a, i) => ({ ...a, ...measurements(run.timings.get(c)![i]), window: run.timings.get(c)![i] })) }));
        expect(turns).toHaveLength(populated ? 6 : 7);
        if (!populated || config.inferenceProfileId === 'constrained-local-v1') expect(calls).toHaveLength(populated ? 6 : 7);
        expect(calls.every(c => c.status === 'success')).toBe(true);
        writeFileSync(`${output}/result.json`, JSON.stringify({ status: 'complete', identity, turns, calls, observations, result: run.result, unexpectedCalls: calls.filter(c => !c.inference || (!populated && c.purpose !== 'story-generation')), failures: calls.filter(c => c.status !== 'success') }, null, 2) + '\n');
    } catch (e) {
        writeFileSync(`${output}/failure.json`, JSON.stringify({ status: 'incomplete', identity, turns, calls: partialCalls, observations, failure: e instanceof Error ? e.message : 'smoke-failed' }, null, 2) + '\n');
        throw e;
    }
});

