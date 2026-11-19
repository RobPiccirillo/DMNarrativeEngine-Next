import { expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function forbiddenDependencies(source: string): string[] {
    const tree = ts.createSourceFile('foundation.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const findings: string[] = [];
    const allowed = new Set(['node:fs', 'node:path', 'node:crypto', '../lib/durablePublication.js', '../lib/legacyFieldPatch.js',
        './legacyAcceptanceJournal.js', './jsonSourceIntegrity.js', '@narrative/engine/contracts/draftLifecycle']);
    function visit(node: ts.Node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            if (!allowed.has(node.moduleSpecifier.text)) findings.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require', 'fetch', 'eval'].includes(node.expression.text)))) findings.push('dynamic-or-network-call');
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['fetch', 'eval'].includes(node.expression.name.text)) findings.push('dynamic-or-network-call');
        ts.forEachChild(node, visit);
    }
    visit(tree); return findings;
}

it('keeps Phase 3 persistence foundations free of model, dynamic-loader and staging dependencies', () => {
    for (const file of ['server/lib/durablePublication.js', 'server/lib/legacyFieldPatch.js',
        'server/services/legacyDraftRepository.js', 'server/services/legacyAcceptanceJournal.js']) {
        expect(forbiddenDependencies(fs.readFileSync(path.resolve(file), 'utf8')), file).toEqual([]);
    }
});

it('rejects aliased model imports, SQLite/staging imports and recognized dynamic/network calls', () => {
    for (const source of [
        "import { sendMessage as renamed } from '../llmService.js';",
        "import { open as harmless } from '../db/migrationStagingRepository.js';",
        "import Database from 'better-sqlite3';",
        "const load = () => import(variable);",
        "globalThis.fetch('/llm/proxy');",
        "fetch('/provider');",
    ]) expect(forbiddenDependencies(source)).not.toEqual([]);
});
