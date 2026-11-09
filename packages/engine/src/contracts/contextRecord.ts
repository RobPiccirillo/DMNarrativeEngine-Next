import { parseAuthorityClass, parseTrustClass, parseLegacyStatus } from './classification.js';
import type { RecordClassification } from './classification';
import { isSourceReference } from './mutation.js';
import type { SourceReference } from './mutation';
import { parseContentVersion } from './mutationVocabulary.js';
import type { ContentVersion } from './mutationVocabulary';

/** Read-only context projection, not a repository, command, truth schema or prompt renderer.
 * The source owner supplies a snapshot plus its exact immutable source/head version. Compatibility
 * references remain noncanonical; neither classification nor a citation grants write authority.
 * Readonly is a compile-time view, not a deep-freeze/copy or proof of the source's correctness.
 */
export interface ContextRecord<K extends string, P> {
    readonly reference: SourceReference<K>;
    readonly sourceVersion: ContentVersion;
    readonly classification: Readonly<RecordClassification>;
    readonly content: Readonly<P>;
}

export function isContextRecord<K extends string, P>(
    value: unknown, kind: K, isContent: (content: unknown) => content is P,
): value is ContextRecord<K, P> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (Reflect.ownKeys(record).length !== 4
        || !['reference', 'sourceVersion', 'classification', 'content'].every(key => Object.hasOwn(record, key))
        || !isSourceReference(record.reference, kind) || !parseContentVersion(record.sourceVersion)) return false;
    const c = record.classification;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    const classification = c as Record<string, unknown>;
    return Reflect.ownKeys(classification).length === 3
        && ['authority', 'trust', 'legacyStatus'].every(key => Object.hasOwn(classification, key))
        && parseAuthorityClass(classification.authority) !== undefined
        && parseTrustClass(classification.trust) !== undefined
        && parseLegacyStatus(classification.legacyStatus) !== undefined && isContent(record.content);
}
