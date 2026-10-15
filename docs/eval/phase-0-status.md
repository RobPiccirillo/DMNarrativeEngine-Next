# Phase 0 implementation handoff

## Current Phase 0 acceptance status

This section supersedes the historical candidate/pinning/live-run status below. The deterministic baseline was reviewed and pinned in `ed5c639`; it remains valid and unchanged. The offline eval reports **MATCH for all five scenarios**, 30 ordinary PASS checks and the same two reviewed KNOWN_TARGET_VIOLATION results. The actual native-Ollama seven-turn smoke has completed successfully. Phase 1 has not started.

The earlier OpenAI-compatible attempt mechanically completed seven turns, but exhausted the 512-token allowance in reasoning and committed empty visible responses. That transport/mode issue prompted native Ollama `think: false` support and stricter visible-output acceptance. It did not invalidate the deterministic baseline and is superseded by the successful native run.

The remediation adds only eval infrastructure: native Ollama config validation, native request options and explicit top-level `think: false`, incremental NDJSON observation, separate thinking diagnostics and native usage capture. It preserves OpenAI-compatible mode and all seven fixed inputs. A live turn now requires one successful Story invocation/HTTP attempt, nonempty visible content before commit, and a successful normal commit with no unexpected calls or ignored errors. Empty output fails before archive append.

The transport remediation changed only eval infrastructure and documentation: `fixtures/liveSmoke.ts`, `liveSmoke.smoke.ts`, `support/replayIO.ts`, `support/runScenario.ts`, new `support/ollamaLive.ts`, new `liveSmokeTransport.test.ts` (all under `src/eval/__tests__/`), and the two eval documents. No production runtime/provider, frozen architecture, or pinned baseline file changed. This acceptance-status update changes only `docs/eval/phase-0-status.md`.

Validation: focused transport plus existing harness/launcher suites passed **62 tests in three files**; changed-file ESLint passed; deterministic eval/baseline comparison passed with all five MATCH results; production build passed with existing Vite chunk/import warnings. The graph-refresh script remains absent and was not recreated.

### Successful actual local-model smoke

| Environment / fixture | Recorded value |
| --- | --- |
| Model | `hf.co/mradermacher/gemma-4-26B-A4B-it-heretic-GGUF:Q4_K_M` |
| Quantization | `Q4_K_M` |
| Inference server | Ollama `0.40.4` |
| Transport / thinking | Native Ollama `/api/chat`; thinking disabled with top-level `think: false` |
| Context / output / temperature | 8192 tokens / 512 tokens / 0.7 |
| CPU / RAM | AMD Ryzen 7 9800X3D / 32 GiB |
| GPU / VRAM | AMD Radeon RX 9070 XT / 16 GiB |
| Model-layer offload | 31/31 layers to GPU (`mode: "gpu"`, `layers: 31`) |
| Model state | Warm |
| Tier / planner / relationship memory | Lite / disabled / disabled |
| Campaign API | Synthetic |

All **seven fixed scripted turns** each issued one Story-generation call, returned HTTP/provider success, produced nonempty visible Story content, streamed successfully, and committed through the existing smoke turn path. There were no unexpected model calls or recorded harness failures. The full-GPU label corrects the first attempt's inaccurate `partial-gpu` label; the supplied server log reported 31/31 layers offloaded.

### Performance characterization baseline

These observations characterize the current implementation on this model/hardware; they are **not performance requirements or acceptance thresholds**. Across seven turns, average committed turn latency was approximately 19 seconds, average visible Story TTFT approximately 3.4 seconds, average prompt size approximately 6.5K tokens, and average visible completion approximately 360 tokens. Prompt size grew from approximately 5.5K tokens on turn 1 to approximately 7.8K on turn 7. Values are intentionally approximate; exact per-turn measurements remain in the local smoke artifact. Reasoning-first-token timing and visible Story TTFT remain distinct metrics.

Live configurations, results, prose, reasoning diagnostics and performance artifacts remain local, ignored and uncommitted. The earlier OpenAI-compatible evidence remains briefly relevant as the reason native non-thinking support was added.

### Material constrained-context finding: deferred to Phase 9A

On turn 7, the provider reported approximately **7791 prompt tokens + 401 completion tokens = 8192 total tokens**, with `done_reason: "length"`. The visible Story response was truncated mid-sentence. This is **not a Phase 0 harness failure and does not block Phase 0 acceptance**. It is empirical evidence that the legacy prompt architecture can exhaust an 8K local context after only seven turns, even in this small synthetic scenario.

