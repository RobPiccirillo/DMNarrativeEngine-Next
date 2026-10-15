import disposition from '../fixtures/known-target-violations.json';
import { canonical, hash } from './artifacts';
import type { AssertionResult, ScenarioId } from './types';

export const knownTargetViolations = disposition;

export function applyKnownTargetViolations(checks: AssertionResult[], scenario: ScenarioId): AssertionResult[] {
    if (hash(canonical({ version: disposition.version, violations: disposition.violations })) !== disposition.reviewedHash) throw new Error('Known target violation disposition changed without review');
    const output = checks.map(c => ({ ...c }));
    for (const entry of disposition.violations.filter(v => v.scenario === scenario)) {
        const matches = output.filter(c => c.id === entry.assertionId);
        if (matches.length !== 1) {
            output.push({ id: entry.assertionId, kind: 'normative', status: 'FAIL', reviewRequired: true, detail: 'Reviewed assertion missing or duplicated' });
            continue;
        }
        const check = matches[0];
        if (check.status === 'FAIL' && canonical(check.failureCondition ?? null) === canonical(entry.reviewedFailureCondition)) {
            check.kind = 'known-target-violation'; check.status = 'KNOWN_TARGET_VIOLATION';
            check.detail = 'Reviewed legacy violation preserved for before/after migration evidence';
            check.rationale = entry.rationale; check.responsiblePhases = entry.responsiblePhases;
        } else {
            check.detail = check.status === 'PASS' ? 'Reviewed violation unexpectedly passed; explicit review required' : 'Reviewed failure condition changed; explicit review required';
            check.status = 'FAIL'; check.reviewRequired = true;
        }
    }
    return output;
}
