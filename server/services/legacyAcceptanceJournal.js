import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { byteVersion, publishDurable, readExact, readStrictJson } from '../lib/durablePublication.js';
import { prepareLegacyFields, applyLegacyFields } from '../lib/legacyFieldPatch.js';

function fail(code, details) { throw Object.assign(new Error(code), { code, details }); }
const text = value => typeof value === 'string' && value.length > 0;

export function semanticBytes(value) {
    const visit = input => {
        if (input === null || typeof input === 'boolean' || typeof input === 'string') {
            if (typeof input === 'string') encodeURIComponent(input);
            return JSON.stringify(input);
        }
        if (typeof input === 'number' && Number.isFinite(input) && !Object.is(input, -0)) return JSON.stringify(input);
        if (Array.isArray(input)) {
            const items = [];
            for (let index = 0; index < input.length; index++) {
                if (!Object.hasOwn(input, index)) fail('invalid-semantic-request');
                items.push(visit(input[index]));
            }
            return `[${items.join(',')}]`;
        }
        if (input && Object.getPrototypeOf(input) === Object.prototype) return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${visit(input[key])}`).join(',')}}`;
        fail('invalid-semantic-request');
    };
    return visit(value);
}

function validDocument(document, instance) {
    if (document && document.schemaVersion !== 1) fail('unsupported-acceptance-schema');
    if (!document || document.schemaVersion !== 1 || document.campaignInstance !== instance || !text(document.head)
        || !Number.isSafeInteger(document.generation) || document.generation < 0 || !Number.isSafeInteger(document.highWater)
        || document.highWater < 0 || !Array.isArray(document.commands)) fail('invalid-acceptance-document');
    const keys = new Set(), reservations = new Set();
    for (const command of document.commands) {
        if (!command || !text(command.logicalKey) || keys.has(command.logicalKey) || !['pending', 'completed', 'recovery-required'].includes(command.status)
            || !Array.isArray(command.steps) || !text(command.semanticRequest) || !text(command.commandId) || !text(command.resultingHead)
            || typeof command.acknowledged !== 'boolean' || !Number.isSafeInteger(command.sceneNumber) || command.sceneNumber < 1
            || command.sceneNumber > document.highWater || reservations.has(command.sceneNumber)) fail('invalid-acceptance-command');
        keys.add(command.logicalKey);
        reservations.add(command.sceneNumber);
        if (createHash('sha256').update(command.semanticRequest).digest('hex') !== command.semanticDigest) fail('semantic-request-digest-conflict');
        if (semanticBytes(JSON.parse(command.semanticRequest)) !== command.semanticRequest) fail('invalid-semantic-request');
        const ids = new Set(), targetVersions = new Map();
        for (const step of command.steps) {
            if (!step || !text(step.id) || ids.has(step.id) || !text(step.target) || !['prepared', 'applied'].includes(step.status)
                || !['replace', 'archive-append', 'json-fields'].includes(step.kind) || !text(step.beforeVersion) || !text(step.afterVersion)
                || (step.kind === 'json-fields' ? !Array.isArray(step.patches) || !step.patches.length : typeof step.afterBase64 !== 'string')
                || !Array.isArray(step.dependencies) || step.dependencies.some(id => !ids.has(id))) fail('invalid-prepared-step');
            ids.add(step.id);
            if (targetVersions.has(step.target) && targetVersions.get(step.target) !== step.beforeVersion) fail('invalid-target-version-chain');
            targetVersions.set(step.target, step.afterVersion);
            const after = step.kind === 'json-fields' ? null : Buffer.from(step.afterBase64, 'base64');
            if (after && after.toString('base64') !== step.afterBase64) fail('invalid-prepared-encoding');
            if (step.kind === 'replace' && byteVersion(after) !== step.afterVersion) fail('invalid-prepared-after-value');
            if (step.kind === 'archive-append' && (!Number.isSafeInteger(step.originalLength) || step.originalLength < 0 || !text(step.prefixVersion))) fail('invalid-append-boundary');
            if (step.kind === 'json-fields') semanticBytes(step.patches);
        }
        if (command.status === 'completed' && (!command.outcome || command.outcome.head !== command.resultingHead || command.outcome.sceneNumber !== command.sceneNumber || command.steps.some(step => step.status !== 'applied'))) fail('invalid-completed-outcome');
    }
    const pending = document.commands.filter(command => command.status !== 'completed');
    if (pending.length > 1) fail('multiple-unresolved-commands');
    return document;
}

