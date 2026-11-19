import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const phase3RequiredGuards = new Map([
    ['server/services/acceptanceCoordinator.js', ['historical(opened, candidate)', "fail('stale-storage-scope')", 'saved.versions', 'ticket.versions', 'ticket.loreVersion', 'journal.prepareGroup(', 'missing-durable-prepared-effect-group', 'generationPosition: saved.generationPosition']],
    ['server/services/managedStateSave.js', ['managed-state-token-required', 'managed-state-version-conflict', 'managed-revision-text-conflict', 'managed-host-field-conflict']],
    ['server/lib/acceptanceWriteGuard.js', ['new AsyncLocalStorage()', 'verifyRequestScope(directory, id, request.token)', 'managed-write-token-required', 'archive-maintenance-recovery-required', 'raw-managed-archive-write-rejected']],
    ['src/store/campaignStateTransport.ts', ['captured.head !== current.head', 'captured.storageToken !== current.storageToken', 'if (!response.ok)', 'resourceFailures', 'X-Phase3-State-Token']],
    ['src/services/turn/acceptance/runtime.ts', ['drainStateSaves(id)', "'prepare'", "'commit'", "'publication'", "'acknowledge'", 'installWorldMapPublication']],
    ['src/services/turn/acceptance/prepareEffects.ts', ['recordedTurnInputs(preparation.turnInputs)', 'requiredWriterFailure', 'readLiveVersion() !== liveVersion', 'await worldmap?.close()']],
    ['server/services/legacyLifecycleTransfer.js', ['validateLifecycleSources', 'recover-and-acknowledge-before-playable-import-or-restore', 'before-scope-marker', 'storageGuard: { ...guard, phase:']],
    ['src/services/turn/tracks/sequential/locationHeaderTrack.ts', ['ctx.effects.generationPosition', 'generationPosition !== movementPositionKey(sNow.context)']],
    ['src/services/turn/drafts/runtime.ts', ['ownsDraftDisplay', 'set.selectionVersion === handle.selectionVersion', 'displayEpochs']],
    ['server/services/acceptanceArchiveEmbedding.js', ["recordDerivedRecall(logicalKey, 'pending', 'dispatched')", 'source.storageToken', 'source.step.originalLength', 'vector.storeArchiveEmbedding']],
]);

export function scanPhase3LifecycleSource(file, source) {
    const errors = [];
    for (const guard of phase3RequiredGuards.get(file) ?? []) if (!source.includes(guard)) errors.push(`${file}: missing managed lifecycle guard: ${guard}`);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
        if (ts.isImportSpecifier(node) && node.propertyName?.text === 'campaignResourceRequest' && node.name.text !== 'campaignResourceRequest') errors.push(`${file}: checked writer alias is outside the recognized inventory`);
        if (file === 'src/services/turn/acceptance/runtime.ts' && ts.isCallExpression(node) && /api\.archive\.append|runPostTurnPipeline/.test(node.expression.getText(tree))) errors.push(`${file}: managed acceptance bypass`);
        if (file === 'server/services/acceptanceCoordinator.js' && ts.isStringLiteral(node) && /(?:migrationStaging|campaignMigration|better-sqlite3|\/db\/)/.test(node.text)) errors.push(`${file}: acceptance depends on staging/authority migration`);
        ts.forEachChild(node, visit);
    }
    visit(tree); return errors;
}
export function checkPhase3Lifecycle(root, scans = []) {
    const files = new Set([...phase3RequiredGuards.keys(), ...scans.map(scan => scan.file)]);
    return [...files].flatMap(file => scanPhase3LifecycleSource(file, fs.readFileSync(path.join(root, file), 'utf8')));
}
