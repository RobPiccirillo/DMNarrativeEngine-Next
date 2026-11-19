import type { AcceptanceCandidate } from './draftLifecycle.js';
import { isGenerationPosition } from './draftLifecycle.js';
import type { CompatibilityReference } from './identity.js';
import { parseCompatibilityReference } from './identity.js';
import { isMutationProvenance } from './mutation.js';
import type { MutationCommand, MutationProvenance, SourceReference } from './mutation.js';
import type { CommandKind, ContentVersion, FormatEpoch, WriterId } from './mutationVocabulary.js';
import { parseContentVersion, parseFormatEpoch, parseWriterId } from './mutationVocabulary.js';

export interface LegacyAcceptanceCommand {
    readonly binding: 'legacy-compatibility-v1';
    readonly campaignInstance: string;
    readonly campaign: SourceReference<'campaign'> & { readonly type: 'compatibility' };
    readonly commandId: CompatibilityReference<'command'>;
    readonly domainId: 'narrative-evidence';
    readonly kind: 'story.accept';
    readonly provenance: MutationProvenance & {
        readonly origin: 'current-user-action';
        readonly writerId: WriterId;
        readonly turn: SourceReference<'turn'>;
        readonly message: SourceReference<'message'>;
        readonly source: SourceReference<'revision'>;
    };
    readonly expectedOwner: 'legacy-runtime';
    readonly expectedFormatEpoch: FormatEpoch;
    readonly expectedVersion: { readonly mode: 'exact'; readonly version: ContentVersion };
    readonly idempotency: { readonly mode: 'command-id' };
    readonly sources: readonly SourceReference[];
    readonly evidence: readonly SourceReference<'evidence'>[];
    readonly payload: AcceptanceCandidate;
}

export type AcceptanceCommand = LegacyAcceptanceCommand | {
    readonly binding: 'canonical';
    readonly command: MutationCommand<CommandKind, AcceptanceCandidate>;
};

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function scoped(value: unknown, kind: string, instance: string): boolean {
    if (!parseCompatibilityReference(value, kind)) return false;
    const parts = JSON.parse(decodeURIComponent((value as string).slice('sid:1:r:'.length))) as string[];
    return parts[1] === instance && parts[5] === 'compatibility';
}

function source(value: unknown, kind: string, instance: string): boolean {
    return object(value) && value.type === 'compatibility' && value.kind === kind && scoped(value.id, kind, instance);
}

export function isLegacyAcceptanceCommand(value: unknown): value is LegacyAcceptanceCommand {
    if (!object(value) || value.binding !== 'legacy-compatibility-v1' || !nonempty(value.campaignInstance)) return false;
    const instance = value.campaignInstance;
    if (value.domainId !== 'narrative-evidence' || value.kind !== 'story.accept'
        || !source(value.campaign, 'campaign', instance) || !scoped(value.commandId, 'command', instance)
        || value.expectedOwner !== 'legacy-runtime' || parseFormatEpoch(value.expectedFormatEpoch) === undefined
        || !object(value.expectedVersion) || value.expectedVersion.mode !== 'exact' || !parseContentVersion(value.expectedVersion.version)
        || !object(value.idempotency) || value.idempotency.mode !== 'command-id' || 'key' in value.idempotency) return false;
    if (!isMutationProvenance(value.provenance) || value.provenance.origin !== 'current-user-action'
        || !parseWriterId(value.provenance.writerId) || !source(value.provenance.turn, 'turn', instance)
        || !source(value.provenance.message, 'message', instance) || !source(value.provenance.source, 'revision', instance)) return false;
    const candidate = value.payload;
    if (!object(candidate) || candidate.campaignInstance !== instance || !scoped(candidate.setId, 'draft', instance)
        || !scoped(candidate.revisionId, 'revision', instance) || !scoped(candidate.turnReference, 'turn', instance)
        || !nonempty(candidate.sourceMessageId) || !nonempty(candidate.assistantMessageId) || !nonempty(candidate.archivedUserText)
        || !nonempty(candidate.expectedSelectionVersion) || candidate.expectedHead !== value.expectedVersion.version
        || typeof candidate.hash !== 'string' || !/^story-visible-v1:sha256:[a-f0-9]{64}$/.test(candidate.hash)) return false;
    if (value.provenance.turn?.id !== candidate.turnReference || value.provenance.source?.id !== candidate.revisionId) return false;
    if ('metadataVersion' in candidate && !nonempty(candidate.metadataVersion)) return false;
    if ('generationPosition' in candidate && !isGenerationPosition(candidate.generationPosition)) return false;
    if (!Array.isArray(value.sources) || !Array.isArray(value.evidence)) return false;
    for (const reference of value.sources) {
        if (!object(reference) || typeof reference.kind !== 'string' || !source(reference, reference.kind, instance)) return false;
    }
    for (const reference of value.evidence) if (!source(reference, 'evidence', instance)) return false;
    return true;
}