export function createLegacyAcceptanceJournal({ directory, storageId, campaignInstance, targets, allowDraftTarget = false, boundary = () => {} }) {
    if (!/^[a-zA-Z0-9_-]+$/.test(storageId) || !text(campaignInstance)) fail('invalid-campaign-binding');
    const root = path.resolve(directory);
    const file = path.join(root, `${storageId}.acceptance.json`);
    const allowed = new Map(Object.entries(targets).map(([name, suffix]) => {
        if (!/^\.[a-zA-Z0-9_.-]+$/.test(suffix) || suffix === '.acceptance.json' || (suffix === '.drafts.json' && !allowDraftTarget)) fail('invalid-adapter-target');
        return [name, path.join(root, storageId + suffix)];
    }));
    let active = false;
    const exclusive = action => {
        if (active) fail('acceptance-busy');
        active = true;
        try { return action(); } finally { active = false; }
    };
    const publish = document => {
        validDocument(document, campaignInstance);
        publishDurable(file, Buffer.from(JSON.stringify(document, null, 2)), point => boundary(`journal:${point}`));
    };
    const load = () => {
        const document = readStrictJson(file);
        if (document === null) return null;
        return validDocument(document, campaignInstance);
    };
    const targetPath = target => { if (!allowed.has(target)) fail('unknown-effect-target'); return allowed.get(target); };
    const find = (document, logicalKey) => document.commands.find(command => command.logicalKey === logicalKey);
    const digest = request => createHash('sha256').update(request).digest('hex');
    const checkedCommand = request => {
        if (!request || !text(request.logicalKey) || !text(request.commandId) || !request.semantic || request.campaignInstance !== campaignInstance) fail('invalid-command-envelope');
        return semanticBytes(request.semantic);
    };

    return {
        load,
        initialize({ head, highWater = 0 }) {
            return exclusive(() => {
                if (load()) fail('already-initialized');
                fs.mkdirSync(root, { recursive: true });
                const document = { schemaVersion: 1, campaignInstance, generation: 0, head, highWater, commands: [] };
                publish(document); return document;
            });
        },
        begin(request, validateUnseen) {
            return exclusive(() => {
                const original = checkedCommand(request);
                const document = load(); if (!document) fail('missing-acceptance-document');
                const existing = find(document, request.logicalKey);
                if (existing) {
                    if (existing.semanticRequest !== original) fail('idempotency-key-reused');
                    return structuredClone(existing);
                }
                if (document.maintenance?.some(entry => entry.status !== 'completed')) fail('archive-maintenance-recovery-required');
                if (document.commands.some(command => command.status !== 'completed')) fail('unresolved-acceptance');
                if (request.expectedHead !== document.head) fail('version-conflict');
                validateUnseen(structuredClone(document));
                if (document.highWater === Number.MAX_SAFE_INTEGER) fail('scene-reservation-exhausted');
                const command = { commandId: request.commandId, logicalKey: request.logicalKey, semanticRequest: original,
                    semanticDigest: digest(original), sceneNumber: ++document.highWater, status: 'pending', steps: [],
                    frozen: structuredClone(request.frozen), resultingHead: randomUUID(), acknowledged: false,
                    ...(request.frozen?.preparation ? { derivedRecall: { status: 'pending' } } : {}) };
                document.commands.push(command); publish(document); boundary('intent-published');
                return structuredClone(command);
            });
        },
        prepare(logicalKey, { id, target, kind = 'replace', after, changes, dependencies = [] }) {
            return exclusive(() => {
                const document = load(); if (!document) fail('missing-acceptance-document');
                const command = find(document, logicalKey);
                if (!command || command.status !== 'pending') fail('command-not-pending');
                if (!text(id) || command.steps.some(step => step.id === id)) fail('duplicate-effect-key');
                if (dependencies.some(id => !command.steps.some(step => step.id === id))) fail('effect-dependency-not-prepared');
                if (!['replace', 'archive-append', 'json-fields'].includes(kind) || (kind !== 'json-fields' && !Buffer.isBuffer(after))) fail('invalid-effect-shape');
                if (command.steps.some(step => step.target === target && step.status !== 'applied')) fail('target-has-pending-step');
                const before = readExact(targetPath(target));
                const previous = command.steps.filter(step => step.target === target).at(-1);
                if (previous && byteVersion(before) !== previous.afterVersion) fail('target-version-conflict');
                if (kind === 'json-fields' && before === null) fail('missing-patch-target');
                const fields = kind === 'json-fields' ? prepareLegacyFields(before, changes) : null;
                if (fields) semanticBytes(fields.patches);
                const resulting = fields?.after ?? (kind === 'archive-append' ? Buffer.concat([before ?? Buffer.alloc(0), after]) : after);
                const step = { id, target, kind, dependencies: [...dependencies], beforeVersion: byteVersion(before), afterVersion: byteVersion(resulting),
                    ...(fields ? { patches: fields.patches } : { afterBase64: after.toString('base64') }), status: 'prepared',
                    ...(kind === 'archive-append' ? { originalLength: before?.length ?? 0, prefixVersion: byteVersion(before ?? Buffer.alloc(0)) } : {}) };
                command.steps.push(step); publish(document); boundary(`prepared:${id}`);
                return structuredClone(step);
            });
        },
        prepareGroup(logicalKey, plans, originalVersions, frozenPlan = {}) {
            return exclusive(() => {
                const document = load(); if (!document) fail('missing-acceptance-document');
                const command = find(document, logicalKey);
                if (!command || command.status !== 'pending') fail('command-not-pending');
                if (command.effectGroup) return structuredClone(command.effectGroup);
                if (command.steps.length || !Array.isArray(plans) || !plans.length) fail('invalid-effect-group');
                const steps = [], targets = new Set(), ids = new Set();
                for (const plan of plans) {
                    const { id, target, kind } = plan;
                    if (!text(id) || ids.has(id) || targets.has(target) || !['replace', 'archive-append', 'json-fields'].includes(kind)) fail('invalid-effect-group');
                    ids.add(id); targets.add(target);
                    const before = readExact(targetPath(target));
                    if (!Object.hasOwn(originalVersions, target) || byteVersion(before) !== originalVersions[target]) fail('prepared-source-version-conflict');
                    const after = kind === 'json-fields' ? null : Buffer.from(plan.afterBase64, 'base64');
                    if (kind === 'json-fields' && before === null) fail('missing-patch-target');
                    const fields = kind === 'json-fields' ? prepareLegacyFields(before, plan.changes) : null;
                    const resulting = fields?.after ?? (kind === 'archive-append' ? Buffer.concat([before ?? Buffer.alloc(0), after]) : after);
                    steps.push({ id, target, kind, dependencies: steps.length ? [steps.at(-1).id] : [],
                        beforeVersion: byteVersion(before), afterVersion: byteVersion(resulting),
                        ...(fields ? { patches: fields.patches } : { afterBase64: after.toString('base64') }), status: 'prepared',
                        ...(kind === 'archive-append' ? { originalLength: before?.length ?? 0, prefixVersion: byteVersion(before ?? Buffer.alloc(0)) } : {}) });
                }
                semanticBytes(steps);
                command.steps = steps;
                command.frozen = { ...command.frozen, ...structuredClone(frozenPlan) };
                command.effectGroup = { format: 'legacy-acceptance-effect-group-v1', stepIds: steps.map(step => step.id), originalVersions: structuredClone(originalVersions) };
                publish(document); boundary('effect-group-published');
                return structuredClone(command.effectGroup);
            });
        },
        recordPreparation(logicalKey, frozen) {
            return exclusive(() => {
                const document = load(), command = document && find(document, logicalKey);
                if (!command || command.status !== 'pending' || command.steps.length || command.effectGroup) fail('preparation-already-sealed');
                semanticBytes(frozen);
                if (command.preparation && semanticBytes(command.preparation) !== semanticBytes(frozen)) fail('preparation-input-conflict');
                if (!command.preparation) { command.preparation = structuredClone(frozen); publish(document); boundary('preparation-inputs-published'); }
                return structuredClone(command.preparation);
            });
        },
        apply(logicalKey, id) {
            return exclusive(() => {
                const document = load(); if (!document) fail('missing-acceptance-document');
                const command = find(document, logicalKey);
                if (!command || command.status === 'completed') fail('command-not-pending');
                const step = command.steps.find(step => step.id === id); if (!step) fail('unknown-effect-key');
                if (step.dependencies.some(id => command.steps.find(item => item.id === id)?.status !== 'applied')) fail('effect-dependency-not-applied');
                if (step.status === 'applied' && command.steps.some((candidate, index) => candidate.target === step.target && index > command.steps.indexOf(step))) {
                    return { status: 'receipt-recorded', afterVersion: step.afterVersion };
                }
                const target = targetPath(step.target), current = readExact(target), version = byteVersion(current);
                const recordedAfter = step.kind === 'json-fields' ? null : Buffer.from(step.afterBase64, 'base64');
                let decision = 'already-landed';
                if (version !== step.afterVersion) {
                    let repair = false;
                    if (version !== step.beforeVersion && step.kind === 'archive-append' && current !== null) {
                        const prefix = current.subarray(0, step.originalLength), tail = current.subarray(step.originalLength);
                        const expectedTail = recordedAfter;
                        repair = current.length >= step.originalLength && byteVersion(prefix) === step.prefixVersion
                            && tail.length > 0 && tail.length < expectedTail.length && expectedTail.subarray(0, tail.length).equals(tail);
                    }
                    if (version !== step.beforeVersion && !repair) {
                        command.status = 'recovery-required'; command.conflict = { stepId: id, code: 'target-version-conflict', observedVersion: version };
                        publish(document); fail('recovery-required', command.conflict);
                    }
                    const after = step.kind === 'json-fields' ? applyLegacyFields(current, step.patches)
                        : step.kind === 'archive-append' ? Buffer.concat([(current ?? Buffer.alloc(0)).subarray(0, step.originalLength), recordedAfter]) : recordedAfter;
                    if (byteVersion(after) !== step.afterVersion) fail('prepared-write-payload-conflict');
                    boundary(`before-write:${id}`);
                    if (step.kind === 'archive-append' && !repair) {
                        const fd = fs.openSync(target, 'a');
                        try { fs.writeFileSync(fd, recordedAfter); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
                    } else publishDurable(target, after, point => boundary(`target:${id}:${point}`));
                    boundary(`after-write:${id}`);
                    if (byteVersion(readExact(target)) !== step.afterVersion) fail('target-verification-failed');
                    decision = repair ? 'owned-tail-repaired' : 'applied';
                }
                step.status = 'applied';
                if (command.status === 'recovery-required') { command.status = 'pending'; delete command.conflict; }
                publish(document); boundary(`receipt:${id}`);
                return { status: decision, afterVersion: step.afterVersion };
            });
        },
        complete(logicalKey, expectedStepIds, outcome) {
            return exclusive(() => {
                const document = load(); if (!document) fail('missing-acceptance-document');
                const command = find(document, logicalKey); if (!command) fail('unknown-command');
                if (command.status === 'completed') return structuredClone(command.outcome);
                if (command.status !== 'pending' || command.steps.length !== expectedStepIds.length || expectedStepIds.some((id, index) => command.steps[index]?.id !== id)) fail('incomplete-effect-plan');
                for (const step of command.steps) {
                    if (step.status !== 'applied') fail('incomplete-effect-plan');
                    const lastForTarget = command.steps.filter(candidate => candidate.target === step.target).at(-1);
                    if (lastForTarget === step && byteVersion(readExact(targetPath(step.target))) !== step.afterVersion) fail('target-version-conflict');
                }
                if (document.generation === Number.MAX_SAFE_INTEGER) fail('head-generation-exhausted');
                command.status = 'completed'; command.outcome = { ...structuredClone(outcome), head: command.resultingHead, sceneNumber: command.sceneNumber };
                document.head = command.resultingHead; document.generation++;
                publish(document); boundary('outcome-published'); return structuredClone(command.outcome);
            });
        },
        acknowledge(logicalKey, resultingHead) {
            return exclusive(() => {
                const document = load(); if (!document) fail('missing-acceptance-document');
                const command = find(document, logicalKey);
                if (!command || command.status !== 'completed' || command.outcome.head !== resultingHead) fail('invalid-outcome-acknowledgement');
                if (!command.acknowledged) { command.acknowledged = true; publish(document); }
                return structuredClone(command.outcome);
            });
        },
        recordDerivedRecall(logicalKey, expected, status) {
            return exclusive(() => {
                const document = load(), command = document && find(document, logicalKey);
                if (!command || command.status !== 'completed' || !['dispatched', 'produced', 'incomplete', 'superseded'].includes(status)) fail('invalid-derived-recall-disposition');
                if (command.derivedRecall?.status !== expected) return false;
                command.derivedRecall = { status }; publish(document); return true;
            });
        },
    };
}
