declare const stableIdBrand: unique symbol;
declare const compatibilityBrand: unique symbol;

export const CORE_ID_KINDS = [
    'campaign', 'entity', 'turn', 'draft', 'revision',
    'annotation', 'evidence', 'command', 'change-set',
] as const;
export type CoreIdKind = typeof CORE_ID_KINDS[number];

export type StableId<K extends string> = string & { readonly [stableIdBrand]: K };
export type CompatibilityReference<K extends string> = string & { readonly [compatibilityBrand]: K };

/** Fixed root scope for canonical campaigns; never a canonical campaign ID itself. */
export const ROOT_CAMPAIGN_SCOPE = 'root:campaign';

export type StableIdInput<K extends string> = K extends string ? {
    readonly kind: K;
    readonly campaign: K extends 'campaign' ? typeof ROOT_CAMPAIGN_SCOPE : StableId<'campaign'>;
    readonly namespace: string;
    readonly key: string;
} : never;

export type LegacyReferenceScope =
    | { readonly mode: 'compatibility' }
    | { readonly mode: 'snapshot'; readonly snapshot: string };

export interface CompatibilitySource<K extends string> {
    readonly kind: K;
    readonly campaign: string;
    readonly namespace: string;
    readonly family: string;
    /** Immutable source revision/import scope, not merely a mutable file's schema version. */
    readonly version: string;
    readonly scope: LegacyReferenceScope;
}

function explicitText(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError('Expected nonempty, well-formed explicit text');
    }
    encodeURIComponent(value);
}

function validateKind(kind: unknown): asserts kind is string {
    if (typeof kind !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(kind)) {
        throw new TypeError('Invalid identity kind');
    }
}

function encode(prefix: string, parts: readonly string[]): string {
    return prefix + encodeURIComponent(JSON.stringify(parts));
}

function decode(value: unknown, prefix: string, length: number): string[] | undefined {
    if (typeof value !== 'string' || !value.startsWith(prefix)) return undefined;
    try {
        const parts: unknown = JSON.parse(decodeURIComponent(value.slice(prefix.length)));
        if (!Array.isArray(parts) || parts.length !== length) return undefined;
        for (const part of parts) if (typeof part !== 'string') return undefined;
        return encode(prefix, parts) === value ? parts : undefined;
    } catch {
        return undefined;
    }
}

function canonicalId(kind: string, campaign: string, namespace: string, key: string): string {
    validateKind(kind);
    const parts = [kind, campaign, namespace, key];
    parts.forEach(explicitText);
    if (kind === 'campaign') {
        if (campaign !== ROOT_CAMPAIGN_SCOPE) throw new TypeError('Canonical campaigns require the root scope');
    } else if (!parseStableId(campaign, 'campaign')) {
        throw new TypeError('Canonical child identities require a canonical campaign ID');
    }
    return encode('sid:1:c:', parts);
}

export function createStableId<const K extends string>(
    input: StableIdInput<K> & { readonly kind: K },
): StableId<K> {
    return canonicalId(input.kind, input.campaign, input.namespace, input.key) as StableId<K>;
}

export function parseStableId<const K extends string>(value: unknown, kind: K): StableId<K> | undefined {
    const parts = decode(value, 'sid:1:c:', 4);
    if (!parts || parts[0] !== kind) return undefined;
    try {
        return canonicalId(kind, parts[1], parts[2], parts[3]) as StableId<K>;
    } catch {
        return undefined;
    }
}

/** Read a validated child's canonical campaign scope; campaigns themselves have only the root scope. */
export function getStableIdCampaign(value: StableId<string>): StableId<'campaign'> | undefined {
    const parts = decode(value, 'sid:1:c:', 4);
    if (!parts || parts[0] === 'campaign' || !parseStableId(value, parts[0])) return undefined;
    return parseStableId(parts[1], 'campaign');
}

export function createCompatibilityReferences<const K extends string>(
    source: CompatibilitySource<K>,
    locators: readonly string[],
): readonly CompatibilityReference<K>[] {
    validateKind(source.kind);
    const parts = [source.kind, source.campaign, source.namespace, source.family, source.version];
    parts.forEach(explicitText);
    if (!source.scope || !['compatibility', 'snapshot'].includes(source.scope.mode)) {
        throw new TypeError('Explicit compatibility or snapshot scope required');
    }
    const snapshot = source.scope.mode === 'snapshot' ? source.scope.snapshot : '';
    if (source.scope.mode === 'snapshot') explicitText(snapshot);
    if (!Array.isArray(locators)) throw new TypeError('Complete source locator set required');
    const seen = new Set<string>();
    return Array.from(locators, locator => {
        explicitText(locator);
        if (seen.has(locator)) throw new TypeError('Ambiguous duplicate legacy locator: ' + locator);
        seen.add(locator);
        return encode('sid:1:r:', [...parts, source.scope.mode, snapshot, locator]) as CompatibilityReference<K>;
    });
}

export function parseCompatibilityReference<const K extends string>(
    value: unknown, kind: K,
): CompatibilityReference<K> | undefined {
    const parts = decode(value, 'sid:1:r:', 8);
    if (!parts || parts[0] !== kind) return undefined;
    const [, campaign, namespace, family, version, mode, snapshot, locator] = parts;
    if (mode !== 'snapshot' && (mode !== 'compatibility' || snapshot !== '')) return undefined;
    try {
        return createCompatibilityReferences({
            kind, campaign, namespace, family, version,
            scope: mode === 'snapshot' ? { mode, snapshot } : { mode },
        }, [locator])[0];
    } catch {
        return undefined;
    }
}
