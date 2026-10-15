export const AUTHORITY_CLASSES = [
    'tracked-state', 'canonical-evidence', 'derived-interpretation',
    'working-data', 'reference-input', 'operational-metadata', 'presentation-cache',
] as const;
export type AuthorityClass = typeof AUTHORITY_CLASSES[number];

export const TRUST_CLASSES = [
    'trusted-application-story-instruction', 'current-user-action',
    'active-trusted-ooc-meta-direction', 'trusted-characterization-directive',
    'tracked-state', 'reference-lore', 'canonical-narrative-evidence',
    'imported-untrusted-content', 'derived-interpretation',
] as const;
export type TrustClass = typeof TRUST_CLASSES[number];

export const LEGACY_STATUSES = ['transitional-legacy', 'target'] as const;
export type LegacyStatus = typeof LEGACY_STATUSES[number];

export interface RecordClassification {
    readonly authority: AuthorityClass;
    readonly trust: TrustClass;
    readonly legacyStatus: LegacyStatus;
}

export function parseAuthorityClass(value: unknown): AuthorityClass | undefined {
    return AUTHORITY_CLASSES.find(entry => entry === value);
}

export function parseTrustClass(value: unknown): TrustClass | undefined {
    return TRUST_CLASSES.find(entry => entry === value);
}

export function parseLegacyStatus(value: unknown): LegacyStatus | undefined {
    return LEGACY_STATUSES.find(entry => entry === value);
}
