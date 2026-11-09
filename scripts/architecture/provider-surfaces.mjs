import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Focused syntax census, not alias/data-flow analysis. HTTP sites include artifact/control fetches. */
export function scanProviderSource(file, text) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const counts = new Map(), sites = [];
    function visit(node) {
        if (ts.isCallExpression(node)) {
            const callee = node.expression.getText(source);
            const named = ['fetch', 'fetchImpl', 'undiciFetch', 'pipeline', 'model', 'model.generate', 'KokoroTTS.from_pretrained'].includes(callee);
            const argument = node.arguments[0];
            const rawEndpoint = argument && (ts.isStringLiteralLike(argument) || ts.isTemplateExpression(argument))
                && !/\.(?:endsWith|includes|replace|match|test)$/.test(callee)
                && /(?:chat\/completions|\/api\/chat|generateContent|\/images\/generations)/i.test(argument.getText(source));
            if (named || rawEndpoint) {
                const index = (counts.get(callee) ?? 0) + 1;
                counts.set(callee, index);
                sites.push({ id: `${file}#${callee}:${index}`, file, callee });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return sites;
}
export function scanServerProviderSites(root) {
    const result = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === '__tests__' || entry.name === 'graphify-out') continue;
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else if (/\.[jt]s$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
                const file = path.relative(root, absolute).replaceAll('\\', '/');
                result.push(...scanProviderSource(file, fs.readFileSync(absolute, 'utf8')));
            }
        }
    }
    walk(path.join(root, 'server'));
    return result.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
export function validateProviderSites(current, registered, operations) {
    const errors = [];
    if (JSON.stringify(current) !== JSON.stringify(registered.map(({ id, file, callee }) => ({ id, file, callee })))) errors.push('Server provider sites changed: review/register additions or removals');
    for (const site of registered) {
        if (!['execution', 'relay', 'setup', 'artifact', 'opaque'].includes(site.kind)
            || !['scoped', 'unverified', 'not-inference'].includes(site.observation)
            || !site.note || !site.operations?.length || !site.operations.every(op => operations.has(op))) errors.push(`Unclassified provider site: ${site.id}`);
    }
    return errors;
}