Phase 9A owns proper remediation and should evaluate output-first context budgeting, a protected output reserve, prompt compaction, bounded recent-history handling, authority-aware truncation, explicit behavior when protected context cannot fit, and empirical local context profiles.

The planned profile design space should extend beyond 4K/8K/16K. Where model/hardware support permits, Phase 9A should benchmark **4K, 8K, 16K, 32K, 64K, 128K and 256K**. The smallest profile is not inherently desirable merely because it is cheaper: the target product may intentionally accept somewhat greater latency for materially better long-form continuity and narrative quality. Larger windows must not replace proper retrieval, state authority, epistemic filtering, supersession or context prioritization. Profile selection should be empirical and model/hardware dependent. This records deferred design guidance; it does not change the frozen architecture or roadmap documents.

The other deferred findings remain: legacy narrator `UNKNOWN FACTS` exposure belongs to **Phase 6 / Phase 9A**; **Phase 8C** must ensure retrieval does not reintroduce hidden claims; constrained-context and output-first packing belong to **Phase 9A**.

### Narrative-quality scope

Prose-quality quirks are not Phase 0 blockers. Phase 0 does not certify prose quality, perfect output-format compliance, agency quality, secret-handling quality, repetition resistance or long-campaign coherence. Qualitative fields may remain explicitly `not_reviewed`; later phase-specific and long-run evaluation will assess these qualities. The existing deterministic knowledge-boundary assertions and reviewed legacy violations remain in force.

Coverage remains frontend orchestration and actual local Story inference against a synthetic campaign API. Backend disk persistence, vector infrastructure, server NLP and utility-model calls outside the fixture remain excluded.

### Remaining Phase 0 work

The successful live-smoke execution requirement is satisfied. Remaining work is only:

1. Final independent Phase 0 implementation/acceptance review.
2. Disposition of any review blockers.
3. Merge `phase/0-eval-harness` into `main`.
4. Run the pinned deterministic eval from merged `main`.
5. Mark/tag Phase 0 complete.

These steps are pending, not actions performed by this documentation update. **Phase 1 has not started.**

## Historical implementation handoff (before baseline pinning and real smoke)

The following sections preserve the earlier remediation evidence. Their references to unpinned candidates, unavailable endpoints and pending first inference describe that earlier snapshot, not the current status above.

## 1. Summary

The test-only harness and narrow remediation are implemented on `phase/0-eval-harness`. The inherited percentage error is corrected only in the scoped eval fixture at 4096 tokens. Knower inclusion now passes against the actual Story wire request. Nonknower and fully hidden narrator exposure are separately reported as **KNOWN TARGET VIOLATIONS** under the user's reviewed disposition.

These are **reviewed legacy violations preserved to establish before/after migration evidence**, not accepted architecture. No production fix is required before candidate review/pinning. Phase 0 remains incomplete until remediation validation passes, candidates are reviewed/pinned, the actual seven-turn local smoke is run, and the final Phase 0 review is complete. This remediation stops with regenerated unpinned candidates for human review.

Starting source commit: `8e040d0bd14403b02942643c2dc6b46bffb8be2b`. No commits or merges were created. Phase 1 was not started.

## 2. Files changed

All paths are repository-relative. No listed file changes production turn, prompt, provider, queue, store or persistence behavior.

The narrow remediation changes only:

| File | Remediation / scope |
| --- | --- |
| `src/eval/__tests__/fixtures/scenarios.ts` | Scoped fixture fraction `10` → `0.10`; context remains 4096. Test only. |
| `src/eval/__tests__/assertions.ts` | Actual Story wire visibility, split scoped checks, source-path evidence and fixture isolation. Test only. |
| `src/eval/__tests__/fixtures/known-target-violations.json` | New explicit version-1 reviewed list of exactly two conditions, rationales and phases. Test only. |
| `src/eval/__tests__/support/knownTargetViolations.ts` | New exact-condition classification; missing/changed/passing reviewed checks fail closed. Test only. |
| `src/eval/__tests__/support/types.ts` | Known-violation assertion status and disposition provenance types. Test only. |
| `src/eval/__tests__/replay.test.ts` | In-worker repeats compare disposition-aware assertion results and surface repeated-run failures. Test only. |
| `src/eval/__tests__/harness.test.ts` | Eight focused disposition/wire-seam tests. Test only. |
| `src/eval/__tests__/launcher.test.js` | Three additional status/provenance/exit-policy tests. Test only. |
| `scripts/run-eval.mjs` | Versioned disposition provenance, visible statuses/rationales/phases, invalid-provenance failure reports. Tooling only. |
| `docs/eval/phase-0.md` | Corrected operator guidance, reviewed violations and deferred 4K limitation. Documentation only. |
| `docs/eval/phase-0-status.md` | Updated completion/evidence/disposition handoff. Documentation only. |
| `completePhase0Diff.txt` | Confirmed generated diff artifact was already absent on disk; removed its accidental staged addition. Housekeeping only; no ignore rule added. |

