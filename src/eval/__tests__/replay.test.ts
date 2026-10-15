import { it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scenario } from './fixtures/scenarios';
import { scenarioIds } from './support/types';
import type { ScenarioId } from './support/types';
import { runScenario } from './support/runScenario';
import { canonical, compare } from './support/artifacts';
import { assertScenario } from './assertions';

const id = process.env.EVAL_SCENARIO as ScenarioId | undefined;
it.skipIf(!id)('replays real turns with separate normative assertions', async () => {
    const ids = id ? [id] : [...scenarioIds];
    expect(ids.every(x => scenarioIds.includes(x))).toBe(true);
    const allChecks = [];
    const errors: unknown[] = [];
    for (const selected of ids) {
        const f = scenario(selected);
        const { result } = await runScenario(f);
        const checks = assertScenario(result, f, errors);
        allChecks.push(...checks);
        if (process.env.EVAL_REPEAT === '1') {
            const repeated = await runScenario(f);
            const repeatedErrors: unknown[] = [];
            expect(assertScenario(repeated.result, f, repeatedErrors)).toEqual(checks);
            if (repeatedErrors.length) throw new AggregateError(repeatedErrors, 'Repeated run normative failure');
            expect(canonical(repeated.result)).toBe(canonical(result));
        }
        if (process.env.EVAL_OUTPUT) {
            const output = resolve(process.env.EVAL_OUTPUT);
            if (!output.startsWith(resolve('.eval-output') + '/') && !output.startsWith(resolve('.eval-output') + '\\')) throw new Error('Eval output must stay under .eval-output');
            mkdirSync(output, { recursive: true });
            writeFileSync(resolve(output, `${selected}.json`), canonical(result));
            writeFileSync(resolve(output, `${selected}.assertions.json`), canonical(checks));
            const baseline = resolve('eval/baselines/v0', `${selected}.json`);
            const comparison = existsSync(baseline) ? compare(JSON.parse(readFileSync(baseline, 'utf8')), result) : { status: 'REVIEW_REQUIRED', differences: [], reason: 'No approved baseline' };
            writeFileSync(resolve(output, `${selected}.comparison.json`), canonical(comparison));
        }
    }
    if (errors.length) throw new AggregateError(errors, `NORMATIVE FAIL: ${allChecks.filter(c => c.status === 'FAIL').map(c => c.id).join(', ')}`);
}, 60_000);
