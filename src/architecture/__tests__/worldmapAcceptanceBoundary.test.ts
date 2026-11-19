import { expect, it } from 'vitest';
import { scanWorldmapAcceptanceSource, checkWorldmapAcceptance } from '../../../scripts/architecture/worldmap-acceptance-boundary.mjs';

it('closes the reviewed source-specific world-map preparation boundary', () => {
    expect(checkWorldmapAcceptance(process.cwd())).toEqual([]);
});

it.each([
    ['public/bundled-mods/impostor/index.js', 'import { createWorldMapPreparation } from "../../../src/services/turn/acceptance/worldmapPreparation.js";'],
    ['public/bundled-mods/impostor/index.js', 'host.createWorldMapPreparation(command);'],
    ['src/services/mods/modContext.ts', 'createWorldMapPreparation(command);'],
    ['src/services/mods/modContext.ts', 'createPinnedWorldMapExports(provenance);'],
    ['src/services/mods/modContext.ts', 'installWorldMapPublication(command, callback);'],
    ['public/bundled-mods/worldmap/runtime.js', 'context.stageWrite(path, value);'],
    ['public/bundled-mods/worldmap/runtime.js', 'context.stageJson(path, value);'],
    ['public/bundled-mods/worldmap/runtime.js', 'const skipEffects = payload.skipEffects;'],
    ['public/bundled-mods/worldmap/runtime.js', 'const preparationCapability = manifest.capability;'],
    ['server/services/acceptanceCoordinator.js', 'function reconcile() { solver.solve(); }'],
    ['server/services/acceptanceCoordinator.js', 'function reconcile() { journal.prepareGroup(); }'],
    ['server/services/acceptanceCoordinator.js', 'function reconcile() { native.worldmap.storyRoute(); }'],
    ['server/services/acceptanceCoordinator.js', 'function reconcile() { Math.random(); }'],
])('rejects recognizable private-boundary bypass %s / %s', (file, source) => {
    expect(scanWorldmapAcceptanceSource(file, source).length).toBeGreaterThan(0);
});
