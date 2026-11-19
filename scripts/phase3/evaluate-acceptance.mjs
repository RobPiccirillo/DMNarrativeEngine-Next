import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readyLifecycle } from '../../server/__tests__/fixtures/lifecycleCampaign.js';
import { createAcceptanceCoordinator } from '../../server/services/acceptanceCoordinator.js';

const suite = 'phase-3-acceptance-v1';
const encode = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const files = [
    'server/__tests__/draftLifecycle.test.ts', 'server/__tests__/draftLifecycleRuntime.test.ts',
    'server/__tests__/acceptanceCoordinator.test.js', 'server/__tests__/legacyAcceptanceJournal.test.js',
    'server/__tests__/worldmapAcceptancePreparation.test.js', 'server/__tests__/worldmapPreparedRecovery.test.js',
    'server/__tests__/worldmapSourceBinding.test.js', 'server/__tests__/acceptanceAmbientWrites.test.js',
    'server/__tests__/legacyArchiveMaintenance.test.js', 'server/__tests__/lifecycleTransfer.test.js',
    'server/__tests__/campaignMigrationReview.test.js', 'src/services/turn/__tests__/baseAppGate/phase3AcceptanceGate.test.ts',
    'src/architecture/__tests__/worldmapAcceptanceBoundary.test.ts', 'src/architecture/__tests__/phase3FoundationBoundary.test.ts',
    'src/architecture/__tests__/phase3LifecycleBoundary.test.ts',
    'server/__tests__/lifecycleValidation.test.js', 'server/__tests__/backup.test.js',
    'src/services/turn/drafts/__tests__/assetAliases.test.tsx',
    'src/components/hooks/__tests__/managedHistoryMaintenance.test.ts',
    'server/__tests__/acceptanceArchiveEmbedding.test.js',
];
const groups = ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'];
const requireThat = (condition, code) => { if (!condition) throw new Error(code); };

async function projectScenario(root, fault) {
    const directory = path.join(root, fault ? 'fault' : 'normal', 'campaigns');
    const f = await readyLifecycle(directory);
    const boundaries = []; let armed = Boolean(fault);
    const options = { directory, authorityDirectory: path.join(root, 'authority') };
    const coordinator = createAcceptanceCoordinator({ ...options, boundary: point => {
        boundaries.push(point);
        if (armed && point === 'after-write:archive') { armed = false; throw new Error('recorded-write-response-lost'); }
    } });
    const preparation = await coordinator.preflight(f.id, f.candidate, f.view.saveToken.storageToken);
    let result;
    try { result = await coordinator.commit(f.id, { ticketId: preparation.ticketId, command: preparation.command, bundle: { groups } }); }
    catch (error) { requireThat(fault && error.message === 'recorded-write-response-lost', 'unexpected-scenario-failure'); }
    const pending = JSON.parse(f.read('.acceptance.json')).commands[0];
    if (fault) result = await createAcceptanceCoordinator(options).recover(f.id, pending.logicalKey);
    const duplicate = await createAcceptanceCoordinator(options).preflight(f.id, f.candidate, 'stale-historical-token');
    requireThat(encode(duplicate.outcome) === encode(result.outcome), 'historical-replay-changed-outcome');
    await createAcceptanceCoordinator(options).acknowledge(f.id, pending.logicalKey, result.outcome.head);
    const journal = JSON.parse(f.read('.acceptance.json')), command = journal.commands[0];
    requireThat(journal.commands.length === 1 && command.acknowledged && command.steps.every(step => step.status === 'applied'), 'incomplete-scenario');
    requireThat((f.read('.archive.md').toString().match(/^## SCENE /gm) ?? []).length === 1, 'duplicate-archive-prose');
    const aliases = new Map();
    const alias = (kind, value) => { const key = kind + ':' + value; if (!aliases.has(key)) aliases.set(key, kind + '-' + (1 + [...aliases.keys()].filter(key => key.startsWith(kind + ':')).length)); return aliases.get(key); };
    return { scenario: fault ? 'landed-write-response-loss' : 'normal-and-duplicate',
        command: alias('command', command.commandId), revision: alias('revision', command.frozen.candidate.revisionId),
        head: alias('head', command.resultingHead), status: command.status, acknowledged: command.acknowledged,
        steps: command.steps.map(step => ({ id: step.id, target: step.target, kind: step.kind, dependencies: step.dependencies,
            before: step.beforeVersion === 'absent' ? 'absent' : alias('version', step.beforeVersion), after: alias('version', step.afterVersion), status: step.status })),
        boundaries, repair: fault ? 'recorded-after-state-missing-receipt' : 'none', modelCalls: 0 };
}

async function runOnce(root, iteration) {
    const reportFile = path.join(root, `tests-${iteration}.json`);
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files, '--maxWorkers=1', '--reporter=json', `--outputFile=${reportFile}`],
        { encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, TZ: 'UTC', PHASE3_CAPTURE_BEFORE: '0' } });
    requireThat(fs.existsSync(reportFile), 'phase3-tests-did-not-produce-report');
    const tests = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    const cases = tests.testResults.flatMap(file => file.assertionResults.map(test => ({ file: path.relative(process.cwd(), file.name).replaceAll('\\', '/'), name: test.fullName, status: test.status })))
        .sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name));
    return { suite, status: run.status === 0 && tests.numFailedTests === 0 && cases.length > 0 ? 'PASS' : 'FAIL',
        tests: { passed: tests.numPassedTests, failed: tests.numFailedTests, pending: tests.numPendingTests, cases },
        scenarios: [await projectScenario(path.join(root, String(iteration)), false), await projectScenario(path.join(root, String(iteration)), true)],
        boundaries: { syntheticCampaignsOnly: true, providersUsed: false, liveSqliteUsed: false, authorityMoved: false },
        limitations: ['Source-specific static checks do not prove arbitrary JavaScript data flow.', 'Per-file reconciliation is not a cross-file transaction or an unconditional power-loss guarantee.'] };
}

export async function main(mode = 'compare') {
    requireThat(['compare', 'record', 'verify-determinism'].includes(mode), 'phase3-eval-mode-unsupported');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-eval-'));
    try {
        const first = await runOnce(root, 1);
        if (mode === 'verify-determinism') {
            const second = await runOnce(root, 2);
            first.determinism = encode(first) === encode(second) ? 'BYTE_STABLE' : 'CHANGED';
            if (first.determinism !== 'BYTE_STABLE') first.status = 'FAIL';
        }
        first.digest = sha(encode(first));
        const output = path.resolve('.eval-output', suite); fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'report.json'), encode(first));
        console.log(`${suite}: ${first.status}; ${first.tests.passed} passed; ${first.tests.failed} failed${first.determinism ? '; ' + first.determinism : ''}`);
        return first.status === 'PASS' ? 0 : 1;
    } finally {
        if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('phase3-eval-')) throw new Error('unsafe-eval-cleanup');
        fs.rmSync(root, { recursive: true, force: true });
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv[2]);
