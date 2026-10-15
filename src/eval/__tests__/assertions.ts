import { expect } from 'vitest';
import type { AssertionResult, EvalResult, EvalScenario, Json, ModelCall, TurnEvalResult } from './support/types';
import { applyKnownTargetViolations } from './support/knownTargetViolations';

export function storyWireMessages(turn: TurnEvalResult): { role: string; content: string | null }[] {
    const calls = (turn['calls-and-tokens'] as unknown as { calls: ModelCall[] }).calls.filter(c => c.purpose === 'story-generation');
    expect(calls).toHaveLength(1);
    expect(calls[0].attempts).toHaveLength(1);
    const request = calls[0].attempts[0].request as { messages: { role: string; content: string | null }[] };
    expect(Array.isArray(request.messages)).toBe(true);
    return request.messages;
}

const wireText = (turn: TurnEvalResult) => storyWireMessages(turn).map(m => m.content ?? '').join('\n');
const scopedText = (text: string) => [...text.matchAll(/\[FACTS KNOWN TO ON-STAGE CHARACTERS\]([\s\S]*?)\[END FACTS KNOWN TO ON-STAGE CHARACTERS\]/g)].map(m => m[1]).join('\n');
const occurrences = (text: string, fact: string) => text.split(fact).length - 1;

function exposureCondition(turns: TurnEvalResult[], fact: string): Json {
    const texts = turns.map(wireText);
    return {
        requirement: 'wire-fact-absent', turns: turns.map(t => t.ordinal),
        wireOccurrences: texts.map(t => occurrences(t, fact)),
        unknownFactsOccurrences: texts.map(t => occurrences(t.split('\n').filter(line => line.includes('UNKNOWN FACTS:')).join('\n'), fact)),
        scopedOccurrences: texts.map(t => occurrences(scopedText(t), fact)),
        cast: turns.map(t => (t.state as { castAtDraft: string[] }).castAtDraft),
    };
}