The original Phase 0 file inventory is retained below for context:

| File | Change | Purpose / runtime impact |
| --- | --- | --- |
| `src/eval/__tests__/support/types.ts` | Created | Versioned scenario/result/manifest/assertion types; test only. |
| `src/eval/__tests__/support/artifacts.ts` | Created | Explicit projections, generated-ID aliases, privacy validation, canonical serialization, structural category diffs; test only. |
| `src/eval/__tests__/support/replayIO.ts` | Created | Strict fetch boundary, split-byte SSE, nonstreaming replies and stateful synthetic API; test only. |
| `src/eval/__tests__/support/observe.ts` | Created | Pass-through logical calls, attempts, queue slots, parsed first deltas, usage, core tracks and background jobs; test only. |
| `src/eval/__tests__/support/runScenario.ts` | Created | Real turn/commit runner, current-store reads, manual correction round-trip, bounded quiescence and cleanup; test only. |
| `src/eval/__tests__/fixtures/scenarios.ts` | Created | Exact five replay scenarios / eight turns; synthetic factories only. |
| `src/eval/__tests__/fixtures/liveSmoke.ts` | Created | Seven fixed courtyard inputs, synthetic live fixture and strict environment validation; test only. |
| `src/eval/__tests__/assertions.ts` | Created | Separate ordinary Vitest assertions with stable IDs for all six required categories; test only. |
| `src/eval/__tests__/replay.test.ts` | Created | Explicit command entry, behavioral candidates, assertion results, comparison and repeated-run proof; skipped by ordinary tests without scenario selection. |
| `src/eval/__tests__/harness.test.ts` | Created | Forty-eight harness tests, including real parser paths, known violations and controlled-provider smoke; test only. |
| `src/eval/__tests__/launcher.test.js` | Created | Six command-policy/provenance tests; test only. |
| `src/eval/__tests__/liveSmoke.smoke.ts` | Created | Opt-in actual inference, environment identity, objective metrics, partial/failure reporting and explicit `not_reviewed` qualitative observations; excluded from ordinary tests. |
| `vitest.eval.config.ts` | Created | Reuses existing Vitest setup while selecting replay only and sequential workers; developer tooling. |
| `vitest.eval-live.config.ts` | Created | Selects smoke only with real timers and bounded execution; developer tooling. |
| `scripts/run-eval.mjs` | Created | Fresh workers, compare/record/determinism/live modes, reports, hashes, provenance and exit policy; developer tooling. |
| `package.json` | Modified | Adds `eval`, `eval:record`, `eval:determinism`, `eval:live`; existing scripts/dependencies retained. |
| `.gitignore` | Modified | Ignores eval output, local smoke config and local pre-change test report. |
| `docs/eval/phase-0.md` | Created | Operator workflow, schema, scope, timing definitions, pinning procedure and limitations; documentation. |
| `docs/eval/phase-0-status.md` | Created | This acceptance and handoff report; documentation. |

The existing base-app test/runner/fixture/baseline, all existing golden contents, frozen architecture documents and lockfile are preserved. Vitest rewrites a snapshot's line endings on this Windows checkout; its original checkout CRLF formatting is restored after verification, with no golden content update.

## 3. Validation results

Environment: Node `v24.13.0`, Vitest `4.1.11`, `js-tiktoken` `1.0.21`; eval workers use UTC and `en_US.UTF-8`.

