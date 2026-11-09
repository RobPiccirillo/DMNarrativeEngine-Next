declare const domainIdBrand: unique symbol;

export type DomainId = string & { readonly [domainIdBrand]: true };

export function parseDomainId(value: unknown): DomainId | undefined {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value)) return undefined;
    return value as DomainId;
}
