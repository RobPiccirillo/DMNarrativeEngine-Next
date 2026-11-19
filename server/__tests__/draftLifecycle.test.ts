import { describe, expect, it } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { acceptanceCandidate, addAttempt, finishAttempt, hashStoryVisible, interruptAttempts, sealRevision, selectRevision, storyVisibleBytes, validateDraftSet } from '../../packages/engine/src/contracts/draftLifecycle';
import type { DraftRevision, StoryHash } from '../../packages/engine/src/contracts/draftLifecycle';
import { upgradeLegacyPending } from '../../packages/engine/src/contracts/draftCompatibility';
import { createCompatibilityReferences } from '../../packages/engine/src/contracts/identity';
import { isLegacyAcceptanceCommand } from '../../packages/engine/src/contracts/legacyAcceptance';

const hash = (text: string) => hashStoryVisible(text, async bytes => new Uint8Array(createHash('sha256').update(bytes).digest()));
const fixture = () => [{ id: 'u', role: 'user', content: 'Wait' }, { id: 'a', role: 'assistant', content: 'Story', pendingCommit: true,
    swipeSet: [{ id: 'v', text: 'Story' }, { id: 'v2', text: 'Story' }], swipeActiveIndex: 0 }];
const ready = async () => {
    const result = await upgradeLegacyPending({ campaignInstance: 'instance', expectedHead: 'head', messages: fixture(), hash });
    if (result.status !== 'ready') throw new Error(result.reason);
    return result.set;
};
const ref = <K extends string>(kind: K, locator: string, campaign = 'instance') => createCompatibilityReferences({
    kind, campaign, namespace: 'test-host', family: 'phase3', version: 'v1', scope: { mode: 'compatibility' },
}, [locator])[0];

describe('story-visible-v1 cross-runtime encoding', () => {
    for (const text of ['', 'Story', ' Story ', 'A\r\nB', 'A\nB', '\t\n', 'é', 'e\u0301', '🧙🏽‍♂️', '\u0000']) {
        it(`keeps exact bytes ${JSON.stringify(text)}`, async () => {
            const browser = await hashStoryVisible(text, async bytes => new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)));
            expect(browser).toBe(await hash(text));
            expect(new TextDecoder().decode(storyVisibleBytes(text))).toBe(JSON.stringify({ schema: 'story-visible-v1', text }));
        });
    }
    it('rejects malformed UTF-16 instead of silently replacing it', async () => {
        await expect(hash('\ud800')).rejects.toThrow();
        await expect(hash('\udc00')).rejects.toThrow();
    });
    it('distinguishes whitespace, line endings and Unicode normalization', async () => {
        expect(new Set(await Promise.all(['Story', ' Story', 'Story ', 'A\r\nB', 'A\nB', 'é', 'e\u0301'].map(hash))).size).toBe(7);
    });
    it('pins the fixed-field hash encoding', async () => {
        expect(await hash('Story')).toBe('story-visible-v1:sha256:f9d63819d23eeeed8cb2bd5d51c9ba73a7e913fca353a99ec480eeb8498d7771');
    });
});

