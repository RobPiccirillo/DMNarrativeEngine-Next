import type { AppSettings, ChatMessage, DivergenceEntry, DivergenceRegister, GameContext, NPCEntry } from '../../../types';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type SnapshotExpectationKind = 'behavioral' | 'normative';
export const categories = ['prompt', 'retrieval', 'effects-and-writes', 'calls-and-tokens', 'messages', 'state', 'diagnostics'] as const;
export type Category = typeof categories[number];
export const scenarioIds = ['canonical-commit', 'stale-holder-supersession', 'scoped-secret-cast-change', 'manual-correction-retention', 'call-ledger-pro'] as const;
export type ScenarioId = typeof scenarioIds[number];
export type RecordedStoryResponse = { deltas: string[]; reasoning?: string[]; usage?: { prompt_tokens: number; completion_tokens: number }; attemptStatuses?: number[] };
export type EvalScenario = {
    id: ScenarioId;
    version: 1;
    seed: number;
    fixture: () => { context: GameContext; settings: AppSettings; register: DivergenceRegister; npcs: NPCEntry[]; history?: ChatMessage[]; archiveSource?: string; chapterTitle?: string };
    turns: { input: string; response: RecordedStoryResponse; cast?: string[]; correction?: boolean }[];
};
export type CallAttempt = {
    ordinal: number; stream: boolean; status: number | null; error: string | null; request: Json; usage: Json;
};
export type ModelCall = {
    ordinal: number; purpose: string; endpoint: 'story-local'; turn: number; phase: string;
    status: string; attempts: CallAttempt[];
};
export type TurnEvalResult = Record<Category, Json> & { ordinal: number };
export type EvalResult = { schemaVersion: 0; scenario: ScenarioId; scenarioVersion: 1; kind: 'behavioral'; turns: TurnEvalResult[] };
export type AssertionResult = {
    id: string; kind: 'normative' | 'known-target-violation'; status: 'PASS' | 'FAIL' | 'KNOWN_TARGET_VIOLATION';
    detail?: string; failureCondition?: Json; rationale?: string; responsiblePhases?: string[]; reviewRequired?: boolean;
};
export type Difference = { category: Category; path: string; old: Json; new: Json };
export type EvalRunManifest = {
    schemaVersion: 0; suiteVersion: 'phase-0-v0'; testedSourceCommit: string;
    harnessRevision: string; harnessTreeHash: string; sourceWorkingTreeDiffHash: string; lockfileHash: string;
    fixtureHash: string; seed: 12345; environment: { node: string; vitest: string; tokenizer: string; timezone: 'UTC'; locale: 'en_US.UTF-8' };
    scenarios: { id: ScenarioId; version: 1; hash: string }[];
    reviewState: 'candidate' | 'reviewed';
    knownTargetViolations: Json;
};
export type SelectedState = { engine: Json; entries: DivergenceEntry[]; cast: string[]; inventory: string };
