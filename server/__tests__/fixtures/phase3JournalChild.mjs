import fs from 'node:fs';
import path from 'node:path';
import { createLegacyAcceptanceJournal } from '../../services/legacyAcceptanceJournal.js';

const [directory, mode, killAt = ''] = process.argv.slice(2);
if (mode === 'recover') {
    Math.random = () => { throw new Error('recovery-must-not-reroll'); };
    globalThis.fetch = () => { throw new Error('recovery-must-not-call-provider'); };
}
let armed = false;
let reached = false;
const journal = createLegacyAcceptanceJournal({ directory, storageId: 'fixture', campaignInstance: 'isolated-instance',
    targets: { archive: '.archive.md', index: '.archive.index.json', entities: '.entities.json', chapters: '.archive.chapters.json',
        npcs: '.npcs.json', state: '.state.json', table: '.mod-arc-arcs.json' },
    boundary(point) {
        if (armed && !reached && point === killAt) {
            reached = true;
            process.send({ boundary: point });
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
    },
});
const request = { commandId: 'host-command', logicalKey: 'host-command', campaignInstance: 'isolated-instance', expectedHead: 'initial-head',
    semantic: { schema: 1, kind: 'story.accept', expectedHead: 'initial-head', revisionId: 'revision-fixture', selectedVersion: 'selection-fixture',
        text: 'Selected Story.\r\n', sourceText: 'Wait.', provenance: { origin: 'current-user-action', writer: 'host.acceptance' } },
};
if (!journal.load()) {
    fs.writeFileSync(path.join(directory, 'fixture.state.json'), JSON.stringify({ messages: [
        { id: 'old', content: 'Unrelated history retained.' }, { id: 'assistant', content: 'Selected Story.\r\n', pendingCommit: true },
    ], counter: 7, context: { lastSceneStakes: 'tense', agencyDigest: 'previous', travel: { leg: 1 } } }));
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ providers: [{ id: 'populated', endpoint: 'http://fixture.invalid/provider', modelName: 'configured-fixture', apiKey: 'synthetic-nonsecret-key' }] }));
    journal.initialize({ head: 'initial-head' });
}
armed = true;
const existing = journal.load().commands[0];
if (mode === 'recover' && !existing) {
    process.send({ result: 'ready-draft-no-intent' }); process.exit(0);
}
request.frozen = existing?.frozen ?? { draw: Math.random(), counterAfter: 8, timestamp: Date.now() };
const intent = journal.begin(request, () => {});
const sceneId = String(intent.sceneNumber).padStart(3, '0');
const planned = [
    { id: 'archive', target: 'archive', kind: 'archive-append', after: Buffer.from(`## SCENE ${sceneId}\n**[USER]**\nWait.\n**[GM]**\nSelected Story.\r\n\n---\n`) },
    { id: 'index', target: 'index', after: Buffer.from(JSON.stringify([{ sceneId, revisionId: 'revision-fixture', commandId: intent.commandId }])) },
    { id: 'entities', target: 'entities', after: Buffer.from(JSON.stringify([{ id: 'entity', firstSeen: sceneId }])) },
    { id: 'chapters', target: 'chapters', after: Buffer.from(JSON.stringify([{ chapterId: 'CH01', sceneIds: [sceneId], sceneCount: 1 }])) },
    { id: 'pressure-agency-repression', target: 'npcs', after: Buffer.from(JSON.stringify([{ id: 'npc', pressure: 1, agencyDraw: intent.frozen.draw, activity: 1, repressionPressure: 1 }])) },
    { id: 'compute-table', target: 'table', after: Buffer.from(JSON.stringify([{ id: 'arc', tick: 1 }])) },
    { id: 'state-link-counter', target: 'state', kind: 'json-fields', changes: [
        { path: ['messages', { id: 'assistant' }, 'sceneId'], after: { present: true, value: sceneId } },
        { path: ['messages', { id: 'assistant' }, 'revisionId'], after: { present: true, value: 'revision-fixture' } },
        { path: ['messages', { id: 'assistant' }, 'commandId'], after: { present: true, value: intent.commandId } },
        { path: ['messages', { id: 'assistant' }, 'pendingCommit'], after: { present: false } },
        { path: ['counter'], after: { present: true, value: intent.frozen.counterAfter } },
        { path: ['context', 'lastSceneStakes'], after: { present: true, value: 'calm' } },
        { path: ['context', 'agencyDigest'], after: { present: true, value: '' } },
        { path: ['context', 'travel'], after: { present: true, value: null } },
    ] },
];
if (intent.status !== 'completed') {
    for (let index = 0; index < planned.length; index++) {
        const plan = planned[index];
        if (!journal.load().commands[0].steps.some(step => step.id === plan.id)) {
            journal.prepare(intent.logicalKey, { ...plan, dependencies: index ? [planned[index - 1].id] : [] });
        }
        if (mode === 'partial-append' && plan.id === 'archive') {
            fs.appendFileSync(path.join(directory, 'fixture.archive.md'), plan.after.subarray(0, 29));
            process.send({ boundary: 'partial-append' });
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        journal.apply(intent.logicalKey, plan.id);
    }
    journal.complete(intent.logicalKey, planned.map(step => step.id), { revisionId: 'revision-fixture', hash: 'fixture-visible-hash', deterministicEffectsComplete: true });
}
if (mode !== 'no-ack') journal.acknowledge(intent.logicalKey, journal.load().commands[0].outcome.head);
process.send({ result: journal.load() });
process.exit(0);