describe('immutable revision and exact candidate transitions', () => {
    it('preserves distinct equal-text identities across reorder and serialization', async () => {
        const set = await ready();
        expect(set.revisions[0].id).not.toBe(set.revisions[1].id);
        expect(set.revisions[0].hash).toBe(set.revisions[1].hash);
        const reordered = JSON.parse(JSON.stringify({ ...set, revisionOrder: [...set.revisionOrder].reverse() }));
        expect(acceptanceCandidate(reordered, 'Story').revisionId).toBe(set.selectedRevisionId);
    });
    it('edits append a child even when bytes are equal and invalidate parent metadata', async () => {
        const set = await ready();
        const child = { ...set.revisions[0], id: set.revisions[1].id.replace('v2', 'child'), reason: 'edit',
            provenance: 'user-edit', parentRevisionId: set.selectedRevisionId } as DraftRevision;
        const next = sealRevision(set, child, 'next');
        expect(next.revisions).toHaveLength(3);
        expect(set.revisions).toHaveLength(2);
        expect(Object.isFrozen(next.revisions[2])).toBe(true);
        expect(() => sealRevision(next, child, 'again')).toThrow('revision-already-finalized');
        expect(() => sealRevision(set, { ...child, metadata: { revisionId: child.id, hash: child.hash, version: 'old' } }, 'next')).toThrow();
    });
    it('requires selected/displayed/text agreement and a new selection version', async () => {
        const set = await ready();
        const pendingDisplay = selectRevision(set, set.revisions[1].id, 'changed', false);
        expect(() => acceptanceCandidate(pendingDisplay, 'Story')).toThrow('selection-display-conflict');
        expect(() => acceptanceCandidate(set, 'Story ')).toThrow('selection-text-conflict');
        expect(() => selectRevision(set, set.revisions[1].id, set.selectionVersion)).toThrow('selection-version-reused');
        expect(() => selectRevision({ ...set, state: 'acceptance-pending' }, set.revisions[1].id, 'new')).toThrow('draft-not-editable');
    });
    it('rejects invalid hashes and dangling parents', async () => {
        const set = await ready();
        expect(() => validateDraftSet({ ...set, revisions: [{ ...set.revisions[0], hash: 'broken' as StoryHash }] })).toThrow();
    });
    it('records Swipe siblings and Continue children with separate finalized attempts', async () => {
        const initial = await ready();
        const attempt = { id: ref('generation-attempt', 'swipe'), setId: initial.id, kind: 'swipe' as const, sourceRevisionId: initial.selectedRevisionId,
            profileId: 'current' as const, callReference: 'logical-call', status: 'streaming' as const };
        const started = addAttempt(initial, attempt, 'attempt-start');
        expect(acceptanceCandidate(started, 'Story').revisionId).toBe(initial.selectedRevisionId);
        const finished = finishAttempt(started, attempt.id, 'completed', 'attempt-end');
        const sibling = { id: ref('revision', 'sibling'), setId: initial.id, attemptId: attempt.id, reason: 'swipe' as const,
            provenance: 'host-generation' as const, text: 'Sibling', hash: await hash('Sibling') };
        const swiped = sealRevision(finished, sibling, 'swipe-final');
        expect(swiped.revisions[2].parentRevisionId).toBeUndefined();
        const continuedAttempt = { ...attempt, id: ref('generation-attempt', 'continue'), kind: 'continue' as const, sourceRevisionId: sibling.id };
        const continuing = addAttempt(swiped, continuedAttempt, 'continue-start');
        const aborted = finishAttempt(continuing, continuedAttempt.id, 'aborted', 'continue-abort');
        const child = { ...sibling, id: ref('revision', 'merged-child'), attemptId: continuedAttempt.id, parentRevisionId: sibling.id,
            reason: 'continue' as const, text: 'Sibling\n\nContinuation', hash: await hash('Sibling\n\nContinuation') };
        const merged = sealRevision(aborted, child, 'continue-final');
        expect(merged.turnReference).toBe(initial.turnReference);
        expect(acceptanceCandidate(merged, child.text).revisionId).toBe(child.id);
    });
    it('reload interrupts outstanding generation without reopening a frozen acceptance', async () => {
        const set = await ready();
        const started = addAttempt(set, { id: ref('generation-attempt', 'pending'), setId: set.id, kind: 'swipe', sourceRevisionId: set.selectedRevisionId,
            profileId: 'current', callReference: 'call', status: 'streaming' }, 'started');
        const frozen = { ...started, state: 'acceptance-pending' as const };
        const reloaded = interruptAttempts(frozen, 'reloaded');
        expect(reloaded.state).toBe('acceptance-pending'); expect(reloaded.attempts[0].status).toBe('interrupted');
        expect(interruptAttempts(reloaded, 'unused')).toBe(reloaded);
    });
});

