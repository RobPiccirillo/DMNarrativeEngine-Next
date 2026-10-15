import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ids = ['canonical-commit', 'stale-holder-supersession', 'scoped-secret-cast-change', 'manual-correction-retention', 'call-ledger-pro'];
const digest = data => createHash('sha256').update(data).digest('hex');
const read = file => readFileSync(file, 'utf8');
const json = file => JSON.parse(read(file));
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const serialize = v => JSON.stringify(stable(v), null, 2) + '\n';
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]).sort();
export const knownTargetViolations = json('src/eval/__tests__/fixtures/known-target-violations.json');

export function validateKnownViolationProvenance(baseline, current = knownTargetViolations) {
    if (current.version !== 1 || digest(serialize({ version: current.version, violations: current.violations })) !== current.reviewedHash) throw new Error('Known target violation disposition changed without review');
    if (baseline && serialize(baseline.knownTargetViolations ?? null) !== serialize(current)) throw new Error('Baseline known target violation provenance changed; disposition/baseline review required');
}

export function summarizeReports(reports) {
    if (reports.some(r => r.incomplete || r.normative.some(a => !['PASS', 'KNOWN_TARGET_VIOLATION'].includes(a.status)))) return 'FAIL';
    if (reports.some(r => r.behavioral.status === 'REVIEW_REQUIRED')) return 'REVIEW_REQUIRED';
    return reports.some(r => r.normative.some(a => a.status === 'KNOWN_TARGET_VIOLATION')) ? 'KNOWN_TARGET_VIOLATION' : 'MATCH';
}

export function exitFor(mode, status, deterministic, baselineStatus) {
    return status === 'FAIL' || !deterministic || (mode === 'compare' && baselineStatus !== 'VALID') ? 1 : 0;
}

export function manifestFor(output) {
    validateKnownViolationProvenance();
    const git = args => {
        const r = spawnSync('git', args, { encoding: 'utf8' });
        if (r.status !== 0) throw new Error('Git provenance unavailable');
        return r.stdout.trim();
    };
    const harness = [...files('src/eval'), resolve('scripts/run-eval.mjs'), resolve('vitest.eval.config.ts'), resolve('vitest.eval-live.config.ts')].sort();
    const treeHash = digest(harness.map(p => relative(process.cwd(), p).replaceAll('\\', '/') + '\n' + read(p)).join('\n'));
    const fixtures = [...files('src/eval/__tests__/fixtures'), resolve('src/services/turn/__tests__/baseAppGate/fixture.ts')].sort();
    return {
        schemaVersion: 0, suiteVersion: 'phase-0-v0', testedSourceCommit: git(['rev-parse', 'HEAD']),
        sourceWorkingTreeDiffHash: digest(git(['diff', '--binary', 'HEAD', '--', 'src', 'server', 'packages/engine', 'server.js'])),
        harnessRevision: `working-tree-sha256:${treeHash}`, harnessTreeHash: treeHash,
        lockfileHash: digest(readFileSync('package-lock.json')), fixtureHash: digest(fixtures.map(read).join('\n')),
        seed: 12345, environment: { node: process.version, vitest: json('node_modules/vitest/package.json').version, tokenizer: json('node_modules/js-tiktoken/package.json').version, timezone: 'UTC', locale: 'en_US.UTF-8' },
        scenarios: ids.map(id => ({ id, version: 1, hash: digest(readFileSync(resolve(output, `${id}.json`))) })),
        reviewState: 'candidate',
        knownTargetViolations,
    };
}

function worker(id, output, repeat) {
    mkdirSync(output, { recursive: true });
    for (const suffix of ['json', 'assertions.json', 'comparison.json']) {
        const path = resolve(output, `${id}.${suffix}`);
        if (existsSync(path)) unlinkSync(path);
    }
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.eval.config.ts'], {
        encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, TZ: 'UTC', LANG: 'en_US.UTF-8', CI: '1', EVAL_SCENARIO: id, EVAL_OUTPUT: output, EVAL_REPEAT: repeat ? '1' : '0' },
    });
    writeFileSync(resolve(output, `${id}.worker.log`), (result.stdout ?? '') + (result.stderr ?? ''));
    const resultPath = resolve(output, `${id}.json`), checksPath = resolve(output, `${id}.assertions.json`);
    const incomplete = !existsSync(resultPath) || !existsSync(checksPath);
    const checks = incomplete ? [] : json(checksPath);
    const comparisonPath = resolve(output, `${id}.comparison.json`);
    return { scenario: id, incomplete: incomplete || (result.status !== 0 && !checks.some(c => c.status === 'FAIL')), normative: checks, behavioral: existsSync(comparisonPath) ? json(comparisonPath) : { status: 'REVIEW_REQUIRED', differences: [] } };
}

