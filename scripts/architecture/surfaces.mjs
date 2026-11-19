import ts from 'typescript';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';

const mutators = /^(?:updateContext|updateNPC|addMessage|setMessages|setContext|setNPCs|setDivergenceRegister|updatePlayerCharacter|setCharacterProfileData|setInventoryItems|setLocationLedger|archiveNPC|restoreNPC|applyRelationshipMemory|saveRelationshipMemory|writeJson|writeTextAtomic|writeArchiveMd|writeIndex|writeIndexAt|writeChapters|writeChaptersAt|writeEntitiesAt|writeTimeline|writeTimelineAt|writeFacts|saveModTable|persistPendingTurn|clearPersistedPendingTurn|debouncedSaveCampaignState|debouncedSaveNPCLedger|debouncedSaveDivergenceRegister)$/;
const diskMethods = /^(?:writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|unlinkSync|unlink|copyFileSync|copyFile|rmSync|rm)$/;
const frozenModules = /(?:^|\/)(?:mods\/(?:modContext|modTables|modPanels|screenApiTypes|computeTrack|native\/nativeLoader|sandbox\/(?:sandboxHost|workerPrelude)|interceptors|facts|macros|mounts|lifecycle|events)|roles\/(?:roleRegistry|roleContext)|turn\/hostFacade)(?:\.|\/|$)/;
const frozenAccess = /\.(?:write|model|table|roles|interceptors|facts|mounts|macros|events|screens|windows)\./;
const roleCapabilities = new Set([
    'serviceRoles', 'createServiceRoleRegistry', 'buildModContextRoles',
    'beginModRoleLease', 'clearModRoleLease', 'clearAllModRoleLeases', 'recordUnprovidedRoles',
    'enableModRoles', 'disableModRoles', 'configureModRoles', 'checkModRoles',
    'setRoleModuleEnabled', 'getRoleModuleEnabled',
]);

function isFrozenDependency(file, specifier, names) {
    const resolved = specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier;
    if (/(?:^|\/)services\/roles(?:\/index)?(?:\.[cm]?[jt]s)?$/.test(resolved)) {
        return names === undefined || names.some(name => roleCapabilities.has(name));
    }
    return frozenModules.test(resolved);
}

function importedNames(node) {
    if (node.isTypeOnly || node.importClause?.isTypeOnly) return [];
    const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
    if (!bindings || ts.isNamespaceImport(bindings) || !('elements' in bindings) || node.importClause?.name) return undefined;
    return bindings.elements.filter(entry => !entry.isTypeOnly).map(entry => (entry.propertyName ?? entry.name).text);
}

export function isProductionSource(file) {
    return /^(?:src\/|server\/|mods\/|public\/bundled-mods\/|server\.js$|scripts\/campaign-migration\.mjs$)/.test(file)
        && /\.[cm]?[jt]sx?$/.test(file)
        && !/(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:test|spec|smoke|d)\.[jt]sx?$|(?:Fixtures|fixtures)\.[jt]s$/.test(file);
}

