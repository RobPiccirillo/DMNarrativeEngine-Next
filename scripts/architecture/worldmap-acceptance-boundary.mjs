import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const seam = 'src/services/turn/acceptance/worldmapPreparation.js';
const loader = 'src/services/mods/native/nativeLoader.ts';
const prepare = 'src/services/turn/acceptance/prepareEffects.ts';
const runtime = 'src/services/turn/acceptance/runtime.ts';
const permitted = new Set([seam, loader, prepare, runtime]);
const creators = new Map([
    ['createWorldMapPreparation', new Set([seam, prepare])],
    ['createPinnedWorldMapExports', new Set([seam, loader])],
    ['installWorldMapPublication', new Set([seam, runtime])],
]);

export function scanWorldmapAcceptanceSource(file, source) {
    const errors = [], tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const error = code => errors.push(`${file}: ${code}`);
    function visit(node) {
        if (ts.isStringLiteral(node) && /worldmapPreparation(?:\.js)?$/.test(node.text) && !permitted.has(file)) error('private-worldmap-import');
        if (ts.isCallExpression(node)) {
            const name = node.expression.getText(tree).split('.').at(-1);
            if (creators.has(name) && !creators.get(name).has(file)) error('unauthorized-worldmap-scope-owner');
        }
        if (file.startsWith('public/bundled-mods/') && ts.isIdentifier(node)
            && /^(preparationCapability|skipEffects|stageWrite|stageJson|preparationMode|createWorldMapPreparation)$/.test(node.text)) error('public-worldmap-authority-surface');
        if (file === 'server/services/acceptanceCoordinator.js' && ts.isFunctionDeclaration(node) && node.name?.text === 'reconcile') {
            const body = node.body.getText(tree);
            if (/prepareGroup|\.prepare\(|freshCampaignContext|worldmap|solver|\.model\.|Math\.random|randomUUID|Date\.now|embedText|dispatchArchiveEmbedding/i.test(body.replace(/worldmapProjection/g, 'projection'))) error('recovery-executes-preparation');
        }
        ts.forEachChild(node, visit);
    }
    visit(tree);
    return errors;
}

function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (['node_modules', '__tests__', 'dist', '.git'].includes(entry.name)) return [];
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? files(file) : /\.(js|mjs|ts|tsx)$/.test(entry.name) ? [file] : [];
    });
}

export function checkWorldmapAcceptance(root) {
    const errors = [];
    for (const dir of ['src', 'server', 'public/bundled-mods', 'mods']) {
        if (!fs.existsSync(path.join(root, dir))) continue;
        for (const absolute of files(path.join(root, dir))) errors.push(...scanWorldmapAcceptanceSource(path.relative(root, absolute).replaceAll('\\', '/'), fs.readFileSync(absolute, 'utf8')));
    }
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'src/services/turn/acceptance/worldmapSource.json'), 'utf8'));
    const directory = path.join(root, 'public/bundled-mods/worldmap');
    const actual = Object.fromEntries(fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')]));
    if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(expected).sort())) errors.push('application worldmap source fingerprint changed without reviewed binding update');
    const privateSource = fs.readFileSync(path.join(root, seam), 'utf8');
    for (const required of ['new WeakMap()', 'isLegacyAcceptanceCommand(command)', 'tables.includes(name)', 'locationFields.has(key)', 'scope.active = false', '../../../../public/bundled-mods/worldmap/runtime.js']) {
        if (!privateSource.includes(required)) errors.push(`private worldmap seam lost required containment: ${required}`);
    }
    for (const file of ['src/services/mods/modContext.ts', 'server/lib/modLoader.js', 'public/bundled-mods/worldmap/manifest.json']) {
        if (/worldmapPreparation|preparationCapability|worldmap-accepted-movement/.test(fs.readFileSync(path.join(root, file), 'utf8'))) errors.push(`${file}: private capability exposed publicly`);
    }
    return errors;
}