export function main(args = process.argv.slice(2)) {
    const mode = args[0] ?? 'compare';
    if (!['compare', 'record', 'verify-determinism', 'live'].includes(mode)) throw new Error('Use compare, record, verify-determinism, or live');
    validateKnownViolationProvenance();
    if (existsSync('eval/baselines/v0/manifest.json')) validateKnownViolationProvenance(json('eval/baselines/v0/manifest.json'));
    if (mode === 'live') {
        if (args[1] !== '--config' || !args[2]) throw new Error('Live smoke requires --config <ignored-local-config>');
        const config = resolve(args[2]);
        const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', config]);
        if (ignored.status !== 0) throw new Error('Live configuration must be ignored by git');
        const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.eval-live.config.ts'], {
            stdio: 'inherit', env: { ...process.env, EVAL_LIVE_CONFIG: config, EVAL_LIVE_OPT_IN: '1', TZ: 'UTC' },
        });
        return run.status ?? 1;
    }
    const output = resolve('.eval-output', mode === 'verify-determinism' ? 'determinism-a' : 'current');
    const oldManifest = resolve(output, 'manifest.json');
    if (existsSync(oldManifest)) unlinkSync(oldManifest);
    const reports = ids.map(id => worker(id, output, mode === 'verify-determinism'));
    let deterministic = true;
    if (mode === 'verify-determinism') {
        const second = resolve('.eval-output/determinism-b');
        const again = ids.map(id => worker(id, second, true));
        for (const id of ids) {
            const a = resolve(output, `${id}.json`), b = resolve(second, `${id}.json`);
            const same = existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));
            deterministic &&= same;
            console.log(`${id} BYTE_STABLE ${same ? 'PASS' : 'FAIL'}`);
        }
        if (again.some(r => r.incomplete)) deterministic = false;
    }
    const status = summarizeReports(reports);
    let baselineStatus = 'UNPINNED';
    if (existsSync('eval/baselines/v0/manifest.json')) {
        const baseline = json('eval/baselines/v0/manifest.json');
        if (baseline.reviewState !== 'reviewed' || baseline.schemaVersion !== 0 || baseline.scenarios?.length !== ids.length) throw new Error('Invalid or unreviewed pinned baseline manifest');
        for (const id of ids) {
            const entry = baseline.scenarios.find(s => s.id === id);
            if (!entry || digest(readFileSync(`eval/baselines/v0/${id}.json`)) !== entry.hash) throw new Error(`Invalid baseline hash: ${id}`);
        }
        baselineStatus = 'VALID';
    }
    if (!reports.some(r => r.incomplete)) writeFileSync(resolve(output, 'manifest.json'), serialize(manifestFor(output)));
    const report = { status, baselineStatus, knownTargetViolations, ...(mode === 'verify-determinism' ? { deterministic } : {}), reports };
    mkdirSync('.eval-output', { recursive: true });
    writeFileSync('.eval-output/report.json', serialize(report));
    const lines = [`Eval v0: ${status}`, `Pinned baseline: ${baselineStatus}`, `Known target violation disposition: v${knownTargetViolations.version} ${knownTargetViolations.reviewedHash}`, ''];
    for (const r of reports) {
        lines.push(`${r.scenario}: ${r.incomplete ? 'INCOMPLETE' : r.behavioral.status}`);
        lines.push(...r.normative.map(a => `  ${a.status === 'KNOWN_TARGET_VIOLATION' ? 'KNOWN_TARGET_VIOLATION' : `NORMATIVE ${a.status}`} ${a.id}${a.rationale ? ` — ${a.rationale} [Phases ${a.responsiblePhases.join(', ')}]` : ''}`));
        lines.push(...r.behavioral.differences.map(d => `  BEHAVIORAL ${d.category} ${d.path}: ${JSON.stringify(d.old).slice(0, 120)} -> ${JSON.stringify(d.new).slice(0, 120)}`));
    }
    writeFileSync('.eval-output/report.md', lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    if (mode === 'record') console.log('Candidates only. No pinned baseline was overwritten.');
    return exitFor(mode, status, deterministic, baselineStatus);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { process.exitCode = main(); } catch (e) {
        mkdirSync('.eval-output', { recursive: true });
        writeFileSync('.eval-output/report.json', serialize({ status: 'FAIL', detail: e.message }));
        writeFileSync('.eval-output/report.md', `Eval v0: FAIL\n${e.message}\n`);
        console.error(e.message); process.exitCode = 1;
    }
}
