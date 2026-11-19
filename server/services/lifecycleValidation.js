import { createHash } from 'node:crypto';
import { duplicateJsonKeys } from '../lib/jsonSourceIntegrity.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const version = bytes => bytes === null ? 'absent' : `sha256:${hash(bytes)}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validPosition = value => {
    if (typeof value !== 'string') return false;
    try { const parts = JSON.parse(value); return Array.isArray(parts) && parts.length === 5 && parts.slice(0, 2).every(part => part === null || typeof part === 'string')
        && (parts[2] === null || Number.isFinite(parts[2])) && (parts[3] === null || object(parts[3])) && Number.isFinite(parts[4]); } catch { return false; }
};
const canonical = value => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
};
const reference = (value, kind, instance) => {
    try { const parts = JSON.parse(decodeURIComponent(value.slice('sid:1:r:'.length)));
        return value.startsWith('sid:1:r:') && Array.isArray(parts) && parts.length === 8 && parts.every(part => typeof part === 'string')
            && parts[0] === kind && parts[1] === instance && parts[2] && parts[3] && parts[4] && parts[7] && parts[5] === 'compatibility' && parts[6] === '';
    } catch { return false; }
};
const suffixes = { archive: '.archive.md', index: '.archive.index.json', chapters: '.archive.chapters.json', entities: '.entities.json', state: '.state.json',
    drafts: '.drafts.json', npcs: '.npcs.json', locations: '.locations.json', timeline: '.timeline.json', divergence: '.divergence.json',
    relationshipNpcToMc: '.relationship-memory.npc-to-mc.json', relationshipNpcToNpc: '.relationship-memory.npc-to-npc.json' };

export function validateLifecycleSources(read) {
    // Evidence is untrusted input, including on offline restore. Malformed
    // containers must produce a closed validation result, never an exception.
    try { return validate(read); }
    catch { return { managed: true, valid: false, unresolved: true, errors: ['malformed-lifecycle-evidence'] }; }
}

