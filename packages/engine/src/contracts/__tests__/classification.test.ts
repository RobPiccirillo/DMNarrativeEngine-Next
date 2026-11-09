import { describe, expect, it } from 'vitest';
import {
    AUTHORITY_CLASSES, TRUST_CLASSES, LEGACY_STATUSES,
    parseAuthorityClass, parseTrustClass, parseLegacyStatus,
} from '../classification';
import type { RecordClassification } from '../classification';
import { parseDomainId } from '../domain';

describe('authority and trust vocabulary', () => {
    it.each(AUTHORITY_CLASSES)('round-trips authority %s', value => {
        expect(parseAuthorityClass(JSON.parse(JSON.stringify(value)))).toBe(value);
    });
    it.each(TRUST_CLASSES)('round-trips trust %s', value => {
        expect(parseTrustClass(JSON.parse(JSON.stringify(value)))).toBe(value);
    });
    it.each(LEGACY_STATUSES)('round-trips separate status %s', value => {
        expect(parseLegacyStatus(JSON.parse(JSON.stringify(value)))).toBe(value);
        expect(parseAuthorityClass(value)).toBeUndefined();
        expect(parseTrustClass(value)).toBeUndefined();
    });
    it('allows evidentiary authority without instructional trust, and the converse', () => {
        const evidence: RecordClassification = {
            authority: 'canonical-evidence', trust: 'canonical-narrative-evidence', legacyStatus: 'target',
        };
        const direction: RecordClassification = {
            authority: 'working-data', trust: 'active-trusted-ooc-meta-direction', legacyStatus: 'target',
        };
        expect(evidence.authority).toBe('canonical-evidence');
        expect(direction.trust).toBe('active-trusted-ooc-meta-direction');
        expect(parseTrustClass(evidence.authority)).toBeUndefined();
        expect(parseAuthorityClass(direction.trust)).toBeUndefined();
    });
    it('does not promote persisted legacy extracted facts or derived interpretations', () => {
        const extracted: RecordClassification = {
            authority: 'derived-interpretation', trust: 'derived-interpretation', legacyStatus: 'transitional-legacy',
        };
        expect(parseAuthorityClass(extracted.authority)).toBe('derived-interpretation');
        expect(parseAuthorityClass(extracted.legacyStatus)).toBeUndefined();
    });
    it.each([undefined, null, 0, {}, [], 'invalid', 'Tracked-State', 'tracked-state '])('rejects invalid classification %j', value => {
        expect(parseAuthorityClass(value)).toBeUndefined();
        expect(parseTrustClass(value)).toBeUndefined();
        expect(parseLegacyStatus(value)).toBeUndefined();
    });
});

describe('extensible domain identifiers', () => {
    it.each(['identity', 'future.inventory', 'first-party.future-domain'])('accepts registry candidate %s without registering it', value => {
        expect(parseDomainId(value)).toBe(value);
    });
    it.each(['', ' Domain', 'A', '.a', 'a..b', 'a/', null, 5])('rejects malformed domain %j', value => {
        expect(parseDomainId(value)).toBeUndefined();
    });
});
