import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDomainId } from '../../packages/engine/dist/contracts/domain.js';
import { parseAuthorityClass, parseLegacyStatus } from '../../packages/engine/dist/contracts/classification.js';
import { isProductionSource, scanSource, scanManifest } from './surfaces.mjs';

const phasePattern = /^(?:1L|2[AB]?|3|4(?:A|B1|B2|C)?|5[A-E]?|6|7[AB]?|8[A-C]?|9[AB]?|10|11)$/;
const text = value => typeof value === 'string' && value.trim().length > 0;
const sourcePath = value => text(value) && /^(?:src|server|mods|public\/bundled-mods)\/[a-zA-Z0-9_./-]+\.[jt]sx?$/.test(value) && !value.includes('..');
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function validateInventory(registry) {
    const errors = [];
    const domains = new Set();
    const writers = new Map();
    for (const domain of registry.domains ?? []) {
        if (!parseDomainId(domain.id) || domains.has(domain.id) || !text(domain.description)) errors.push(`Invalid/duplicate domain ${domain.id}`);
        domains.add(domain.id);
    }
    for (const writer of registry.writers ?? []) {
        const label = writer.writerId ?? '<missing writerId>';
        if (!parseDomainId(label) || writers.has(label)) errors.push(`Invalid/duplicate writerId ${label}`);
        writers.set(label, writer);
        if (!sourcePath(writer.source) || !writer.symbols?.length || !writer.symbols.every(text)) errors.push(`${label}: invalid source/symbol references`);
        if (!['producer', 'sink'].includes(writer.role)) errors.push(`${label}: producer/sink role required`);
        if (!writer.domains?.length) errors.push(`${label}: at least one domain required`);
        for (const affected of writer.domains ?? []) {
            if (!parseDomainId(affected.id) || !domains.has(affected.id)) errors.push(`${label}: unknown domain ${affected.id}`);
            if (!parseAuthorityClass(affected.authority) || !affected.fields?.length || !affected.fields.every(text)) errors.push(`${label}: domain authority/fields required`);
        }
        if (!parseLegacyStatus(writer.legacyStatus)) errors.push(`${label}: invalid legacy status`);
        for (const field of ['trigger', 'lifecycleStage', 'mutationOrigin', 'modelInvolvement']) {
            if (!text(writer[field])) errors.push(`${label}: ${field} required`);
        }
        for (const field of ['operations', 'storageTargets']) {
            if (!writer[field]?.length || !writer[field].every(text)) errors.push(`${label}: ${field} required`);
        }
        if (!phasePattern.test(writer.migration?.phase ?? '') && !text(writer.migration?.preservationRationale)) errors.push(`${label}: future migration phase or preservation rationale required`);
        if (typeof writer.targetAuthoritativeOwner !== 'boolean') errors.push(`${label}: explicit ownership claim required`);
        if (writer.targetAuthoritativeOwner && (writer.role !== 'producer' || writer.legacyStatus !== 'target'
            || writer.domains.some(d => !['tracked-state', 'canonical-evidence'].includes(d.authority)))) {
            errors.push(`${label}: derived/legacy/sink writer cannot claim target authoritative ownership`);
        }
        if (writer.legacyStatus === 'transitional-legacy' && writer.role === 'producer' && !text(writer.migrationDebt)) errors.push(`${label}: legacy producer requires explicit migration debt`);
        if (!Array.isArray(writer.competitionGroups) || !Array.isArray(writer.feedsInto)) errors.push(`${label}: explicit competition/sink references required`);
    }
    const groups = new Map((registry.competitionGroups ?? []).map(group => [group.groupId, group]));
    if (groups.size !== (registry.competitionGroups ?? []).length) errors.push('Duplicate competition group');
    for (const group of groups.values()) {
        if (!domains.has(group.domain) || !text(group.rationale) || !phasePattern.test(group.migrationPhase) || group.writers.length < 2) errors.push(`Invalid competition group ${group.groupId}`);
        for (const id of group.writers) {
            const writer = writers.get(id);
            if (!writer || writer.role !== 'producer' || !writer.domains.some(d => d.id === group.domain)
                || !writer.competitionGroups.includes(group.groupId) || !text(writer.migrationDebt)) errors.push(`${group.groupId}: invalid competing writer ${id}`);
        }
    }
    for (const writer of writers.values()) {
        for (const id of writer.competitionGroups ?? []) {
            if (!groups.get(id)?.writers.includes(writer.writerId)) errors.push(`${writer.writerId}: invalid competition reference ${id}`);
        }
        for (const id of writer.feedsInto ?? []) if (writers.get(id)?.role !== 'sink') errors.push(`${writer.writerId}: unknown persistence sink ${id}`);
    }
    for (const domain of domains) {
        const producers = [...writers.values()].filter(w => w.role === 'producer' && w.domains?.some(d => d.id === domain));
        if (producers.filter(w => w.targetAuthoritativeOwner).length > 1) errors.push(`${domain}: multiple target authoritative owners`);
        if (producers.length > 1 && producers.some(w => w.legacyStatus === 'transitional-legacy' && !text(w.migrationDebt))) errors.push(`${domain}: undeclared legacy competition`);
    }
    return errors;
}

