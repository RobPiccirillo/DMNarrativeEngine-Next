import type { CompatibilityReference } from './identity.js';
import { parseCompatibilityReference } from './identity.js';

export type DraftRef = CompatibilityReference<'draft'>;
export type RevisionRef = CompatibilityReference<'revision'>;
export type AttemptRef = CompatibilityReference<'generation-attempt'>;
export type LifecycleState = 'draft' | 'streaming' | 'ready' | 'acceptance-pending' | 'recovery-required' | 'accepted' | 'acknowledged' | 'conflicted' | 'discarded' | 'closed';
export type AttemptKind = 'initial' | 'retry' | 'swipe' | 'regenerate' | 'continue';
export type AttemptStatus = 'streaming' | 'completed' | 'failed' | 'aborted' | 'interrupted';
export type StoryHash = `story-visible-v1:sha256:${string}`;
const lifecycleStates: readonly LifecycleState[] = ['draft', 'streaming', 'ready', 'acceptance-pending', 'recovery-required', 'accepted', 'acknowledged', 'conflicted', 'discarded', 'closed'];
const attemptKinds: readonly AttemptKind[] = ['initial', 'retry', 'swipe', 'regenerate', 'continue'];
const attemptStatuses: readonly AttemptStatus[] = ['streaming', 'completed', 'failed', 'aborted', 'interrupted'];

export interface GenerationAttempt {
    readonly id: AttemptRef;
    readonly setId: DraftRef;
    readonly kind: AttemptKind;
    readonly sourceAttemptId?: AttemptRef;
    readonly sourceRevisionId?: RevisionRef;
    readonly profileId: 'current' | 'constrained-local-v1';
    readonly modelAlias?: string;
    readonly callReference: string;
    readonly status: AttemptStatus;
    readonly generationPosition?: string;
}

export interface RevisionMetadata {
    readonly revisionId: RevisionRef;
    readonly hash: StoryHash;
    readonly version: string;
    readonly sceneStakes?: 'calm' | 'tense' | 'dangerous';
    readonly tagPresent?: boolean;
}

export interface DraftRevision {
    readonly id: RevisionRef;
    readonly setId: DraftRef;
    readonly attemptId?: AttemptRef;
    readonly parentRevisionId?: RevisionRef;
    readonly reason: AttemptKind | 'edit' | 'compatibility';
    readonly provenance: 'host-generation' | 'user-edit' | 'legacy-compatibility';
    readonly text: string;
    readonly hash: StoryHash;
    readonly metadata?: RevisionMetadata;
    readonly generationPosition?: string;
}

export interface DraftSet {
    readonly id: DraftRef;
    readonly campaignInstance: string;
    readonly turnReference: string;
    readonly sourceMessageId: string;
    readonly assistantMessageId: string;
    readonly archivedUserText: string;
    readonly expectedHead: string;
    readonly revisionOrder: readonly RevisionRef[];
    readonly revisions: readonly DraftRevision[];
    readonly attempts: readonly GenerationAttempt[];
    readonly selectedRevisionId?: RevisionRef;
    readonly displayedRevisionId?: RevisionRef;
    readonly selectionVersion: string;
    readonly state: LifecycleState;
    readonly conflict?: string;
}

export interface AcceptanceCandidate {
    readonly campaignInstance: string;
    readonly setId: DraftRef;
    readonly turnReference: string;
    readonly sourceMessageId: string;
    readonly assistantMessageId: string;
    readonly revisionId: RevisionRef;
    readonly hash: StoryHash;
    readonly expectedHead: string;
    readonly expectedSelectionVersion: string;
    readonly archivedUserText: string;
    readonly metadataVersion?: string;
    readonly generationPosition?: string;
}

