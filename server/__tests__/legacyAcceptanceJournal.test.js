import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createLegacyAcceptanceJournal, semanticBytes } from '../services/legacyAcceptanceJournal.js';

const child = path.resolve('server/__tests__/fixtures/phase3JournalChild.mjs');
const roots = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-native-')); roots.push(root); return root; };
afterEach(() => {
    for (const root of roots.splice(0)) {
        if (!path.resolve(root).startsWith(path.join(os.tmpdir(), 'phase3-native-'))) throw new Error('unsafe-test-cleanup');
        fs.rmSync(root, { recursive: true, force: true });
    }
});
const open = (root, options = {}) => createLegacyAcceptanceJournal({ directory: root, storageId: 'fixture', campaignInstance: 'isolated-instance',
    targets: { state: '.state.json', archive: '.archive.md' }, ...options });
const request = (overrides = {}) => ({ campaignInstance: 'isolated-instance', commandId: 'command', logicalKey: 'command', expectedHead: 'head',
    semantic: { kind: 'story.accept', revisionId: 'revision', expectedHead: 'head' }, frozen: { text: 'Story' }, ...overrides });

async function processRun(root, mode, boundary = '') {
    return new Promise((resolve, reject) => {
        const process = fork(child, [root, mode, boundary], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        let stderr = '', result, hit;
        process.stderr.on('data', data => { stderr += data; });
        const timer = setTimeout(() => { process.kill('SIGKILL'); reject(new Error(`child timed out: ${mode} ${boundary}: ${stderr}`)); }, 15000);
        process.on('error', reject);
        process.on('message', message => {
            if (message.boundary) { hit = message.boundary; process.kill('SIGKILL'); }
            if (message.result) result = message.result;
        });
        process.on('exit', code => {
            clearTimeout(timer);
            if (hit) resolve({ killedAt: hit });
            else if (code === 0 && result) resolve({ result });
            else reject(new Error(`child failed ${code}: ${stderr}`));
        });
    });
}

describe('prepared legacy writes with strict read evidence', () => {
    it('checks original request before current head, returns original outcome and rejects changed semantics', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' });
        const intent = journal.begin(request(), () => {});
        journal.prepare('command', { id: 'counter', target: 'state', after: Buffer.from('{"counter":1}') });
        journal.apply('command', 'counter');
        const outcome = journal.complete('command', ['counter'], { revisionId: 'revision' });
        expect(journal.begin(request({ expectedHead: 'stale' }), () => { throw new Error('must-not-check-current'); }).outcome).toEqual(outcome);
        expect(() => journal.begin(request({ semantic: { kind: 'story.accept', revisionId: 'changed', expectedHead: 'head' } }), () => {})).toThrow('idempotency-key-reused');
        expect(outcome.head).toBe(intent.resultingHead);
    });
    it('stale unseen requests make zero journal or target writes', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' });
        const file = path.join(root, 'fixture.acceptance.json'), before = fs.readFileSync(file);
        expect(() => journal.begin(request({ expectedHead: 'stale' }), () => {})).toThrow('version-conflict');
        expect(() => journal.begin(request(), () => { throw new Error('stale-selection'); })).toThrow('stale-selection');
        expect(fs.readFileSync(file)).toEqual(before); expect(fs.readdirSync(root)).toEqual(['fixture.acceptance.json']);
    });
    it('retains unexpected target bytes and explicit conflict instead of overwriting them', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' }); journal.begin(request(), () => {});
        journal.prepare('command', { id: 'state', target: 'state', after: Buffer.from('after') });
        fs.writeFileSync(path.join(root, 'fixture.state.json'), 'unrelated');
        expect(() => journal.apply('command', 'state')).toThrow('recovery-required');
        expect(fs.readFileSync(path.join(root, 'fixture.state.json'), 'utf8')).toBe('unrelated');
        expect(journal.load().commands[0]).toMatchObject({ status: 'recovery-required', conflict: { stepId: 'state', code: 'target-version-conflict' } });
    });
    it('never truncates an unexplained archive tail or prefix', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' }); journal.begin(request(), () => {});
        const archive = path.join(root, 'fixture.archive.md'); fs.writeFileSync(archive, 'existing\n');
        journal.prepare('command', { id: 'archive', target: 'archive', kind: 'archive-append', after: Buffer.from('owned new block') });
        fs.appendFileSync(archive, 'unowned prose'); const before = fs.readFileSync(archive);
        expect(() => journal.apply('command', 'archive')).toThrow('recovery-required'); expect(fs.readFileSync(archive)).toEqual(before);
    });
    it('fails closed on corrupt/schema/binding mismatch and does not turn it into empty history', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' });
        const file = path.join(root, 'fixture.acceptance.json'); fs.writeFileSync(file, '{');
        expect(() => journal.load()).toThrow('corrupt-lifecycle-file'); expect(() => journal.initialize({ head: 'head' })).toThrow();
        fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2 })); expect(() => journal.load()).toThrow('unsupported-acceptance-schema');
    });
    it('rejects unknown target capabilities and incomplete effect plans', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' }); journal.begin(request(), () => {});
        expect(() => journal.prepare('command', { id: 'escape', target: '../../outside', after: Buffer.from('x') })).toThrow('unknown-effect-target');
        journal.prepare('command', { id: 'state', target: 'state', after: Buffer.from('after') });
        expect(() => journal.complete('command', ['state'], {})).toThrow('incomplete-effect-plan');
    });
    it('serializes semantic objects deterministically and preserves arrays and exact text', () => {
        expect(semanticBytes({ b: 2, a: [' x ', '\r\n'] })).toBe(semanticBytes({ a: [' x ', '\r\n'], b: 2 }));
        expect(semanticBytes(['a', 'b'])).not.toBe(semanticBytes(['b', 'a']));
        expect(() => semanticBytes({ value: undefined })).toThrow();
        expect(() => semanticBytes(['\ud800'])).toThrow();
    });
    it('records exact changed fields instead of copying chat history into a receipt', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' }); journal.begin(request(), () => {});
        const stateFile = path.join(root, 'fixture.state.json');
        fs.writeFileSync(stateFile, JSON.stringify({ messages: [{ id: 'old', content: 'private unrelated history' }, { id: 'assistant', content: 'selected', pendingCommit: true }], counter: 7 }));
        const prepared = journal.prepare('command', { id: 'link', target: 'state', kind: 'json-fields', changes: [
            { path: ['messages', { id: 'assistant' }, 'sceneId'], after: { present: true, value: '001' } },
            { path: ['messages', { id: 'assistant' }, 'pendingCommit'], after: { present: false } },
            { path: ['counter'], after: { present: true, value: 8 } },
        ] });
        expect(prepared.patches[2]).toMatchObject({ before: { present: true, value: 7 }, after: { present: true, value: 8 } });
        expect(JSON.stringify(prepared)).not.toContain('private unrelated history');
        journal.apply('command', 'link'); journal.apply('command', 'link');
        expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).toEqual({ messages: [{ id: 'old', content: 'private unrelated history' }, { id: 'assistant', content: 'selected', sceneId: '001' }], counter: 8 });
    });
    it('rejects ambiguous record locators and prototype traversal before publication', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' }); journal.begin(request(), () => {});
        fs.writeFileSync(path.join(root, 'fixture.state.json'), JSON.stringify({ messages: [{ id: 'same' }, { id: 'same' }] }));
        expect(() => journal.prepare('command', { id: 'bad', target: 'state', kind: 'json-fields', changes: [
            { path: ['messages', { id: 'same' }, 'sceneId'], after: { present: true, value: '001' } },
        ] })).toThrow('ambiguous-patch-record');
        expect(() => journal.prepare('command', { id: 'bad', target: 'state', kind: 'json-fields', changes: [
            { path: ['__proto__', 'polluted'], after: { present: true, value: true } },
        ] })).toThrow('invalid-field-path');
        expect(journal.load().commands[0].steps).toHaveLength(0);
    });
    it('reconciles an ordered chain against one target without restoring an older after-value', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' }); journal.begin(request(), () => {});
        journal.prepare('command', { id: 'first', target: 'state', after: Buffer.from('{"counter":1}') }); journal.apply('command', 'first');
        journal.prepare('command', { id: 'second', target: 'state', after: Buffer.from('{"counter":2}'), dependencies: ['first'] }); journal.apply('command', 'second');
        const fresh = open(root);
        expect(fresh.apply('command', 'first').status).toBe('receipt-recorded');
        expect(fresh.apply('command', 'second').status).toBe('already-landed');
        expect(fs.readFileSync(path.join(root, 'fixture.state.json'), 'utf8')).toBe('{"counter":2}');
        fresh.complete('command', ['first', 'second'], { revisionId: 'revision' });
    });
    it('does not capture unexplained changes as a new before-value between dependent steps', () => {
        const root = temporary(), journal = open(root); journal.initialize({ head: 'head' }); journal.begin(request(), () => {});
        journal.prepare('command', { id: 'first', target: 'state', after: Buffer.from('one') }); journal.apply('command', 'first');
        fs.writeFileSync(path.join(root, 'fixture.state.json'), 'unexplained');
        expect(() => journal.prepare('command', { id: 'second', target: 'state', after: Buffer.from('two') })).toThrow('target-version-conflict');
        expect(journal.load().commands[0].steps).toHaveLength(1);
    });
});