export function loadScans(root) {
    const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/))].sort(compare);
    return files.flatMap(file => {
        if (isProductionSource(file)) return [scanSource(file, readFileSync(join(root, file), 'utf8'))];
        if (/^(?:mods|public\/bundled-mods)\/.*\/manifest\.json$/.test(file)) return [scanManifest(file, readFileSync(join(root, file), 'utf8'))];
        return [];
    });
}

export function checkWriterBoundaries(registry, scans) {
    const errors = [];
    const coverage = new Map();
    const actual = new Map(scans.map(scan => [scan.file, scan]));
    for (const entry of [...registry.writers, ...(registry.forwarders ?? []), ...(registry.nonWriters ?? [])]) {
        const scan = actual.get(entry.source);
        if (!scan) { errors.push(`Missing inventory source ${entry.source}`); continue; }
        if (entry.writerId && entry.symbols.some(symbol => !scan.symbols.includes(symbol))) errors.push(`${entry.writerId}: missing source symbol in ${entry.source}`);
        if (!entry.writerId && !text(entry.rationale)) errors.push(`${entry.source}: forwarding/non-writer rationale required`);
        for (const [key, count] of Object.entries(entry.surfaceCounts ?? {})) {
            const full = `${entry.source}#${key}`;
            if (!Number.isInteger(count) || count < 1 || coverage.has(full)) errors.push(`Invalid/duplicate surface coverage ${full}`);
            coverage.set(full, count);
            const surface = scan.writers.find(s => s.key === key);
            if (!surface || surface.count !== count) errors.push(`Stale inventory boundary ${full}; expected ${count}, found ${surface?.count ?? 0}`);
        }
        for (const id of entry.coveredBy ?? []) if (!registry.writers.some(w => w.writerId === id)) errors.push(`${entry.source}: unknown forwarding target ${id}`);
    }
    for (const scan of scans) {
        for (const surface of scan.writers) {
            if (coverage.get(`${scan.file}#${surface.key}`) !== surface.count) errors.push(`${scan.file}:${surface.line} unclassified writer ${surface.key} (${surface.count} sites)`);
        }
    }
    return errors;
}

export function checkExtensionFreeze(allowlist, scans) {
    const errors = [];
    const sites = new Map();
    for (const site of allowlist.sites) {
        if (!text(site.rationale) || !text(site.source) || !site.surfaceCounts) errors.push(`Invalid frozen dependency source ${site.source}`);
        for (const [surface, count] of Object.entries(site.surfaceCounts ?? {})) {
            const key = `${site.source}#${surface}`;
            if (sites.has(key) || !Number.isInteger(count) || count < 1) errors.push(`Invalid frozen dependency declaration ${key}`);
            sites.set(key, count);
        }
    }
    const found = new Map();
    for (const scan of scans) for (const surface of scan.extensions) {
        const key = `${scan.file}#${surface.key}`;
        found.set(key, surface.count);
        if (sites.get(key) !== surface.count) errors.push(`${scan.file}:${surface.line} new frozen extension dependency ${surface.key} (${surface.count} sites)`);
    }
    for (const [key, count] of sites) if (found.get(key) !== count) errors.push(`Stale extension allowlist ${key}; expected ${count}, found ${found.get(key) ?? 0}`);
    return errors;
}

export function inventorySummary(registry) {
    return {
        writers: registry.writers.length,
        producers: registry.writers.filter(w => w.role === 'producer').length,
        sinks: registry.writers.filter(w => w.role === 'sink').length,
        domains: registry.domains.length,
        competitionGroups: registry.competitionGroups.length,
    };
}

export function renderInventory(registry) {
    const rows = [...registry.writers].sort((a, b) => compare(a.writerId, b.writerId));
    return ['# Current writer inventory', '', 'Generated from `writer-inventory.json`; do not edit this projection independently.', '',
        '| Writer | Role | Source symbols | Domains / current authority | Migration |', '| --- | --- | --- | --- | --- |',
        ...rows.map(w => `| ${w.writerId} | ${w.role} | ${w.source}: ${w.symbols.join(', ')} | ${w.domains.map(d => `${d.id}: ${d.authority}`).join('; ')} | ${w.migration.phase ?? w.migration.preservationRationale} |`), '',
    ].join('\n');
}
