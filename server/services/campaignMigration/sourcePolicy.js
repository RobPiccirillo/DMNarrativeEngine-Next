import { RETIRED_CAMPAIGN_FILE_SUFFIXES } from '../../lib/legacyTables.js';

export const BUILTINS = ['.json','.state.json','.archive.md','.archive.index.json','.archive.chapters.json',
    '.npcs.json','.locations.json','.entities.json','.facts.json','.timeline.json','.divergence.json',
    '.relationship-memory.npc-to-mc.json','.relationship-memory.npc-to-npc.json','.lore.json',
    '.overworld.json','.migrations.json', ...RETIRED_CAMPAIGN_FILE_SUFFIXES];

// Filename/descriptor policy only, never inferred fictional semantics from payloads.
export function sourcePolicy(source, campaign) {
    const suffix = source.path.startsWith(`campaigns/${campaign}.`) ? source.path.slice(`campaigns/${campaign}`.length) : null;
    if (['.json','.state.json'].includes(suffix)) return { criticality:'required', disposition:'required-source' };
    if (suffix === '.archive.index.json') return { criticality:'optional-derived', disposition:'preserve-and-reconcile' };
    if (BUILTINS.includes(suffix) || (source.descriptor && source.descriptor.suffix === suffix)
        || source.path === `authority/${campaign}.authority.json`) return { criticality:'conditional-legacy', disposition:'preserve-and-reconcile' };
    return { criticality:'unknown', disposition:'unclassified-blocked' };
}
