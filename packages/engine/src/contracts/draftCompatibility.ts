import { createCompatibilityReferences } from './identity.js';
import type { DraftRef, DraftRevision, DraftSet, RevisionRef, StoryHash } from './draftLifecycle.js';

export interface LegacyPendingMessage {
    readonly id: string;
    readonly role: string;
    readonly content: string;
    readonly displayContent?: string;
    readonly pendingCommit?: boolean;
    readonly commitFailed?: boolean;
    readonly sceneId?: string;
    readonly swipeActiveIndex?: number;
    readonly swipeSet?: readonly { readonly id: string; readonly text: string; readonly streaming?: boolean;
        readonly sceneStakes?: 'calm' | 'tense' | 'dangerous'; readonly tagPresent?: boolean }[];
}

export type CompatibilityResult =
    | { readonly status: 'ready'; readonly set: DraftSet }
    | { readonly status: 'recovery-required'; readonly reason: string; readonly preserved: readonly LegacyPendingMessage[] };

export async function upgradeLegacyPending(input: {
    campaignInstance: string; expectedHead: string; messages: readonly LegacyPendingMessage[];
    hash: (text: string) => Promise<StoryHash>;
}): Promise<CompatibilityResult> {
    const { messages, campaignInstance, expectedHead } = input;
    const conflict = (reason: string): CompatibilityResult => ({ status: 'recovery-required', reason, preserved: JSON.parse(JSON.stringify(messages)) as LegacyPendingMessage[] });
    if (!Array.isArray(messages) || messages.some(message => !message || typeof message !== 'object' || typeof message.content !== 'string'
        || typeof message.role !== 'string' || (message.pendingCommit !== undefined && typeof message.pendingCommit !== 'boolean')
        || (message.commitFailed !== undefined && typeof message.commitFailed !== 'boolean'))) return conflict('invalid-legacy-message-shape');
    const ids = messages.map(message => message.id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) return conflict('ambiguous-message-identity');
    const pending = messages.filter(message => message.pendingCommit || message.commitFailed);
    if (pending.length !== 1 || pending[0].role !== 'assistant') return conflict('ambiguous-pending-turn');
    const message = pending[0];
    if (message.commitFailed || message.sceneId !== undefined) return conflict('legacy-acceptance-evidence-required');
    let source: LegacyPendingMessage | undefined;
    for (const previous of messages.slice(0, messages.indexOf(message)).reverse()) {
        if (previous.role === 'assistant' && previous.sceneId) break;
        if (previous.role === 'user') { source = previous; break; }
    }
    if (!source) return conflict('missing-source-message');
    const variants = message.swipeSet;
    if (!Array.isArray(variants) || !variants.length) return conflict('missing-legacy-variants');
    if (variants.some(variant => !variant || typeof variant !== 'object' || typeof variant.text !== 'string'
        || (variant.sceneStakes !== undefined && !['calm', 'tense', 'dangerous'].includes(variant.sceneStakes))
        || (variant.tagPresent !== undefined && typeof variant.tagPresent !== 'boolean'))) return conflict('invalid-legacy-variant-shape');
    const variantIds = variants.map(variant => variant.id);
    if (variantIds.some(id => typeof id !== 'string' || !id) || new Set(variantIds).size !== variants.length) return conflict('ambiguous-variant-identity');
    const index = message.swipeActiveIndex;
    if (!Number.isInteger(index) || index! < 0 || index! >= variants.length) return conflict('ambiguous-legacy-selection');
    if (variants.some(variant => variant.streaming)) return conflict('interrupted-legacy-generation');
    if (message.displayContent !== undefined && message.displayContent !== message.content) return conflict('ambiguous-legacy-display');
    const reference = <K extends string>(kind: K, family: string, locators: readonly string[]) => createCompatibilityReferences({
        kind, campaign: campaignInstance, namespace: 'phase3-legacy', family, version: 'compatibility-v1', scope: { mode: 'compatibility' },
    }, locators);
    const setId = reference('draft', 'messages', [message.id])[0] as DraftRef;
    const revisionIds = reference('revision', message.id, variantIds);
    const revisions: DraftRevision[] = [];
    for (const [offset, variant] of variants.entries()) {
        if (typeof variant.text !== 'string' || !variant.text.trim()) return conflict('invalid-legacy-story');
        const hash = await input.hash(variant.text);
        revisions.push({ id: revisionIds[offset], setId, reason: 'compatibility', provenance: 'legacy-compatibility',
            text: variant.text, hash,
            ...(variant.sceneStakes !== undefined && variant.tagPresent !== undefined ? { metadata: {
                revisionId: revisionIds[offset], hash, version: reference('metadata-version', message.id, [variant.id])[0],
                sceneStakes: variant.sceneStakes, tagPresent: variant.tagPresent,
            } } : {}) });
    }
    let selected = revisionIds[index!];
    if (variants[index!].text !== message.content) {
        const matches = revisions.filter(revision => revision.text === message.content);
        if (matches.length) return conflict('ambiguous-index-text-disagreement');
        if (!message.content.trim()) return conflict('empty-visible-legacy-story');
        const child = reference('revision', message.id, ['compatibility-visible-edit'])[0] as RevisionRef;
        if (revisionIds.includes(child)) return conflict('compatibility-reference-collision');
        revisions.push({ id: child, setId, parentRevisionId: selected, reason: 'compatibility', provenance: 'legacy-compatibility',
            text: message.content, hash: await input.hash(message.content) });
        selected = child;
    }
    return { status: 'ready', set: { id: setId, campaignInstance, turnReference: reference('turn', 'messages', [message.id])[0],
        sourceMessageId: source.id, assistantMessageId: message.id, archivedUserText: source.displayContent ?? source.content,
        expectedHead, revisionOrder: revisions.map(revision => revision.id), revisions, attempts: [], selectedRevisionId: selected,
        displayedRevisionId: selected, selectionVersion: reference('selection-version', 'messages', [message.id])[0], state: 'ready' } };
}
