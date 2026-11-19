import { ASSET_BASE } from '../../../lib/apiBase';

export function transferredAssetUrl(value: string, aliases: Readonly<Record<string, string>>): string {
    const alias = (key: string): string | undefined => Object.hasOwn(aliases, key) && typeof aliases[key] === 'string' ? aliases[key] : undefined;
    const local = value.replace(/^http:\/\/(?:localhost|127\.0\.0\.1):3001(?=\/assets\/)/i, '');
    let next = alias(value) ?? alias(local);
    if (!next) return value;
    const seen = new Set<string>();
    while (alias(next) && alias(next) !== next) {
        if (seen.has(next)) return value;
        seen.add(next); next = alias(next)!;
    }
    return next.startsWith('/assets/') ? ASSET_BASE + next : value;
}