| Validation | Result |
| --- | --- |
| Locked dependency installation | `npm.cmd ci` succeeded after sandbox/cache-access retry; lockfile unchanged. |
| Pre-change full suite | 390 test files; 5,296 tests passed; no failures. |
| Pre-change base-app gate | 3 tests passed. |
| Pre-change targeted golden/queue/visibility/lifecycle/persistence suites | 10 files; 321 tests passed. |
| Requested harness/knowledge/boundary/budget suites | 5 files; 155 tests passed, including all 54 harness/launcher tests. |
| Offline eval / candidate recording | All five scenarios finish; 30 ordinary normative checks PASS, 2 reviewed KNOWN_TARGET_VIOLATION results, no fatal failures. Candidate recording exits 0 / REVIEW_REQUIRED while unpinned. |
| Independent determinism plus in-worker repeats | All five result files byte-identical in both independent worker sets; in-worker assertion comparisons also pass. Command exits 0 with the reviewed violations visible. |
| Focused diff proof | Prompt, retrieval, call, state and write mutations produce the corresponding category/path; behavioral-only review exit is successful with a valid baseline; normative/incomplete runs fail. |
| Existing base-app gate after changes | 3 tests passed; baseline unchanged. |
| Requested existing golden/regression suites after remediation | 8 files; 216 tests passed; golden contents unchanged. |
| Full ordinary suite after remediation | 393 test files; 5,350 tests passed; one explicit replay-command entry skipped; zero failures. |
| Production build | `npm run build` passed; existing Vite chunk-size/dynamic-import warnings remain. |
| Lint of new harness/config/launcher files | Passed. |
| Privacy/artifact validation | All five behavioral results pass strict runtime validation; all 16 current candidate/result/report JSON files pass the forbidden-field/text scan. |
| Extra strict test-entry typecheck | No new harness errors; three existing reused-helper errors remain, listed below. App compilation passes. |
| Graph refresh | Script absent; not run or recreated. |
| Actual live inference | Not run; no model endpoint/environment identity supplied. |

Coverage and Playwright were not run. Neither is needed to establish synthetic frontend replay; no backend/e2e claim is made.

## 4. Baseline artifacts

Five deterministic candidates and their separate assertion/comparison reports exist under ignored `.eval-output/current/`. Independent result copies and candidate manifests are under `.eval-output/determinism-a/` and `.eval-output/determinism-b/`. `.eval-output/report.json` and `.eval-output/report.md` show the current status.

Manifests include the starting/tested source commit, uncommitted harness content hash, source working-tree diff hash, suite/schema versions, scenario versions, fixture hash, lockfile hash, seed, tool versions, result hashes, and complete versioned known-violation disposition. Because the initial harness is staged but uncommitted, the source diff hash includes its staged test infrastructure; production preservation is verified independently by Git paths/diffs.

Review state is **candidate**, not reviewed/pinned. No `eval/baselines/v0/*.json` or reviewed manifest was created automatically. The version-1 known-violation disposition has been reviewed by the task instructions; this does not mean the regenerated behavioral candidates have been reviewed. Pinning against a preceding implementation commit remains a separate authorized step; no future/self-referential commit identity was invented.

## 5. Live smoke

**Mechanism complete; execution pending because the required local endpoint/environment identity was unavailable.**

The unit-tested mechanism records real queue waits, parsed narrative/reasoning first-delta times, generation/logical-call latency, draft/commit latency, usage or `null`, token estimates, attempts, statuses/errors and unexpected requests. It stops after seven fixed inputs and enforces per-call/total ceilings. Reports identify CPU/RAM/GPU/offload, model/quantization/server/version, context/output/sampling, role mappings, cold/warm status and source/harness/script identity before sampling.

The controlled provider used in unit tests is not represented as a real inference result. Qualitative fields may explicitly be `not_reviewed`. Live output is ignored and excludes a claim of backend disk/vector/server-NLP coverage.

## 6. Roadmap acceptance matrix

| Every Phase 0 acceptance criterion in roadmap 003 | Status | Evidence / limit |
| --- | --- | --- |
| One command runs offline without network/live model | PASS | Offline recording/determinism need no backend/model/network. `eval` comparison still requires a valid pinned baseline. |
| Same-source byte-stable deterministic results without timestamps/machine variance | PASS | All five independent-run byte checks and repeated-worker comparisons pass; strict projections/serializer/privacy tests. |
| Deliberate prompt/retrieval-ID/call/state-effect changes produce focused diffs | PASS | Artificial mutation tests plus launcher exit-policy tests. |
| Baseline includes state/stale/knowledge/correction/prompt/call assertions | PARTIAL | All categories implemented; 30 ordinary PASS checks and 2 exact matched reviewed violations; candidate pinning awaits human review/authorization. |
| Behavioral snapshots, normative assertions and known violations visibly distinct | PASS | Separate artifacts/kinds/statuses; unlisted/changed/missing/unexpectedly passing violations fail closed. Behavioral acceptance cannot suppress them. |
| Fixed 5–10-turn live smoke records required objective metrics and observations | PARTIAL | Seven-turn mechanism/config/timing tested with controlled provider; actual named model/hardware run pending. `not_reviewed` is accepted per the task's approved override. |
| Current results checked in or otherwise version-pinned before Phase 1 | BLOCKED | Corrected candidates/provenance/hashes emitted locally. Awaiting candidate review and authorized implementation commit/baseline pinning; no production visibility fix required first. Phase 1 not started. |