export function scanSource(file, text) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
        file.endsWith('x') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const writers = new Map();
    const extensions = new Map();
    const opaque = new Map();
    const symbols = new Set(['<module>']);
    function record(map, symbol, category, detail, node) {
        const key = `${symbol}::${category}::${detail}`;
        const previous = map.get(key);
        if (previous) previous.count++;
        else map.set(key, { key, symbol, category, detail, count: 1, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
    }
    function visit(node, symbol) {
        if (ts.isVariableDeclaration(node)) symbols.add(node.name.getText(ast));
        if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) {
            symbol = node.name.getText(ast);
            symbols.add(symbol);
        } else if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) && node.initializer
            && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
            symbol = node.name.getText(ast).replace(/^['"]|['"]$/g, '');
            symbols.add(symbol);
        }
        if (ts.isVariableDeclaration(node) && node.type && /PostTurnTrack/.test(node.type.getText(ast))) {
            symbols.add(node.name.getText(ast));
            record(writers, node.name.getText(ast), 'track', 'post-turn registration', node);
        }
        if (ts.isPropertyAccessExpression(node) && /^(?:ctx|facade|host|context)$/.test(node.expression.getText(ast))
            && /^(?:write|model|table|roles|interceptors|facts|mounts|macros|events|screens|windows)$/.test(node.name.text)) {
            record(extensions, symbol, 'capability-access', node.getText(ast).replace(/\s/g, ''), node);
        }
        if (ts.isCallExpression(node)) {
            const callee = node.expression.getText(ast).replace(/\s/g, '');
            const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : callee;
            if (ts.isElementAccessExpression(node.expression) && /store|state|facade|ctx|host|write|journal/i.test(callee)) {
                record(opaque, symbol, 'computed-call', callee, node);
            }
            if (callee === 'eval' || callee === 'Reflect.apply') record(opaque, symbol, 'dynamic-execution', callee, node);
            if (/^(?:router|app)\.(?:put|post|patch|delete)$/.test(callee)) {
                const route = node.arguments[0]?.getText(ast) ?? '<dynamic>';
                symbol = `route:${method.toUpperCase()}:${route}`;
                symbols.add(symbol);
                record(writers, symbol, 'route', callee, node);
            }
            if (callee === 'set' || method === 'setState') record(writers, symbol, 'store', callee, node);
            if (mutators.test(method)) record(writers, symbol, 'mutation-call', callee, node);
            else if (/^(?:saveRelationshipMemories|setRelationshipMemories|addRelationshipMemoryFault)$/.test(method)) record(writers, symbol, 'mutation-call', callee, node);
            else if (/^(?:addNPCToStore|updateNPCStore)$/.test(method) || method === 'applyPatch' && file === 'src/services/character/pcUpdater.ts') record(writers, symbol, 'model-callback', callee, node);
            else if (/^(?:putCampaignState|publishDurable|maintainLegacyArchive|saveCampaign(?:State)?|saveChapters|saveNPCLedger|saveLoreChunks|saveDivergenceRegister|saveLocationTable|addTimelineEvent|removeTimelineEvent|setModTable|storeArchiveEmbedding|storeLoreEmbedding|storeRulesEmbedding|deleteCampaignEmbeddings|deleteArchiveEmbedding|deleteAllArchiveEmbeddings|setNPCLedger|setPlayerCharacter|setOnStageNpcIds|setArchiveIndex|setChapters|setTimeline|setSemanticFacts|setEntities|addNPCs?|addLocation)$/.test(method)
                || /\.(?:write|journal)\./.test(callee)
                || /^enemyData\.(?:set|update|remove|add|apply|resolve|spend|spawn|begin|roll|clear)/.test(callee)) record(writers, symbol, 'mutation-call', callee, node);
            else if (/^(?:guarded(?:Update|Set|Add|Archive|Restore)|writeRelationshipMemoryState)/.test(method)
                || /^(?:set|update|add|remove|delete|clear|reset|archive|restore|merge|rename|replace|pin|unpin|toggle|save|persist|commit|append|rollback)/i.test(method)
                && /^(?:api\.|callbacks\.|state\.|ctx\.(?:callbacks|state)\.|facade\.write\.|host\.write\.)/.test(callee)) {
                record(writers, symbol, 'mutation-call', callee, node);
            }
            if (diskMethods.test(method) && /(?:^|\.)(?:fs|promises)\./.test(callee)) record(writers, symbol, 'disk', callee, node);
            if (method === 'run' && /(?:prepare\(|stmt|Stmt|insert|delete|update|upsert)/.test(callee)) record(writers, symbol, 'sql', callee.replace(/\([\s\S]*\)/, '(...)'), node);
            if (method === 'run' && /^(?:server\/repositories\/migrationStagingRepository\.js|server\/services\/campaignMigration\/)/.test(file)
                && !/(?:prepare\(|stmt|Stmt|insert|delete|update|upsert)/.test(callee)) record(writers, symbol, 'sql', callee.replace(/\([\s\S]*\)/, '(...)'), node);
            if (method === 'backup' && file.startsWith('server/services/campaignMigration/')) record(writers, symbol, 'sql-backup', callee, node);
            if (method === 'exec' && /^db\./.test(callee)) record(writers, symbol, 'sql-schema', callee, node);
            if (method === 'write' && /(?:table|journal)/i.test(callee)) record(writers, symbol, 'table', callee, node);
            if (callee === 'fetch' || callee === 'campaignResourceRequest') {
                const options = node.arguments[callee === 'campaignResourceRequest' ? 2 : 1];
                const verb = options && ts.isObjectLiteralExpression(options)
                    ? options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'method') : undefined;
                if (verb && /['"](?:POST|PUT|PATCH|DELETE)['"]/.test(verb.initializer.getText(ast))) record(writers, symbol, 'http-write', verb.initializer.getText(ast), node);
                if (callee === 'fetch' && file === 'src/store/campaignStateTransport.ts' && symbol === 'campaignResourceRequest' && options && ts.isObjectLiteralExpression(options)) record(writers, symbol, 'http-write', 'checked-campaign-resource', node);
            }
            if (frozenAccess.test(callee)) record(extensions, symbol, 'capability', callee, node);
            if (/facade\.write\[/.test(callee)) record(extensions, symbol, 'dynamic-journal', 'facade.write[computed]', node);
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                const specifier = node.arguments[0];
                if (specifier && ts.isStringLiteralLike(specifier)) {
                    if (isFrozenDependency(file, specifier.text)) record(extensions, symbol, 'dynamic-import', specifier.text, node);
                } else {
                    record(extensions, symbol, 'dynamic-module', 'import(nonliteral)', node);
                    record(opaque, symbol, 'native-module', 'import(nonliteral)', node);
                }
            }
        }
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const specifier = node.moduleSpecifier.text;
            if (isFrozenDependency(file, specifier, importedNames(node))) record(extensions, symbol, 'import', specifier, node);
        }
        ts.forEachChild(node, child => visit(child, symbol));
    }
    visit(ast, '<module>');
    if (file === 'src/services/mods/sandbox/workerPrelude.ts') {
        record(extensions, '<module>', 'embedded-worker', createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex'), ast);
    }
    const sorted = map => [...map.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    return { file, writers: sorted(writers), extensions: sorted(extensions), opaque: sorted(opaque), symbols: [...symbols].sort() };
}

export function scanManifest(file, text) {
    const manifest = JSON.parse(text);
    const capabilities = ['native', 'compute', 'tables', 'roles', 'tierEntries', 'panels', 'screens', 'actions', 'contributions', 'factPublishers'];
    return { file, writers: [], symbols: ['<manifest>'], extensions: capabilities.filter(key => key in manifest).map(key => ({
        key: `<manifest>::declaration::${key}:${createHash('sha256').update(JSON.stringify(manifest[key])).digest('hex')}`,
        symbol: '<manifest>', category: 'declaration', detail: key, count: 1, line: 1,
    })) };
}