describe('explicit legacy acceptance envelope', () => {
    const envelope = async () => {
        const set = await ready();
        return { binding: 'legacy-compatibility-v1', campaignInstance: 'instance', campaign: { type: 'compatibility', kind: 'campaign', id: ref('campaign', 'campaign') },
            commandId: ref('command', 'command'), domainId: 'narrative-evidence', kind: 'story.accept',
            provenance: { origin: 'current-user-action', writerId: 'host.acceptance', turn: { type: 'compatibility', kind: 'turn', id: set.turnReference },
                message: { type: 'compatibility', kind: 'message', id: ref('message', set.sourceMessageId) },
                source: { type: 'compatibility', kind: 'revision', id: set.selectedRevisionId } },
            expectedOwner: 'legacy-runtime', expectedFormatEpoch: 1, expectedVersion: { mode: 'exact', version: 'head' },
            idempotency: { mode: 'command-id' }, sources: [], evidence: [], payload: acceptanceCandidate(set, 'Story') };
    };
    it('requires compatibility scope without inventing canonical adoption', async () => {
        expect(isLegacyAcceptanceCommand(await envelope())).toBe(true);
        const invalid = await envelope(); invalid.campaign.id = ref('campaign', 'campaign', 'other-instance');
        expect(isLegacyAcceptanceCommand(invalid)).toBe(false);
    });
    it.each(['provenance', 'expectedVersion', 'expectedFormatEpoch', 'idempotency', 'sources', 'evidence'])('rejects missing %s', async field => {
        const command = await envelope(); delete (command as Record<string, unknown>)[field]; expect(isLegacyAcceptanceCommand(command)).toBe(false);
    });
    it('rejects changed revision/source bindings and caller metadata pretending to authorize acceptance', async () => {
        const command = await envelope(); command.payload.revisionId = ref('revision', 'unrelated');
        expect(isLegacyAcceptanceCommand(command)).toBe(false);
        expect(isLegacyAcceptanceCommand({ pendingCommit: true, sceneId: '001', origin: 'host', manual: true })).toBe(false);
    });
});

describe('legacy upgrade retains evidence', () => {
    it('produces stable mapping without array identity or accepted-history rewrite', async () => {
        const input = fixture(); const original = JSON.stringify(input);
        const first = await ready(); const second = await ready();
        expect(first).toEqual(second); expect(JSON.stringify(input)).toBe(original);
    });
    for (const variant of ['duplicate', 'missing', 'index', 'mismatch', 'stamp', 'failure'] as const) {
        it(`preserves and blocks ${variant}`, async () => {
            const messages = fixture();
            if (variant === 'duplicate') messages[1].swipeSet![1].id = 'v';
            if (variant === 'missing') messages[1].id = '';
            if (variant === 'index') messages[1].swipeActiveIndex = 8;
            if (variant === 'mismatch') { messages[1].swipeSet![1].text = 'Other'; messages[1].content = 'Other'; }
            if (variant === 'stamp') Object.assign(messages[1], { sceneId: '001' });
            if (variant === 'failure') Object.assign(messages[1], { commitFailed: true });
            const result = await upgradeLegacyPending({ campaignInstance: 'instance', expectedHead: 'head', messages, hash });
            expect(result).toMatchObject({ status: 'recovery-required', preserved: messages });
        });
    }
    it('retains every sibling and an unambiguous pre-upgrade visible edit as a child', async () => {
        const messages = fixture(); messages[1].content = 'Edited';
        const result = await upgradeLegacyPending({ campaignInstance: 'instance', expectedHead: 'head', messages, hash });
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.set.revisions).toHaveLength(3);
        expect(result.set.revisions[2]).toMatchObject({ text: 'Edited', parentRevisionId: result.set.revisions[0].id });
    });
    it('does not cross already accepted history to invent an orphaned source message', async () => {
        const messages = [fixture()[0], { id: 'accepted', role: 'assistant', content: 'Accepted history', sceneId: '001' }, fixture()[1]];
        const result = await upgradeLegacyPending({ campaignInstance: 'instance', expectedHead: 'head', messages, hash });
        expect(result).toMatchObject({ status: 'recovery-required', reason: 'missing-source-message', preserved: messages });
    });
    it('preserves malformed variant records in a typed recovery result', async () => {
        const messages = fixture(); (messages[1].swipeSet as unknown[]) = [null];
        const result = await upgradeLegacyPending({ campaignInstance: 'instance', expectedHead: 'head', messages, hash });
        expect(result).toMatchObject({ status: 'recovery-required', reason: 'invalid-legacy-variant-shape', preserved: messages });
    });
});