function validate(read) {
    const errors = [], add = code => { if (!errors.includes(code)) errors.push(code); };
    const parse = suffix => {
        const bytes = read(suffix); if (bytes === null) return null;
        try { const source = bytes.toString('utf8'); if (!Buffer.from(source, 'utf8').equals(bytes) || duplicateJsonKeys(bytes)) throw new Error(); return JSON.parse(source); }
        catch { add(`invalid-lifecycle-json:${suffix}`); return null; }
    };
    const draftBytes = read('.drafts.json'), journalBytes = read('.acceptance.json');
    if (draftBytes === null && journalBytes === null) return { managed: false, valid: true, unresolved: false, errors: [] };
    const drafts = parse('.drafts.json'), journal = parse('.acceptance.json'), state = parse('.state.json');
    if (!drafts || !journal) add('missing-managed-lifecycle-pair');
    if (drafts?.schemaVersion !== 1 || journal?.schemaVersion !== 1) add('unsupported-lifecycle-schema');
    if (!text(drafts?.campaignInstance) || drafts?.campaignInstance !== journal?.campaignInstance) add('lifecycle-instance-conflict');
    if (!Array.isArray(drafts?.sets) || !Array.isArray(drafts?.conflicts) || !Array.isArray(journal?.commands) || !Array.isArray(state?.messages)) add('invalid-lifecycle-container');
    if (Array.isArray(state?.messages) && state.messages.some(message => !object(message) || !text(message.id))) add('invalid-lifecycle-message');
    if (errors.length) return { managed: true, valid: false, unresolved: true, errors };
    const instance = drafts.campaignInstance, revisions = new Map(), sets = new Map(), attempts = new Set();
    if (drafts.conflicts.length) add('preserved-draft-recovery-conflict');
    if (drafts.storageGuard && (drafts.storageGuard.format !== 'legacy-storage-scope-v1' || !text(drafts.storageGuard.token)
        || drafts.storageGuard.phase !== 'ready')) add('lifecycle-storage-scope-unready');
    if (drafts.storageGuard?.assetAliases !== undefined) {
        const safeAsset = value => {
            if (typeof value !== 'string' || !/^(?:http:\/\/(?:localhost|127\.0\.0\.1):3001)?\/assets\/(?:portraits\/|campaigns\/[a-zA-Z0-9_-]+\/scene-images\/)/.test(value)) return false;
            try { return !decodeURIComponent(value).replace(/^http:\/\//, '').split('/').some(part => ['.', '..'].includes(part) || part.includes('\\')); } catch { return false; }
        };
        if (!object(drafts.storageGuard.assetAliases) || Object.entries(drafts.storageGuard.assetAliases).some(([key, value]) => !safeAsset(key) || !safeAsset(value))) add('invalid-lifecycle-asset-aliases');
    }
    for (const set of drafts.sets) {
        if (!object(set) || !reference(set.id, 'draft', instance) || sets.has(set.id) || set.campaignInstance !== instance
            || !reference(set.turnReference, 'turn', instance) || !text(set.sourceMessageId) || !text(set.assistantMessageId)
            || !text(set.archivedUserText) || !text(set.expectedHead) || !text(set.selectionVersion)
            || !Array.isArray(set.revisions) || !Array.isArray(set.revisionOrder) || !Array.isArray(set.attempts)) { add('invalid-draft-set'); continue; }
        sets.set(set.id, set);
        const local = new Set(), localAttempts = new Set();
        for (const attempt of set.attempts) {
            if (!object(attempt)) { add('invalid-generation-attempt'); continue; }
            if (attempt.generationPosition !== undefined && !validPosition(attempt.generationPosition)) add('invalid-generation-position');
            if (!object(attempt) || !reference(attempt.id, 'generation-attempt', instance) || attempts.has(attempt.id) || attempt.setId !== set.id
                || !['initial', 'retry', 'swipe', 'continue', 'regenerate'].includes(attempt.kind)
                || !['streaming', 'completed', 'failed', 'aborted', 'interrupted'].includes(attempt.status)
                || !['current', 'constrained-local-v1'].includes(attempt.profileId) || !reference(attempt.callReference, 'model-call', instance)
                || (attempt.sourceAttemptId && !localAttempts.has(attempt.sourceAttemptId))) add('invalid-generation-attempt');
            attempts.add(attempt.id); localAttempts.add(attempt.id);
        }
        for (const revision of set.revisions) {
            if (!object(revision) || !reference(revision.id, 'revision', instance) || revisions.has(revision.id) || revision.setId !== set.id
                || typeof revision.text !== 'string' || !revision.text.trim() || (revision.parentRevisionId && !local.has(revision.parentRevisionId))
                || (revision.attemptId && !localAttempts.has(revision.attemptId))
                || !['initial', 'retry', 'swipe', 'continue', 'regenerate', 'edit', 'compatibility'].includes(revision.reason)
                || !['host-generation', 'user-edit', 'legacy-compatibility'].includes(revision.provenance)) { add('invalid-draft-revision'); continue; }
            try { encodeURIComponent(revision.text); if (`story-visible-v1:sha256:${hash(Buffer.from(JSON.stringify({ schema: 'story-visible-v1', text: revision.text })))}` !== revision.hash) add('revision-hash-conflict'); }
            catch { add('invalid-revision-text-encoding'); }
            if (revision.metadata && (revision.metadata.revisionId !== revision.id || revision.metadata.hash !== revision.hash || !text(revision.metadata.version))) add('revision-metadata-binding-conflict');
            if (revision.generationPosition !== undefined && !validPosition(revision.generationPosition)) add('invalid-generation-position');
            if (revision.reason === 'edit' && revision.generationPosition !== revisions.get(revision.parentRevisionId)?.generationPosition) add('generation-position-binding-conflict');
            if (revision.attemptId && revision.generationPosition !== set.attempts.find(attempt => attempt?.id === revision.attemptId)?.generationPosition) add('generation-position-binding-conflict');
            local.add(revision.id); revisions.set(revision.id, revision);
        }
        for (const attempt of set.attempts) if (attempt?.sourceRevisionId && !local.has(attempt.sourceRevisionId)) add('attempt-source-revision-conflict');
        if (set.revisionOrder.length !== local.size || new Set(set.revisionOrder).size !== local.size || set.revisionOrder.some(id => !local.has(id))) add('revision-order-conflict');
        if ((set.selectedRevisionId && !local.has(set.selectedRevisionId)) || (set.displayedRevisionId && !local.has(set.displayedRevisionId))
            || set.selectedRevisionId !== set.displayedRevisionId) add('selected-displayed-revision-conflict');
        if (!['draft', 'streaming', 'ready', 'accepted', 'acknowledged', 'acceptance-pending', 'recovery-required', 'conflicted', 'discarded', 'closed'].includes(set.state)) add('invalid-draft-state');
        if (set.id === drafts.activeSetId) {
            if (['accepted', 'acknowledged', 'discarded', 'closed'].includes(set.state)) add('invalid-active-draft-state');
            const users = state.messages.filter(message => message.id === set.sourceMessageId && message.role === 'user');
            const assistants = state.messages.filter(message => message.id === set.assistantMessageId && message.role === 'assistant');
            if (users.length !== 1 || assistants.length !== 1 || (users[0]?.displayContent ?? users[0]?.content) !== set.archivedUserText) add('draft-source-message-conflict');
            const visible = assistants[0]?.content;
            if (visible && !set.revisions.some(revision => revision.text === visible) && !set.attempts.some(attempt => ['streaming', 'interrupted'].includes(attempt.status))) add('draft-mirror-text-conflict');
        }
    }
    if (drafts.activeSetId !== null && !sets.has(drafts.activeSetId)) add('missing-active-draft');
    const transitions = new Set();
    if (drafts.transitions !== undefined && !Array.isArray(drafts.transitions)) add('invalid-transition-replay-evidence');
    for (const transition of drafts.transitions ?? []) {
        try {
            const request = JSON.parse(transition.request);
            if (!/^[a-f0-9-]{36}$/.test(transition.id) || transitions.has(transition.id) || request.transitionId !== transition.id
                || canonical(request) !== transition.request || !['begin', 'finish', 'edit', 'select', 'restore', 'discard'].includes(request.action)
                || request.setId && !sets.has(request.setId) || !object(transition.result)
                || Object.keys(transition.result).some(key => !['attempt', 'revision'].includes(key))
                || transition.result.attempt && !attempts.has(transition.result.attempt.id)
                || transition.result.revision && !revisions.has(transition.result.revision.id)) add('invalid-transition-replay-evidence');
            transitions.add(transition.id);
        } catch { add('invalid-transition-replay-evidence'); }
    }
    if (!text(journal.head) || !Number.isSafeInteger(journal.highWater) || journal.highWater < 0 || !Number.isSafeInteger(journal.generation) || journal.generation < 0) add('invalid-acceptance-head');
    const logicalKeys = new Set(), commandIds = new Set(), sceneNumbers = new Set();
    const pendingScenes = [], partialArchives = [], historicalMessages = {}, completedEvidence = [];
    const maintenance = Array.isArray(journal.maintenance) ? journal.maintenance : [];
    if (journal.maintenance !== undefined && !Array.isArray(journal.maintenance)) add('invalid-archive-maintenance');
    const events = [];
    for (const entry of maintenance) {
        if (!object(entry) || entry.format !== 'legacy-archive-maintenance-v1' || !['pending', 'completed'].includes(entry.status)
            || !text(entry.beforeHead) || !text(entry.afterHead) || !Number.isSafeInteger(entry.generation)
            || !Array.isArray(entry.affectedScenes) || entry.affectedScenes.some(scene => !/^\d+$/.test(scene))
            || !Array.isArray(entry.operations) || !entry.operations.length) { add('invalid-archive-maintenance'); continue; }
        for (const operation of entry.operations) {
            if (!object(operation) || !['archive', 'index', 'chapters', 'timeline'].includes(operation.target)
                || !/^(absent|sha256:[a-f0-9]{64})$/.test(operation.beforeVersion ?? '')
                || !/^(absent|sha256:[a-f0-9]{64})$/.test(operation.afterVersion ?? '')) { add('invalid-archive-maintenance'); continue; }
            const after = operation.afterBase64 === null ? null : Buffer.from(operation.afterBase64, 'base64');
            if (after !== null && after.toString('base64') !== operation.afterBase64 || version(after) !== operation.afterVersion) add('archive-maintenance-bytes-conflict');
        }
        if (entry.status !== 'completed') add('archive-maintenance-recovery-required');
        else events.push({ before: entry.beforeHead, after: entry.afterHead, entry });
    }
    let unresolved = false, pendingCount = 0;
    for (const command of journal.commands) {
        if (!object(command) || !text(command.logicalKey) || logicalKeys.has(command.logicalKey) || !text(command.commandId) || commandIds.has(command.commandId)
            || !Number.isSafeInteger(command.sceneNumber) || command.sceneNumber < 1 || command.sceneNumber > journal.highWater || sceneNumbers.has(command.sceneNumber)
            || !['pending', 'completed', 'recovery-required'].includes(command.status) || !Array.isArray(command.steps) || !object(command.frozen)) { add('invalid-acceptance-command'); continue; }
        logicalKeys.add(command.logicalKey); commandIds.add(command.commandId); sceneNumbers.add(command.sceneNumber);
        if (command.derivedRecall !== undefined && (!object(command.derivedRecall) || !['pending', 'dispatched', 'produced', 'incomplete', 'superseded'].includes(command.derivedRecall.status))) add('invalid-derived-recall-disposition');
        if (command.status !== 'completed') { unresolved = true; pendingCount++; }
        if (!command.acknowledged) unresolved = true;
        try {
            const semantic = JSON.parse(command.semanticRequest);
            if (hash(Buffer.from(command.semanticRequest)) !== command.semanticDigest || canonical(semantic) !== command.semanticRequest) add('semantic-request-conflict');
            const { expectedOwner: _owner, expectedFormatEpoch: _epoch, ...original } = command.frozen.command ?? {};
            if (semantic.schema !== 'legacy-story-accept-v1' || canonical(semantic.command) !== canonical(original)
                || !same(original.payload, command.frozen.candidate) || original.commandId !== command.commandId
                || original.campaignInstance !== instance || original.domainId !== 'narrative-evidence' || original.kind !== 'story.accept'
                || command.logicalKey !== `${instance}/narrative-evidence/command-id/${command.commandId}`
                || !reference(command.commandId, 'command', instance)) add('original-command-binding-conflict');
            if (_owner !== 'legacy-runtime' || _epoch !== 1 || original.binding !== 'legacy-compatibility-v1'
                || original.expectedVersion?.mode !== 'exact' || original.expectedVersion.version !== original.payload?.expectedHead
                || original.idempotency?.mode !== 'command-id' || original.provenance?.origin !== 'current-user-action'
                || original.provenance.writerId !== 'host.acceptance' || original.provenance.turn?.id !== original.payload?.turnReference
                || original.provenance.source?.id !== original.payload?.revisionId
                || !reference(original.provenance.message?.id, 'message', instance)) add('original-command-provenance-conflict');
        }
        catch { add('invalid-original-semantic-request'); }
        const candidate = command.frozen.candidate, revision = revisions.get(candidate?.revisionId), set = sets.get(candidate?.setId);
        if (!candidate || !revision || !set || candidate.campaignInstance !== instance || candidate.hash !== revision.hash || candidate.turnReference !== set.turnReference
            || candidate.sourceMessageId !== set.sourceMessageId || candidate.assistantMessageId !== set.assistantMessageId || candidate.archivedUserText !== set.archivedUserText) add('acceptance-candidate-binding-conflict');
        if (candidate?.metadataVersion !== revision?.metadata?.version) add('acceptance-metadata-binding-conflict');
        if (candidate?.generationPosition !== revision?.generationPosition
            || (command.frozen.preparation?.generationPosition ?? null) !== (candidate?.generationPosition ?? null)) add('acceptance-generation-position-conflict');
        const targetRegistry = command.frozen.targetRegistry ?? {};
        if (command.status !== 'completed' && command.effectGroup && command.steps.some(step => step?.target === 'archive') && command.steps.some(step => step?.target === 'index')) pendingScenes.push(String(command.sceneNumber).padStart(3, '0'));
        const ids = new Set();
        for (const step of command.steps) {
            if (!object(step)) { add('invalid-prepared-effect-step'); continue; }
            const suffix = targetRegistry[step.target];
            if (!text(step.id) || ids.has(step.id) || !['replace', 'archive-append', 'json-fields'].includes(step.kind)
                || !['prepared', 'applied'].includes(step.status) || !Array.isArray(step.dependencies) || step.dependencies.some(id => !ids.has(id))) add('invalid-prepared-effect-step');
            ids.add(step.id);
            const allowedTarget = typeof suffix === 'string' && (Object.hasOwn(suffixes, step.target) && suffixes[step.target] === suffix
                || typeof step.target === 'string' && step.target.startsWith('mod.') && suffix === `.mod-${step.target.slice(4).replaceAll('.', '-')}.json`
                && /^\.mod-[a-zA-Z0-9_.-]+\.json$/.test(suffix));
            if (!allowedTarget) add('invalid-prepared-effect-target');
            if (step.target === 'mod.worldmap.roads') add('unsupported-acceptance-road-writer');
            if (!/^(absent|sha256:[a-f0-9]{64})$/.test(step.beforeVersion ?? '') || !/^sha256:[a-f0-9]{64}$/.test(step.afterVersion ?? '')) add('invalid-effect-version');
            let after;
            if (step.kind !== 'json-fields') {
                try { after = Buffer.from(step.afterBase64, 'base64'); if (after.toString('base64') !== step.afterBase64) add('invalid-prepared-bytes'); }
                catch { add('invalid-prepared-bytes'); }
                if (step.kind === 'replace' && version(after) !== step.afterVersion) add('prepared-after-version-conflict');
            } else if (!Array.isArray(step.patches) || step.patches.some(patch => !object(patch) || !Array.isArray(patch.path) || patch.path.some(part => typeof part === 'string' && ['__proto__', 'constructor', 'prototype'].includes(part)))) add('invalid-prepared-field-patches');
            if (command.status !== 'completed' && suffix && allowedTarget) {
                const current = read(suffix), currentVersion = version(current);
                const partial = step.kind === 'archive-append' && after && current && Number.isSafeInteger(step.originalLength)
                    && version(current.subarray(0, step.originalLength)) === step.prefixVersion && current.length > step.originalLength
                    && current.length < step.originalLength + after.length && after.subarray(0, current.length - step.originalLength).equals(current.subarray(step.originalLength));
                if (partial) partialArchives.push({ start: step.originalLength, end: current.length });
                if (currentVersion !== step.beforeVersion && currentVersion !== step.afterVersion && !partial) add('unresolved-effect-target-conflict');
            }
        }
        if (command.effectGroup && (!same(command.effectGroup.stepIds, command.steps.map(step => step.id)) || command.effectGroup.format !== 'legacy-acceptance-effect-group-v1')) add('effect-group-binding-conflict');
        if (command.status === 'completed') {
            completedEvidence.push({ command, candidate, revision });
            events.push({ before: candidate?.expectedHead, after: command.resultingHead, command });
            if (!command.outcome || command.outcome.head !== command.resultingHead || command.outcome.revisionId !== candidate?.revisionId
                || command.outcome.hash !== candidate?.hash || command.outcome.sceneNumber !== command.sceneNumber || command.steps.some(step => step.status !== 'applied')) add('acceptance-outcome-binding-conflict');
            const message = state.messages.find(message => message.id === candidate?.assistantMessageId);
            if (message?.acceptanceBinding && (message.acceptanceBinding.commandId !== command.commandId || message.acceptanceBinding.revisionId !== candidate.revisionId
                || message.acceptanceBinding.hash !== candidate.hash || message.sceneId !== String(command.sceneNumber).padStart(3, '0'))) add('accepted-message-binding-conflict');
            const archive = command.steps.find(step => step.kind === 'archive-append');
            if (!archive || !revision) add('missing-accepted-archive-evidence');
            else {
                const bytes = read('.archive.md'), block = Buffer.from(archive.afterBase64, 'base64');
                const sourceTail = `\n\n**[USER]**\n${candidate.archivedUserText}\n\n**[GM]**\n${revision.text}\n\n---\n`;
                const recorded = block.toString('utf8');
                if (!recorded.startsWith(`## SCENE ${String(command.sceneNumber).padStart(3, '0')}\n`)
                    || !recorded.endsWith(sourceTail)) add('accepted-revision-prose-conflict');
                if (!bytes || !bytes.subarray(archive.originalLength, archive.originalLength + block.length).equals(block)) {
                    if (!maintenance.some(entry => entry?.status === 'completed' && entry.affectedScenes?.includes(String(command.sceneNumber).padStart(3, '0'))
                        && entry.operations?.some(operation => operation?.target === 'archive'))) add('accepted-archive-evidence-conflict');
                }
            }
        }
    }
    if (pendingCount > 1) add('multiple-unresolved-acceptances');
    let expectedHead = drafts.anchor?.head;
    const remaining = [...events], ordered = [];
    while (remaining.length) {
        const matches = remaining.filter(event => event.before === expectedHead);
        if (matches.length !== 1) { add('acceptance-head-chain-conflict'); break; }
        const event = matches[0]; remaining.splice(remaining.indexOf(event), 1); ordered.push(event); expectedHead = event.after;
        if (event.before === event.after || ordered.slice(0, -1).some(previous => previous.after === event.after)
            || event.entry && event.entry.generation !== ordered.length) add('acceptance-head-chain-conflict');
    }
    if (!text(expectedHead) || journal.head !== expectedHead) add('acceptance-head-chain-conflict');
    if (journal.generation !== ordered.length) add('acceptance-head-generation-conflict');
    for (const { command, candidate, revision } of completedEvidence) {
        if (!candidate || !revision) continue;
        const scene = String(command.sceneNumber).padStart(3, '0'), ordinal = ordered.findIndex(event => event.command === command);
        const maintained = ordinal >= 0 && ordered.slice(ordinal + 1).some(event => event.entry?.affectedScenes.includes(scene)
            && event.entry.operations.some(operation => operation.target === 'archive'));
        const currentBlock = (read('.archive.md')?.toString('utf8') ?? '').split(/^(?=## SCENE )/m).find(block => block.startsWith(`## SCENE ${scene}\n`) || block.startsWith(`## SCENE ${scene}\r\n`));
        const users = state.messages.filter(message => message.id === candidate.sourceMessageId), assistants = state.messages.filter(message => message.id === candidate.assistantMessageId);
        if (users.length > 1 || assistants.length > 1 || (!maintained || currentBlock) && (users.length !== 1 || assistants.length !== 1)) add('missing-completed-message-evidence');
        const assistant = assistants[0], user = users[0];
        if (assistant && (assistant.role !== 'assistant' || assistant.sceneId !== scene || assistant.draftStatus !== 'accepted'
            || assistant.pendingCommit !== undefined || assistant.commitFailed !== undefined
            || assistant.acceptanceBinding?.commandId !== command.commandId || assistant.acceptanceBinding?.revisionId !== candidate.revisionId
            || assistant.acceptanceBinding?.hash !== candidate.hash)) add('accepted-message-binding-conflict');
        const gm = maintained && currentBlock ? currentBlock.match(/\*\*\[GM\]\*\*\r?\n([\s\S]*?)\r?\n\r?\n---(?:\r?\n)*$/)?.[1] : undefined;
        const player = maintained && currentBlock ? currentBlock.match(/\*\*\[USER\]\*\*\r?\n([\s\S]*?)\r?\n\r?\n\*\*\[GM\]\*\*/)?.[1] : undefined;
        const allowedStory = [revision.text, ...(gm === undefined ? [] : [gm])], allowedUser = [candidate.archivedUserText, ...(player === undefined ? [] : [player])];
        if (assistant && (!allowedStory.includes(assistant.content) || assistant.displayContent !== undefined && !allowedStory.includes(assistant.displayContent))) add('completed-message-prose-conflict');
        if (user && (user.role !== 'user' || !allowedUser.includes(user.displayContent ?? user.content))) add('completed-source-message-conflict');
        if (maintained) historicalMessages[candidate.assistantMessageId] = scene;
    }
    const lastArchiveEvent = ordered.filter(event => event.command?.steps.some(step => step?.target === 'archive') || event.entry?.operations.some(operation => operation.target === 'archive')).at(-1);
    if (!unresolved && lastArchiveEvent) {
        const recorded = lastArchiveEvent.command?.steps.find(step => step.target === 'archive') ?? lastArchiveEvent.entry.operations.find(operation => operation.target === 'archive');
        if (version(read('.archive.md')) !== recorded.afterVersion) add('archive-head-content-conflict');
    }
    return { managed: true, valid: errors.length === 0, unresolved, errors, campaignInstance: instance,
        pendingScenes, partialArchives, historicalMessages,
        counts: { sets: sets.size, revisions: revisions.size, commands: logicalKeys.size } };
}
