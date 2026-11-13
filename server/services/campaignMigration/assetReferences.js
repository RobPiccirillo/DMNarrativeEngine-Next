import { fail } from './artifact.js';

// In text, only Markdown destinations and quoted HTML image src attributes count.
// Bare prose paths and remote URLs are inert, and Markdown is never executed.
export function assetReferences(value, textOnly = false) {
    const found = new Set();
    function visit(node, text) {
        if (typeof node === 'string') {
            if (!text && /^(?:\/assets\/|file:)/i.test(node)) found.add(node);
            for (const match of node.matchAll(/!?\[[^\]\r\n]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))(?:\s+["'][^\r\n]*["'])?\s*\)/g)) {
                const destination = match[1] ?? match[2];
                if (destination.startsWith('/assets/')) found.add(destination);
            }
            for (const match of node.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
                if (match[1].startsWith('/assets/')) found.add(match[1]);
            }
        } else if (node && typeof node === 'object') Object.values(node).forEach(v => visit(v,false));
    }
    visit(value,textOnly);
    return [...found].sort();
}

export function assetLocation(reference, campaign) {
    const uri=reference.split(/[?#]/,1)[0];
    const portrait=uri.match(/^\/assets\/portraits\/(.+)$/);
    const scene=uri.match(new RegExp(`^/assets/campaigns/${campaign}/scene-images/(.+)$`));
    if (!portrait && !scene) fail('unsupported-local-reference');
    let relative;
    try { relative=decodeURIComponent(portrait ? portrait[1] : `campaigns/${campaign}/scene-images/${scene[1]}`); }
    catch { fail('invalid-local-reference'); }
    if (relative.includes('\\') || relative.includes(':') || relative.split('/').some(p=>!p || p==='.' || p==='..')) fail('unsafe-path');
    return { group:portrait?'portraits':'data', relative, required:!portrait };
}
