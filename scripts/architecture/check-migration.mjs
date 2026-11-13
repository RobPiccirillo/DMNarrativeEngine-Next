import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const migrationFile = file => /^server\/(?:db(?:\/|$)|repositories\/migrationStagingRepository(?:\.[cm]?[jt]s)?$|services\/campaignMigration(?:\/|(?:\.[cm]?[jt]s)?$))/.test(file);
const testFile = file => /(?:__tests__|\.test\.)/.test(file);
export function checkMigrationSource(file, source) {
    const errors = [], migration = migrationFile(file);
    const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    function walk(node) {
        if (ts.isStringLiteralLike(node)) {
            const value = node.text;
            const isImport = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)
                || (ts.isCallExpression(node.parent) && (node.parent.expression.kind === ts.SyntaxKind.ImportKeyword || node.parent.expression.getText(ast) === 'require'));
            if (isImport) {
                const target = value.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file),value)) : value;
                if (migrationFile(target) && !migration && !testFile(file) && file !== 'scripts/campaign-migration.mjs' && !file.startsWith('scripts/phase2/')) errors.push('forbidden migration import');
                if (value === 'better-sqlite3' && file !== 'server/db/campaignDb.js' && file !== 'server/lib/vectorStore.js' && !testFile(file)) errors.push('direct SQLite capability');
                if (migration && /(?:vectorStore|embedder|vault|llm|provider|modLoader|authorityControlStore|campaignHydrator|legacyAdoption|fileStore|routes\/)/i.test(value)) errors.push('forbidden live/provider capability');
            }
            if (migration && /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER)\b/i.test(value)
                && !file.startsWith('server/db/migrations/') && !(file === 'server/db/campaignDb.js' && value.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations ('))) errors.push('DDL outside migrations');
        }
        if (migration && ts.isCallExpression(node) && /(?:loadExtension|\.applyAuthority|\.saveCampaign|\.hydrateCampaign|\.restoreCampaign)$/.test(node.expression.getText(ast))) errors.push('forbidden live mutation');
        ts.forEachChild(node,walk);
    }
    walk(ast);
    return [...new Set(errors)].map(e=>file+': '+e);
}
export function migrationGate(root) {
    const files = execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
    return [...new Set(files)].filter(f=>/\.[cm]?[jt]sx?$/.test(f) && !testFile(f)).flatMap(f=>checkMigrationSource(f,fs.readFileSync(path.join(root,f),'utf8')));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const errors=migrationGate(fileURLToPath(new URL('../../',import.meta.url)));
    errors.forEach(e=>console.error(e)); console.log('Phase 2 migration boundary: '+(errors.length ? 'FAIL' : 'PASS')); process.exitCode=errors.length ? 1 : 0;
}