export function assertScenario(result: EvalResult, scenario: EvalScenario, errors: unknown[] = []): AssertionResult[] {
    const checks: AssertionResult[] = [];
    const failures = new Map<string, unknown>();
    const check = (id: string, assertion: () => void, failureCondition?: Json) => {
        try { assertion(); checks.push({ id, kind: 'normative', status: 'PASS' }); }
        catch (e) {
            failures.set(id, e);
            const absenceFailure = e instanceof Error && e.name === 'AssertionError';
            checks.push({ id, kind: 'normative', status: 'FAIL', detail: 'Invariant violated; see worker log for the Vitest assertion diff.', ...(failureCondition && absenceFailure ? { failureCondition } : {}) });
        }
    };
    for (const [i, turn] of result.turns.entries()) {
        const state = turn.state as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const prompt = turn.prompt as { messages: { role: string; content: string }[] };
        const calls = (turn['calls-and-tokens'] as unknown as { calls: { ordinal: number; purpose: string; status: string; attempts: { stream: boolean; ordinal: number }[] }[] }).calls;
        const messages = turn.messages as unknown as { pending: Record<string, unknown>[]; committed: Record<string, unknown>[] };
        check(`state.commit-anchor.${i + 1}`, () => {
            expect(state.archiveAtDraft).toBe(state.archiveBefore);
            expect(state.archiveAfterCommit).toBe(state.archiveBefore + 1);
            expect(messages.pending.at(-1)?.pendingCommit).toBe(true);
            const accepted = messages.committed.at(-1)!;
            expect(accepted.sceneId).toBe(state.appendSceneId);
            expect(accepted.pendingCommit).toBeUndefined();
            expect(accepted.swipeSet).toBeUndefined();
            expect(accepted.swipeActiveIndex).toBeUndefined();
        });
        check(`prompt.current-input.${i + 1}`, () => {
            expect(prompt.messages.at(-1)?.role).toBe('user');
            expect(prompt.messages.at(-1)?.content).toContain(scenario.turns[i].input);
            expect(prompt.messages.at(-1)?.content).toContain('[DICE OUTCOMES:');
        });
        check(`calls.every-attempt-accounted.${i + 1}`, () => {
            expect(calls.filter(c => c.purpose === 'story-generation')).toHaveLength(1);
            expect(calls.flatMap(c => c.attempts).filter(a => a.stream)).toHaveLength(1);
            expect(calls.every(c => ['story-generation', 'director-brief'].includes(c.purpose) && c.status === 'success' && c.attempts.length > 0)).toBe(true);
            for (const c of calls) expect(c.attempts.map(a => a.ordinal)).toEqual(c.attempts.map((_, n) => n + 1));
            expect(turn.diagnostics).toMatchObject({ violations: [], idle: true, pendingSaves: false });
        });
    }
    const first = result.turns[0], last = result.turns.at(-1)!;
    const firstState = first.state as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const lastState = last.state as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const publicText = (turn: typeof first) => (turn.prompt as { messages: { role: string; content: string }[] }).messages.filter(m => m.role === 'system' && m.content.includes('[ESTABLISHED FACTS]')).map(m => m.content).join('\n');
    if (scenario.id === 'canonical-commit') check('state.fixed-seed-engine', () => {
        expect(firstState.engine).toEqual({ surpriseDC: 92, encounterDC: 196, worldEventDC: 496 });
        expect((first['effects-and-writes'] as { callbacks: { name: string }[] }).callbacks.filter(e => e.name === 'updateLastAssistant').length).toBeGreaterThan(2);
    });
    if (scenario.id === 'stale-holder-supersession') check('stale.superseded-retained-and-suppressed', () => {
        expect(lastState.entries.find((e: { id: string }) => e.id === 'holder-old')).toMatchObject({ status: 'superseded', supersededBy: 'holder-new' });
        expect(lastState.entries.find((e: { id: string }) => e.id === 'holder-new')).toMatchObject({ status: 'active' });
        expect(publicText(first)).toContain('Kaelen holds the Moon Key.');
        expect(publicText(first)).not.toContain('Mira holds the Moon Key.');
    });
    if (scenario.id === 'scoped-secret-cast-change') {
      check('visibility.cast-scoped.knower-included', () => {
        expect(scenario.fixture().settings.rulesBudgetPct).toBe(0.10);
        expect(scenario.fixture().settings.contextLimit).toBe(4096);
        expect((first.prompt as { trace: unknown[] }).trace).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'Scoped Knowledge', included: true })]));
        expect(scopedText(wireText(first))).toContain('The brass token opens the cellar.');
      });
      check('visibility.cast-scoped.nonknower-excluded', () => {
        expect(wireText(last)).not.toContain('The brass token opens the cellar.');
      }, exposureCondition([last], 'The brass token opens the cellar.'));
      check('visibility.hidden-absent', () => {
        for (const t of result.turns) expect(wireText(t)).not.toContain('The cellar contains the royal seal.');
      }, exposureCondition(result.turns, 'The cellar contains the royal seal.'));
      check('visibility.fixture-isolated', () => {
        expect(scenario.fixture().context.loreRaw).toBe('');
        for (const text of ['The brass token opens the cellar.', 'The cellar contains the royal seal.']) {
            expect(scenario.turns.map(t => t.response.deltas.join('')).join('\n')).not.toContain(text);
            const historical = (first.messages as { pending: { content: string }[] }).pending.slice(0, 2);
            expect(historical.map(m => m.content).join('\n')).not.toContain(text);
        }
      });
      check('visibility.public-cache', () => {
        for (const t of result.turns) {
            expect(wireText(t)).toContain('The east bridge is closed.');
            const publicWire = storyWireMessages(t).filter(m => m.role === 'system' && m.content?.includes('[ESTABLISHED FACTS]')).map(m => m.content).join('\n');
            expect(publicWire).not.toContain('The brass token opens the cellar.');
        }
      });
    }
    if (scenario.id === 'manual-correction-retention') check('correction.manual-persisted-roundtrip', () => {
        const corrected = { id: 'bridge-status', text: 'The north bridge is closed.', source: 'manual' };
        expect(lastState.registerBefore).toEqual(expect.arrayContaining([expect.objectContaining(corrected)]));
        expect(lastState.entries).toEqual(expect.arrayContaining([expect.objectContaining(corrected)]));
        const writes = (last['effects-and-writes'] as { writes: { route: string; value: unknown }[] }).writes;
        expect(writes).toEqual(expect.arrayContaining([expect.objectContaining({ route: 'divergence', value: { entries: expect.arrayContaining([expect.objectContaining(corrected)]) } })]));
        expect(publicText(last)).toContain('The north bridge is closed.');
        expect(publicText(last)).not.toContain('The north bridge is open.');
    });
    const classified = applyKnownTargetViolations(checks, scenario.id);
    for (const c of classified.filter(c => c.status === 'FAIL')) errors.push(failures.get(c.id) ?? new Error(`${c.id}: ${c.detail}`));
    return classified;
}