## 7. Deviations and clarifications

- File placement stayed under the approved `src/eval/__tests__/` layout. No app TypeScript configuration change was needed.
- Added a tiny `launcher.test.js` to test the actual Node command exit policy without adding a TypeScript runtime loader/dependency.
- The normal suite skips the explicit replay entry unless a scenario is selected. Offline eval executes every assertion normally and separately classifies only the two exact reviewed conditions. Knower inclusion is ordinary PASS and has no disposition entry.
- Baseline files/pinned manifest are intentionally withheld for human candidate review and explicit pinning authorization. Reviewed legacy violations no longer block recording or require premature production fixes.
- The live entry currently accepts local OpenAI-compatible inference endpoints, matching the recorded fetch/provider seam; native Ollama/other formats are not claimed as validated smoke modes.
- The fixed live courtyard orientation overrides the base factory's initial tavern history and chapter label with synthetic courtyard versions. Replay scenarios retain the original factory defaults.
- Human qualitative defaults use the explicitly authorized `not_reviewed` override of the plan.
- No new production `StoryTransport`, `EngineEffect` hierarchy or `MetricSample` framework was introduced. The roadmap's seam/effect/measurement roles are supplied by the fetch adapter, existing recorder and direct typed measurements, as specified by the approved implementation detail.

## 8. Pre-existing failures and unrelated findings

No pre-change runtime tests failed. The independent root-cause analysis has now been implemented and verified:

- The old combined `visibility.cast-scoped` hid two independent results. Its knower omission was caused by the eval fraction error (`10` instead of `0.10`) and is corrected without changing the 4096 window or shared base fixture.
- `visibility.cast-scoped.nonknower-excluded` remains a reviewed legacy narrator exposure through `UNKNOWN FACTS`, owned by Phases 6 / 9A.
- `visibility.hidden-absent` remains a reviewed legacy narrator exposure through `UNKNOWN FACTS`, owned by Phases 6 / 9A.
- Phase 8C must keep retrieval from reintroducing hidden claims; it is not the primary owner of these two existing failures.
- The separate large DEFAULT_RULES/stable preamble limitation remains deferred to Phase 9A. Approximate `cl100k_base` estimates: 4,666 default-rule tokens, 4,697 stable-preamble tokens, and requests over 5.3K input against a nominal 4096 context before output reserve. It is not the cause of the corrected scoped-block omission and is not a new fatal Phase 0 check. Phase 9A owns output-first profiles, compaction/protected-content priority and explicit degradation/failure.

Production behavior is preserved. The two absence assertions still execute and fail their target requirements, but their exact reviewed conditions are visibly classified as KNOWN_TARGET_VIOLATION, never PASS. The earlier extra strict test-only typecheck reaches existing helper defects: stale type-only import `../../llm/llmService` in the old recorder, incomplete `GameContext` cast in its fixture, and an unused `@ts-expect-error` in its deterministic fetch seam. They were not changed. The application build excludes those helpers and passes.

`scripts/patch-graph-imports.mjs` is absent and ignored. Graph tooling was not rebuilt.

## 9. Remaining blockers

1. Human review of regenerated behavioral candidates and disposition-aware reports.
2. Commit the harness/remediation only when authorized, then pin the reviewed baseline against that committed implementation revision, carrying the exact disposition version/list/hash.
3. Supply the actual local model endpoint and complete environment identity, then execute the fixed seven-turn smoke. No actual live inference was run or claimed in this remediation.
4. Complete final Phase 0 review before beginning Phase 1.

The visibility disposition is resolved for Phase 0 baseline capture; it does not approve the legacy behavior as target architecture. Phase 0 acceptance still awaits the review/pinning/live-run work above. No unexpected architecture conflict was found, and no production runtime change was required.

## 10. Recommended commit structure

No commits were created. Suggested split based on this diff:

