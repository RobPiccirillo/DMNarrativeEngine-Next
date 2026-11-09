declare const kindBrand: unique symbol;
declare const ownerBrand: unique symbol;
declare const writerBrand: unique symbol;
declare const epochBrand: unique symbol;
declare const versionBrand: unique symbol;
declare const keyBrand: unique symbol;

export type CommandKind = string & { readonly [kindBrand]: true };
export type AuthorityOwnerId = string & { readonly [ownerBrand]: true };
export type WriterId = string & { readonly [writerBrand]: true };
export type FormatEpoch = number & { readonly [epochBrand]: true };
/** Opaque owner-defined equality token, not a globally ordered counter. */
export type ContentVersion = string & { readonly [versionBrand]: true };
export type IdempotencyKey = string & { readonly [keyBrand]: true };

function identifier(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value);
}
function explicitText(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim()) return false;
    try { encodeURIComponent(value); return true; } catch { return false; }
}
export function parseCommandKind(value: unknown): CommandKind | undefined {
    return identifier(value) ? value as CommandKind : undefined;
}
export function parseAuthorityOwnerId(value: unknown): AuthorityOwnerId | undefined {
    return identifier(value) ? value as AuthorityOwnerId : undefined;
}
export function parseWriterId(value: unknown): WriterId | undefined {
    return identifier(value) ? value as WriterId : undefined;
}
/** Nonnegative safe integers: serializable, monotonically ordered by numeric comparison. */
export function parseFormatEpoch(value: unknown): FormatEpoch | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
        ? value as FormatEpoch : undefined;
}
export function parseContentVersion(value: unknown): ContentVersion | undefined {
    return explicitText(value) ? value as ContentVersion : undefined;
}
export function parseIdempotencyKey(value: unknown): IdempotencyKey | undefined {
    return explicitText(value) ? value as IdempotencyKey : undefined;
}
export type VersionPrecondition =
    | { readonly mode: 'none'; readonly version?: never }
    | { readonly mode: 'exact'; readonly version: ContentVersion }
    | { readonly mode: 'create-if-absent'; readonly version?: never };
/** Both modes require replay protection. No unprotected/non-idempotent escape hatch. */
export type Idempotency =
    | { readonly mode: 'command-id'; readonly key?: never }
    | { readonly mode: 'caller-key'; readonly key: IdempotencyKey };
