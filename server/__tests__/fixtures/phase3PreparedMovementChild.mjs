import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks, syncBuiltinESMExports } from 'node:module';

const [directory, killAt = ''] = process.argv.slice(2);
crypto.randomUUID = () => { throw new Error('recovery-id-allocation'); };
crypto.randomBytes = () => { throw new Error('recovery-random-bytes'); };
syncBuiltinESMExports();
Math.random = () => { throw new Error('recovery-random-draw'); };
Date.now = () => { throw new Error('recovery-clock'); };
globalThis.fetch = () => { throw new Error('recovery-model-or-native-request'); };
registerHooks({ resolve(specifier, context, next) {
    if (/worldmap|prepareEffects|llm|solver|nativeLoader/i.test(specifier)) throw new Error('forbidden-recovery-dependency:' + specifier);
    return next(specifier, context);
} });
const { createLegacyAcceptanceJournal } = await import('../../services/legacyAcceptanceJournal.js');
const targets = JSON.parse(fs.readFileSync(path.join(directory, 'targets.json'), 'utf8'));
let reached = false;
const journal = createLegacyAcceptanceJournal({ directory, storageId: 'fixture', campaignInstance: 'movement-instance', targets,
    boundary(point) { if (!reached && point === killAt) { reached = true; process.send({ boundary: point }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); } },
});
const command = journal.load().commands[0];
if (!command.effectGroup || command.steps.length !== command.effectGroup.stepIds.length) throw new Error('missing-durable-effect-group');
if (command.status !== 'completed') {
    for (const step of command.steps) journal.apply(command.logicalKey, step.id);
    journal.complete(command.logicalKey, command.effectGroup.stepIds, { deterministicEffectsComplete: true, sceneId: '001' });
}
journal.acknowledge(command.logicalKey, command.resultingHead);
process.send({ completed: true });