1. `test(eval): add real-turn replay and bounded smoke harness` — support modules, both fixture files, assertions, replay/smoke entries and harness tests. Keeping the shared live fixture with its tests makes this commit independently testable.
2. `chore(eval): add isolated commands, reports and determinism verification` — launcher, command-policy tests, both opt-in configs, package scripts and ignore rules.
3. `docs(eval): document Phase 0 evidence and acceptance blockers` — operator guide and this handoff.
4. Later, after human candidate review and authorization: `test(eval): pin reviewed Phase 0 baseline` — five reviewed results and manifest referencing the preceding tested implementation commit, retaining the reviewed known-violation disposition.

## Remediation candidate evidence

These are regenerated candidates awaiting human review, not pinned behavioral baselines.

| Scenario | SHA-256 |
| --- | --- |
| canonical-commit | 09a9787de840fc3c92f3b8369437fb7b1d93a1a96663d9fa38911f81b7bfdc29 |
| stale-holder-supersession | a9eb9a1a3bccf4f85199d21428e59192ecac4591cb36919fe83fbcf002481293 |
| scoped-secret-cast-change | 31382e655776dabd0d1d5d3d3dd25d811dcd2f734669105300bd846534da4984 |
| manual-correction-retention | 6c802c216a2cb7471def894961310386b7692e0c3172173ede0d7cb27cd62d75 |
| call-ledger-pro | f29c5bd24d446561d0b9fd4d62db78a810794adfa81fa47950df72c1c070297e |

Disposition version: 1. Reviewed disposition SHA-256: 760d87bd17748689666d6e35650e1a61bce1b79e8ebe357d3adb7279d9422dd7.
Fixture SHA-256: 83b5c0b4c8f81f14f35ce94fd36a73746d88c7f1f9513a7fecf26a014d19d03e.
Harness working-tree SHA-256: f5e12515bf8403fdf3e73844e28dc44e766b74edd28d31817c17cb367fa8de12.

All evaluated assertion states:

| Scenario | Assertion ID | State |
| --- | --- | --- |
| canonical-commit | state.commit-anchor.1 | PASS |
| canonical-commit | prompt.current-input.1 | PASS |
| canonical-commit | calls.every-attempt-accounted.1 | PASS |
| canonical-commit | state.fixed-seed-engine | PASS |
| stale-holder-supersession | state.commit-anchor.1 | PASS |
| stale-holder-supersession | prompt.current-input.1 | PASS |
| stale-holder-supersession | calls.every-attempt-accounted.1 | PASS |
| stale-holder-supersession | stale.superseded-retained-and-suppressed | PASS |
| scoped-secret-cast-change | state.commit-anchor.1 | PASS |
| scoped-secret-cast-change | prompt.current-input.1 | PASS |
| scoped-secret-cast-change | calls.every-attempt-accounted.1 | PASS |
| scoped-secret-cast-change | state.commit-anchor.2 | PASS |
| scoped-secret-cast-change | prompt.current-input.2 | PASS |
| scoped-secret-cast-change | calls.every-attempt-accounted.2 | PASS |
| scoped-secret-cast-change | visibility.cast-scoped.knower-included | PASS |
| scoped-secret-cast-change | visibility.cast-scoped.nonknower-excluded | KNOWN_TARGET_VIOLATION |
| scoped-secret-cast-change | visibility.hidden-absent | KNOWN_TARGET_VIOLATION |
| scoped-secret-cast-change | visibility.fixture-isolated | PASS |
| scoped-secret-cast-change | visibility.public-cache | PASS |
| manual-correction-retention | state.commit-anchor.1 | PASS |
| manual-correction-retention | prompt.current-input.1 | PASS |
| manual-correction-retention | calls.every-attempt-accounted.1 | PASS |
| manual-correction-retention | state.commit-anchor.2 | PASS |
| manual-correction-retention | prompt.current-input.2 | PASS |
| manual-correction-retention | calls.every-attempt-accounted.2 | PASS |
| manual-correction-retention | correction.manual-persisted-roundtrip | PASS |
| call-ledger-pro | state.commit-anchor.1 | PASS |
| call-ledger-pro | prompt.current-input.1 | PASS |
| call-ledger-pro | calls.every-attempt-accounted.1 | PASS |
| call-ledger-pro | state.commit-anchor.2 | PASS |
| call-ledger-pro | prompt.current-input.2 | PASS |
| call-ledger-pro | calls.every-attempt-accounted.2 | PASS |