export function isGenerationPosition(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const parts: unknown = JSON.parse(value);
        return Array.isArray(parts) && parts.length === 5 && parts.slice(0, 2).every(part => part === null || typeof part === 'string')
            && (parts[2] === null || typeof parts[2] === 'number' && Number.isFinite(parts[2]))
            && (parts[3] === null || typeof parts[3] === 'object' && !Array.isArray(parts[3]))
            && typeof parts[4] === 'number' && Number.isFinite(parts[4]);
    } catch { return false; }
}

export function storyVisibleBytes(text: string): Uint8Array {
    if (typeof text !== 'string') throw new TypeError('Story must be a string');
    encodeURIComponent(text);
    const encoded = encodeURIComponent(JSON.stringify({ schema: 'story-visible-v1', text }));
    const bytes: number[] = [];
    for (let offset = 0; offset < encoded.length; offset++) {
        if (encoded[offset] === '%') { bytes.push(parseInt(encoded.slice(offset + 1, offset + 3), 16)); offset += 2; }
        else bytes.push(encoded.charCodeAt(offset));
    }
    return Uint8Array.from(bytes);
}

export async function hashStoryVisible(text: string, digest: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<StoryHash> {
    const bytes = await digest(storyVisibleBytes(text));
    if (bytes.length !== 32) throw new TypeError('Expected SHA-256 digest');
    return `story-visible-v1:sha256:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function editable(set: DraftSet): void {
    if (!['draft', 'streaming', 'ready'].includes(set.state)) throw new Error('draft-not-editable');
}

function newVersion(set: DraftSet, version: string): void {
    if (typeof version !== 'string' || !version.trim() || version === set.selectionVersion) throw new Error('selection-version-reused');
}

function unique(values: readonly string[]): boolean {
    return new Set(values).size === values.length && values.every(value => typeof value === 'string' && value.length > 0);
}

function scoped(value: unknown, kind: string, campaignInstance: string): boolean {
    if (!parseCompatibilityReference(value, kind)) return false;
    const parts = JSON.parse(decodeURIComponent((value as string).slice('sid:1:r:'.length))) as string[];
    return parts[1] === campaignInstance && parts[5] === 'compatibility';
}

export function validateDraftSet(set: DraftSet): void {
    for (const field of ['campaignInstance', 'id', 'turnReference', 'sourceMessageId', 'assistantMessageId', 'expectedHead', 'selectionVersion'] as const) {
        if (typeof set[field] !== 'string' || !set[field].trim()) throw new Error('invalid-draft-binding');
        encodeURIComponent(set[field]);
    }
    if (!scoped(set.id, 'draft', set.campaignInstance) || !scoped(set.turnReference, 'turn', set.campaignInstance)) throw new Error('invalid-draft-scope');
    if (!lifecycleStates.includes(set.state) || typeof set.archivedUserText !== 'string' || !Array.isArray(set.revisions) || !Array.isArray(set.attempts) || !Array.isArray(set.revisionOrder)) throw new Error('invalid-draft-shape');
    if (!unique(set.revisions.map(revision => revision.id)) || !unique(set.attempts.map(attempt => attempt.id)) || !unique(set.revisionOrder)) throw new Error('duplicate-draft-reference');
    const revisions = new Map(set.revisions.map(revision => [revision.id, revision]));
    if (set.revisionOrder.length !== revisions.size || set.revisionOrder.some(id => !revisions.has(id))) throw new Error('invalid-revision-order');
    for (const revision of set.revisions) {
        storyVisibleBytes(revision.text);
        if (!scoped(revision.id, 'revision', set.campaignInstance)) throw new Error('invalid-revision-scope');
        if (![...attemptKinds, 'edit', 'compatibility'].includes(revision.reason) || !['host-generation', 'user-edit', 'legacy-compatibility'].includes(revision.provenance)) throw new Error('invalid-revision-provenance');
        if (revision.setId !== set.id || !/^story-visible-v1:sha256:[a-f0-9]{64}$/.test(revision.hash)) throw new Error('invalid-revision');
        if (revision.generationPosition !== undefined && !isGenerationPosition(revision.generationPosition)) throw new Error('invalid-generation-position');
        if (revision.reason === 'edit' && revision.generationPosition !== revisions.get(revision.parentRevisionId!)?.generationPosition) throw new Error('generation-position-binding-conflict');
        if (revision.attemptId && revision.generationPosition !== set.attempts.find(attempt => attempt.id === revision.attemptId)?.generationPosition) throw new Error('generation-position-binding-conflict');
        if (revision.parentRevisionId && !revisions.has(revision.parentRevisionId)) throw new Error('missing-parent-revision');
        if (attemptKinds.includes(revision.reason as AttemptKind) && !revision.attemptId) throw new Error('generation-revision-requires-attempt');
        if (revision.attemptId && !set.attempts.some(attempt => attempt.id === revision.attemptId
            && (attempt.status === 'completed' || (revision.reason === 'continue' && attempt.status === 'aborted')))) throw new Error('missing-completed-attempt');
        if ((revision.reason === 'edit' || revision.reason === 'continue') && !revision.parentRevisionId) throw new Error('child-requires-parent');
        if (revision.reason === 'edit' && (revision.attemptId || revision.metadata || revision.provenance !== 'user-edit')) throw new Error('edit-retains-generation-metadata');
        if (revision.metadata && (revision.metadata.revisionId !== revision.id || revision.metadata.hash !== revision.hash || !revision.metadata.version
            || (revision.metadata.sceneStakes !== undefined && !['calm', 'tense', 'dangerous'].includes(revision.metadata.sceneStakes))
            || (revision.metadata.tagPresent !== undefined && typeof revision.metadata.tagPresent !== 'boolean'))) throw new Error('invalid-metadata-binding');
        const seen = new Set<string>([revision.id]);
        let parent = revision.parentRevisionId;
        while (parent) {
            if (seen.has(parent)) throw new Error('cyclic-revision-lineage');
            seen.add(parent); parent = revisions.get(parent)?.parentRevisionId;
        }
    }
    for (const attempt of set.attempts) {
        if (attempt.generationPosition !== undefined && !isGenerationPosition(attempt.generationPosition)) throw new Error('invalid-generation-position');
        if (attempt.setId !== set.id || !attempt.callReference || !attemptKinds.includes(attempt.kind) || !attemptStatuses.includes(attempt.status)
            || !['current', 'constrained-local-v1'].includes(attempt.profileId) || !scoped(attempt.id, 'generation-attempt', set.campaignInstance)) throw new Error('invalid-attempt-binding');
        if (attempt.sourceRevisionId && !revisions.has(attempt.sourceRevisionId)) throw new Error('invalid-attempt-source');
        if (attempt.sourceAttemptId && !set.attempts.some(source => source.id === attempt.sourceAttemptId && source.id !== attempt.id)) throw new Error('invalid-attempt-lineage');
        if (['swipe', 'continue'].includes(attempt.kind) && !attempt.sourceRevisionId) throw new Error('attempt-requires-source-revision');
        if (['retry', 'regenerate'].includes(attempt.kind) && !attempt.sourceRevisionId && !attempt.sourceAttemptId) throw new Error('attempt-requires-lineage');
        const seen = new Set<string>([attempt.id]);
        let parent = attempt.sourceAttemptId;
        while (parent) {
            if (seen.has(parent)) throw new Error('cyclic-attempt-lineage');
            seen.add(parent); parent = set.attempts.find(item => item.id === parent)?.sourceAttemptId;
        }
    }
    for (const pointer of [set.selectedRevisionId, set.displayedRevisionId]) if (pointer && !revisions.has(pointer)) throw new Error('invalid-revision-pointer');
}

export function addAttempt(set: DraftSet, attempt: GenerationAttempt, version: string): DraftSet {
    editable(set); newVersion(set, version);
    if (attempt.status !== 'streaming' || set.attempts.some(existing => existing.id === attempt.id)) throw new Error('invalid-new-attempt');
    const next: DraftSet = { ...set, attempts: [...set.attempts, { ...attempt }], selectionVersion: version, state: set.selectedRevisionId ? 'ready' : 'streaming' };
    validateDraftSet(next); return next;
}

export function finishAttempt(set: DraftSet, id: AttemptRef, status: Exclude<AttemptStatus, 'streaming'>, version: string): DraftSet {
    editable(set); newVersion(set, version);
    const attempt = set.attempts.find(item => item.id === id);
    if (!attempt || attempt.status !== 'streaming') throw new Error('attempt-already-finalized');
    return { ...set, attempts: set.attempts.map(item => item.id === id ? { ...item, status } : item), selectionVersion: version,
        state: set.selectedRevisionId ? 'ready' : 'draft' };
}

export function sealRevision(set: DraftSet, revision: DraftRevision, version: string, select = true): DraftSet {
    editable(set); newVersion(set, version);
    if (set.revisions.some(item => item.id === revision.id)) throw new Error('revision-already-finalized');
    if (!revision.text.trim()) throw new Error('empty-visible-story');
    if ((revision.reason === 'edit' || revision.reason === 'continue') && !revision.parentRevisionId) throw new Error('child-requires-parent');
    if (revision.reason === 'edit' && (revision.attemptId || revision.metadata)) throw new Error('edit-retains-generation-metadata');
    const next: DraftSet = { ...set, revisions: [...set.revisions, Object.freeze({ ...revision,
        ...(revision.metadata ? { metadata: Object.freeze({ ...revision.metadata }) } : {}) })],
        revisionOrder: [...set.revisionOrder, revision.id], selectionVersion: version,
        ...(select ? { selectedRevisionId: revision.id, displayedRevisionId: revision.id, state: 'ready' } : {}) };
    validateDraftSet(next); return next;
}

export function selectRevision(set: DraftSet, revisionId: RevisionRef, version: string, displayed = true): DraftSet {
    editable(set); newVersion(set, version);
    if (!set.revisions.some(revision => revision.id === revisionId)) throw new Error('unknown-revision');
    return { ...set, selectedRevisionId: revisionId, ...(displayed ? { displayedRevisionId: revisionId } : {}), selectionVersion: version, state: 'ready' };
}

export function acceptanceCandidate(set: DraftSet, displayedText: string): AcceptanceCandidate {
    validateDraftSet(set);
    if (!set.archivedUserText.trim()) throw new Error('empty-source-player-action');
    if (set.state !== 'ready' || !set.selectedRevisionId || set.selectedRevisionId !== set.displayedRevisionId) throw new Error('selection-display-conflict');
    const revision = set.revisions.find(item => item.id === set.selectedRevisionId)!;
    if (revision.text !== displayedText || !revision.text.trim()) throw new Error('selection-text-conflict');
    return { campaignInstance: set.campaignInstance, setId: set.id, turnReference: set.turnReference,
        sourceMessageId: set.sourceMessageId, assistantMessageId: set.assistantMessageId, revisionId: revision.id,
        hash: revision.hash, expectedHead: set.expectedHead, expectedSelectionVersion: set.selectionVersion,
        archivedUserText: set.archivedUserText, ...(revision.metadata ? { metadataVersion: revision.metadata.version } : {}),
        ...(revision.generationPosition ? { generationPosition: revision.generationPosition } : {}) };
}

export function interruptAttempts(set: DraftSet, version: string): DraftSet {
    if (!set.attempts.some(attempt => attempt.status === 'streaming')) return set;
    newVersion(set, version);
    return { ...set, attempts: set.attempts.map(attempt => attempt.status === 'streaming' ? { ...attempt, status: 'interrupted' } : attempt),
        selectionVersion: version, state: ['draft', 'streaming', 'ready'].includes(set.state) ? (set.selectedRevisionId ? 'ready' : 'draft') : set.state };
}
