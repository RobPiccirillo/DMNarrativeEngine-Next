import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { isInferenceClassification } from '../../packages/engine/dist/contracts/inference.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const inventoryPath = path.join(root, 'docs/architecture/inference-inventory.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const names = new Set(['llmCall', 'sendMessage', 'modelCall', 'callModel', 'llmFetch']);
export function scanInferenceSites(directory = path.join(root, 'src')) {
    const sites = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === '__tests__' || entry.name === 'eval') continue;
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(absolute); continue; }
            if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
            const file = path.relative(root, absolute).replaceAll('\\', '/');
            const source = ts.createSourceFile(file, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
            const counts = new Map();
            function visit(node) {
                if (ts.isCallExpression(node)) {
                    const callee = node.expression.getText(source);
                    if (names.has(callee) || /(?:\.model\.(?:call|callJson)|\.modelCall|\.callModel)$/.test(callee)) {
                        const index = (counts.get(callee) ?? 0) + 1;
                        counts.set(callee, index);
                        sites.push({ id: `${file}#${callee}:${index}`, file, callee });
                    }
                }
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    }
    walk(directory);
    return sites.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

const operations = new Set();
for (const family of inventory.families) {
    if (operations.has(family.operation) || !isInferenceClassification(family.classification)
        || family.operation !== family.classification.operation) throw new Error(`Invalid/duplicate inference family: ${family.operation}`);
    operations.add(family.operation);
}
const current = scanInferenceSites();
if (process.argv.includes('--capture-sites')) {
    inventory.sites = current.map(site => ({ ...site, operations: [] }));
    fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
    console.log(`Captured ${current.length} recognizable sites; assign family operations before gate passes.`);
} else {
    if (JSON.stringify(current) !== JSON.stringify(inventory.sites.map(({ id, file, callee }) => ({ id, file, callee })))) throw new Error('Inference sites changed: review and register additions/removals in inference-inventory.json');
    for (const site of inventory.sites) {
        if (!site.operations.length || !site.operations.every(operation => operations.has(operation))) throw new Error(`Unclassified site: ${site.id}`);
    }
    const markdown = '# Frontend inference inventory\n\nGenerated from `inference-inventory.json`; edit that source and run `node scripts/architecture/check-inference.mjs --write-doc`.\n\n'
        + inventory.scope + '\n\n'
        + '| Operation | Purpose | Trigger | Execution | Direct wait boundary | Role | Requirement | Coverage | Notes |\n'
        + '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
        + inventory.families.map(f => {
            const c = f.classification;
            return `| ${f.operation} | ${c.purpose} | ${c.trigger} | ${c.execution} | ${c.blocking} | ${c.role} | ${c.requirement} | ${f.coverage} | ${f.note} |`;
        }).join('\n') + '\n\n'
        + `The JSON also registers ${current.length} recognizable source sites by file/callee/index. Known direct calls and bound canonical callbacks name their exact families; shared forwarding/provider transports list possible caller families and retain explicit dynamic-boundary notes. These lists do not prove every dynamic invocation or its caller context. The gate detects additions/removals of direct named frontend calls and host model calls; it does not detect arbitrary aliases, computed property access, new raw fetch/provider implementations or external module code. Review those boundaries explicitly.\n`;
    const markdownPath = path.join(root, 'docs/architecture/inference-inventory.md');
    if (process.argv.includes('--write-doc')) fs.writeFileSync(markdownPath, markdown);
    else if (!fs.existsSync(markdownPath) || fs.readFileSync(markdownPath, 'utf8') !== markdown) throw new Error('Inference inventory Markdown is stale; run with --write-doc');
    console.log(`Inference gate PASS: ${operations.size} families; ${current.length} recognizable sites. Dynamic/aliased/provider bypasses remain review boundaries.`);
}
