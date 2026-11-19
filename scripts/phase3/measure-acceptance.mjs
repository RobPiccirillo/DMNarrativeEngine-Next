import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { readyLifecycle } from '../../server/__tests__/fixtures/lifecycleCampaign.js';
import { createAcceptanceCoordinator } from '../../server/services/acceptanceCoordinator.js';
import { acceptanceCandidate } from '@narrative/engine/contracts/draftLifecycle';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-operations-'));
const quantiles = values => { const sorted = [...values].sort((a, b) => a - b); return { samples: values.length,
    p50Ms: +sorted[Math.ceil(sorted.length * .5) - 1].toFixed(3), p95Ms: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(3) }; };
const groups = ['stakes', 'prologue', 'pressure', 'location', 'agency', 'repression', 'bookkeeping', 'travel', 'compute'];
try {
    // Execute the exact pre-change JSON writer from HEAD in synthetic storage.
    // This compares persistence primitives, not an invented full old app run.
    const source = execFileSync('git', ['show', 'HEAD:server/lib/fileStore.js'], { encoding: 'utf8' });
    const ast = ts.createSourceFile('before.js', source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'writeJson');
    if (!declaration) throw new Error('missing-pre-change-writer');
    const beforeWrite = Function('fs', declaration.getText(ast).replace(/^export\s+/, '') + '; return writeJson;')(fs);
    const primitive = { before: [], durable: [] };
    const { publishDurable } = await import('../../server/lib/durablePublication.js');
    const sample = { payload: 'synthetic'.repeat(8192) }, bytes = Buffer.from(JSON.stringify(sample, null, 2));
    for (let index = 0; index < 16; index++) {
        let start = performance.now(); beforeWrite(path.join(root, 'before.json'), sample); primitive.before.push(performance.now() - start);
        start = performance.now(); publishDurable(path.join(root, 'after.json'), bytes); primitive.durable.push(performance.now() - start);
    }
    const campaigns = [];
    for (const fixture of [{ scenes: 0 }, { scenes: 10 }, { scenes: 250 }, { scenes: 250, revisions: 12, npcs: 100 }]) {
        const sceneCount = fixture.scenes;
        const directory = path.join(root, 'fixture-' + sceneCount + '-' + (fixture.revisions ?? 1), 'campaigns'); fs.mkdirSync(directory, { recursive: true });
        if (sceneCount) {
            const ids = Array.from({ length: sceneCount }, (_, index) => String(index + 1).padStart(3, '0'));
            fs.writeFileSync(path.join(directory, 'source.archive.md'), ids.map(id => `## SCENE ${id}\n*date*\n\n**[USER]**\nSynthetic input\n\n**[GM]**\n${'Synthetic history. '.repeat(200)}\n\n---\n`).join(''));
            fs.writeFileSync(path.join(directory, 'source.archive.index.json'), JSON.stringify(ids.map(sceneId => ({ sceneId }))));
        }
        const f = await readyLifecycle(directory), durations = [], recovery = [], journalSizes = [];
        let initialView = f.view;
        for (let index = 1; index < (fixture.revisions ?? 1); index++) {
            const set = initialView.document.sets[0];
            initialView = await f.service.transition(f.id, { action: 'edit', setId: set.id, parentRevisionId: set.selectedRevisionId,
                expectedVersion: initialView.version, text: `Selected Story ${index}. ` + 'Synthetic draft. '.repeat(128) });
        }
        if (fixture.npcs) {
            f.write('.npcs.json', Array.from({ length: fixture.npcs }, (_, index) => ({ id: `npc-${index}`, name: `Synthetic ${index}`, populated: true, goals: 'Synthetic goal' })));
        }
        const initialSet = initialView.document.sets[0], initialStory = initialSet.revisions.find(revision => revision.id === initialSet.selectedRevisionId).text;
        const mirror = JSON.parse(f.read('.state.json')); mirror.messages[1].content = initialStory; f.write('.state.json', mirror);
        let publications = 0, publicationBytes = 0;
        const options = { directory, authorityDirectory: path.join(root, 'authority') };
        const coordinator = createAcceptanceCoordinator({ ...options, boundary: point => {
            if (point === 'journal:renamed') { publications++; publicationBytes += fs.statSync(path.join(directory, 'source.acceptance.json')).size; }
        } });
        let candidate = acceptanceCandidate(initialSet, initialStory), token = initialView.saveToken.storageToken;
        for (let index = 0; index < 12; index++) {
            if (index) {
                const state = JSON.parse(f.read('.state.json')), user = `user-${index}`, assistant = `assistant-${index}`;
                state.messages.push({ id: user, role: 'user', content: 'Wait.', timestamp: 1 }, { id: assistant, role: 'assistant', content: 'Selected Story.', timestamp: 2 }); f.write('.state.json', state);
                const begun = await f.service.transition(f.id, { action: 'begin', kind: 'initial', profileId: 'current', sourceMessageId: user, assistantMessageId: assistant, archivedUserText: 'Wait.' });
                const finished = await f.service.transition(f.id, { action: 'finish', setId: begun.document.activeSetId, attemptId: begun.attempt.id, status: 'completed', text: 'Selected Story.', expectedVersion: begun.version });
                candidate = acceptanceCandidate(finished.document.sets.at(-1), 'Selected Story.'); token = finished.saveToken.storageToken;
            }
            let start = performance.now();
            const prepared = await coordinator.preflight(f.id, candidate, token);
            const result = await coordinator.commit(f.id, { ticketId: prepared.ticketId, command: prepared.command, bundle: { groups } });
            await coordinator.acknowledge(f.id, result.logicalKey, result.outcome.head);
            durations.push(performance.now() - start); journalSizes.push(f.read('.acceptance.json').length);
            start = performance.now(); await createAcceptanceCoordinator(options).recover(f.id, result.logicalKey); recovery.push(performance.now() - start);
        }
        campaigns.push({ startingScenes: sceneCount, startingDraftRevisions: fixture.revisions ?? 1, npcReadDependencies: fixture.npcs ?? 0,
            acceptance: quantiles(durations), completedRestartLookup: quantiles(recovery),
            journalBytesAfterFirst: journalSizes[0], journalBytesAfterTwelve: journalSizes.at(-1), journalPublications: publications,
            journalBytesRewritten: publicationBytes, archiveBytes: f.read('.archive.md').length, stateBytes: f.read('.state.json').length });
    }
    const result = { suite: 'phase-3-operations-v1', platform: process.platform, node: process.version,
        persistencePrimitive: { payloadBytes: bytes.length, preChangeHeadWriteJson: quantiles(primitive.before), durablePublication: quantiles(primitive.durable) }, campaigns,
        limitations: ['Synthetic fixtures on this machine; twelve host-coordinator acceptances per campaign, not a universal latency bound. Provider/private-domain preparation time is excluded.',
            'Pre-change comparison executes the exact HEAD JSON writer; it is not a full pre-change UI timing.',
            'Whole-file lifecycle/journal rewrites grow with retained commands. Phase 4 storage remains deferred.',
            'Windows directory fsync is best effort; no cross-file transaction or unconditional power-loss guarantee.'],
        boundaries: { realCampaignsUsed: false, modelCalls: 0, liveSqliteUsed: false, authorityMoved: false } };
    const output = path.resolve('docs/eval/phase-3'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'operations-validation.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
} finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('phase3-operations-')) throw new Error('unsafe-operations-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
}
