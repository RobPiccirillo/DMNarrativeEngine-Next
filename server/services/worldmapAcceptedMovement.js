import { semanticBytes } from './legacyAcceptanceJournal.js';

export const worldmapMovementTables = Object.freeze(['anchors', 'settings', 'visited', 'journey', 'position', 'trails', 'discoveries', 'encounters', 'exploration']);
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = () => { throw Object.assign(new Error('invalid-worldmap-accepted-movement'), { statusCode: 409 }); };
const cell = value => object(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));

export function validateWorldmapMovement(result, command, inputs) {
    semanticBytes(result);
    if (!keys(result, ['format', 'commandId', 'campaignInstance', 'revisionId', 'hash', 'inputs', 'tables', 'routes', 'solverAfter'])
        || result.format !== 'worldmap-accepted-movement-v1' || result.commandId !== command.commandId
        || result.campaignInstance !== command.campaignInstance || result.revisionId !== command.payload.revisionId || result.hash !== command.payload.hash
        || semanticBytes(result.inputs) !== semanticBytes(inputs) || !object(result.tables) || !Array.isArray(result.routes)) fail();
    if (!keys(result.solverAfter, ['format', 'campaignId', 'transects', 'preference']) || result.solverAfter.format !== 'worldmap-solver-input-v1'
        || (result.solverAfter.transects !== null && !Array.isArray(result.solverAfter.transects))) fail();
    for (const [name, value] of Object.entries(result.tables)) {
        if (!worldmapMovementTables.includes(name)) fail();
        if (['anchors', 'visited'].includes(name)) {
            if (!Array.isArray(value) || !value.every(row => cell(row) && (name !== 'visited' || typeof row.biome === 'string'))) fail();
        } else if (name === 'settings') {
            if (!keys(value, ['worldSeed', 'worldProfile', 'climateGradient', 'layers']) || typeof value.worldSeed !== 'string' || !value.worldSeed
                || !Number.isFinite(value.climateGradient) || value.climateGradient < 0 || value.climateGradient > 1 || !object(value.layers)) fail();
        } else if (name === 'journey') {
            if (!object(value) || (Object.keys(value).length && (typeof value.id !== 'string' || typeof value.fromId !== 'string'
                || typeof value.toId !== 'string' || !Array.isArray(value.cells) || !value.cells.every(cell)
                || !Array.isArray(value.checkpoints) || !value.checkpoints.every(cell) || !Number.isFinite(value.totalLegs)))) fail();
        } else if (name === 'position') {
            if (!cell(value) || typeof value.placeId !== 'string') fail();
        } else if (name === 'trails') {
            if (!keys(value, ['edges', 'progress']) || !Array.isArray(value.edges) || !value.edges.every(edge => cell(edge.a) && cell(edge.b) && Number.isSafeInteger(edge.passes) && edge.passes >= 0)) fail();
        } else if (name === 'discoveries') {
            if (!keys(value, ['sites', 'surveyed']) || !Array.isArray(value.sites) || !value.sites.every(site => cell(site) && typeof site.id === 'string') || !Array.isArray(value.surveyed)) fail();
        } else if (name === 'encounters') {
            if (!keys(value, ['records']) || !Array.isArray(value.records) || !value.records.every(row => cell(row) && typeof row.key === 'string' && Number.isFinite(row.worldDay))) fail();
        } else if (name === 'exploration') {
            if (!keys(value, ['version', 'cells', 'generatedCells']) || value.version !== 2 || !Array.isArray(value.cells) || !Array.isArray(value.generatedCells)
                || ![...value.cells, ...value.generatedCells].every(key => typeof key === 'string' && /^\d+,\d+$/.test(key))) fail();
        }
    }
    for (const route of result.routes) {
        if (!keys(route, ['request', 'result']) || !keys(route.request, ['campaignId', 'fromId', 'toId', 'worldDay', 'mode', 'expiresAt'])
            || (route.result !== null && (!Array.isArray(route.result) || !route.result.every(hop => typeof hop.fromId === 'string'
                && typeof hop.toId === 'string' && Number.isSafeInteger(hop.legs) && hop.legs > 0)))) fail();
    }
    return result;
}