describe('fresh-process native recovery protocol', () => {
    const boundaries = ['intent-published', 'prepared:archive', 'after-write:archive', 'receipt:archive',
        ...['index', 'entities', 'chapters', 'pressure-agency-repression', 'compute-table', 'state-link-counter']
            .flatMap(id => [`prepared:${id}`, `before-write:${id}`, `after-write:${id}`, `receipt:${id}`]),
        'target:state-link-counter:temporary-synced', 'target:state-link-counter:renamed', 'outcome-published'];
    for (const boundary of boundaries) {
        it(`survives process death at ${boundary} without duplicated writes`, async () => {
            const root = temporary(); expect(await processRun(root, 'start', boundary)).toEqual({ killedAt: boundary });
            const recovery = await processRun(root, 'recover');
            expect(recovery.result.commands).toHaveLength(1);
            expect(recovery.result.commands[0]).toMatchObject({ status: 'completed', acknowledged: true });
            const state = JSON.parse(fs.readFileSync(path.join(root, 'fixture.state.json'), 'utf8'));
            expect(state.counter).toBe(8); expect(state.messages[0].content).toBe('Unrelated history retained.');
            expect(state.messages[1]).toMatchObject({ sceneId: '001', revisionId: 'revision-fixture' });
            expect(JSON.parse(fs.readFileSync(path.join(root, 'fixture.npcs.json'), 'utf8'))[0].agencyDraw).toBe(recovery.result.commands[0].frozen.draw);
            const settled = Object.fromEntries(fs.readdirSync(root).filter(name => !name.includes('.publish-')).map(name => [name, fs.readFileSync(path.join(root, name))]));
            const replay = await processRun(root, 'recover');
            expect(replay.result.commands[0].outcome).toEqual(recovery.result.commands[0].outcome);
            for (const [name, bytes] of Object.entries(settled)) expect(fs.readFileSync(path.join(root, name))).toEqual(bytes);
            expect((fs.readFileSync(path.join(root, 'fixture.archive.md'), 'utf8').match(/## SCENE/g) ?? [])).toHaveLength(1);
        });
    }
    it('repairs only the exactly owned partial append and can die during recovery itself', async () => {
        const root = temporary(); expect(await processRun(root, 'partial-append')).toEqual({ killedAt: 'partial-append' });
        expect(await processRun(root, 'recover', 'after-write:archive')).toEqual({ killedAt: 'after-write:archive' });
        const recovery = await processRun(root, 'recover'); expect(recovery.result.commands[0].status).toBe('completed');
        expect((fs.readFileSync(path.join(root, 'fixture.archive.md'), 'utf8').match(/## SCENE/g) ?? [])).toHaveLength(1);
    });
    for (const boundary of ['journal:temporary-opened', 'journal:temporary-written', 'journal:temporary-synced', 'journal:renamed', 'journal:directory-synced']) {
        it(`publishes no effects before durable intent at ${boundary}`, async () => {
            const root = temporary(); expect(await processRun(root, 'start', boundary)).toEqual({ killedAt: boundary });
            const read = open(root).load();
            expect(fs.existsSync(path.join(root, 'fixture.archive.md'))).toBe(false);
            if (read.commands.length) expect((await processRun(root, 'recover')).result.commands[0].status).toBe('completed');
            else expect((await processRun(root, 'recover')).result).toBe('ready-draft-no-intent');
        });
    }
});
