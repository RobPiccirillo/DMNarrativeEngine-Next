# Phase 1L — Constrained Local status

Runtime and deterministic evaluation implemented on `phase/1l-constrained-local`. **K5 was resolved on November 12, 2026; Package C collection blockers are classified/remediated; the human gate is PASS WITH DOCUMENTED LIMITATIONS. Independent-review runtime blockers are now remediated, with an affected-scope recheck and K6 acceptance pending.** `current` remains the production default. No baseline was pinned, default switched, later phase started or merge performed.

Approved scope: [implementation plan](../plan/phase-1l-implementation-plan.md). Live prerequisite and quality rubric: [quality review](phase-1l-quality-review.md).

## 1. Starting state

Started from `main`, commit `7446e177325bd9c7268c2292190d49345e4a1914`. The only initial working-tree item was the approved implementation plan. Created `phase/1l-constrained-local`; no merge or reset.

## 2. Checkpoints

Package A settings/policy tests and current eval parity passed before runtime work. Package B introduced runtime enforcement, deterministic fallbacks, historical evidence and normative constrained evaluation. Package C added profile-specific smoke collection, independent commit timings, a populated comparison mode, backend evidence and review artifacts. The first checkpoint stopped at K5; the November 12 resumption addresses Package C only. This is not a Phase 1L quality acceptance declaration. Implementation checkpoint identity is available in the branch log and final report.

## 3. Files

An exact changed-file list is included below. The approved plan is retained. Private model text, transport/configuration, test logs and candidate artifacts stay under ignored `.eval-output/` paths.

## 4. Configuration

`AppSettings.inferenceProfileId` accepts `current` or `constrained-local-v1`; missing values resolve to current, invalid persisted values warn and fall back to current. The two-choice Global Preferences selector displays effective behavior and compatibility limits. Tier, module selections, endpoint references and campaign settings are retained. A profile change is blocked during generation/commit; activation waits for known running work and rejects queued automatic model work without cancelling deterministic jobs or claiming server preemption.

The immutable resolver is a transitional operational overlay. Its one-way future mapping is to the Phase 9 `LocalCapabilityProfile`'s automatic-inference ceiling, tool permission and attempt budget; no Phase 9 capability negotiation or final prompt packer is introduced.

## 5. Suppressed, retained and manual work

Constrained normal generation makes one required Story request and allows one provider attempt. Automatic Director, planner, recommender, semantic/elevation HTTP prerequisites, intro automation, deep stance inference, commit stakes/importance/validation, NPC updates/drives, scans/drift, relationship extraction, chapter model substeps, event extraction, timeskip prose inference and supplied-config server NLP are suppressed. Tools are neither offered nor dispatched; automatic retries/continuations are disabled.

Existing dice/watchdog/travel, lexical recall/lore/rules, NPC suggestions, base stances/memories, pressure/agency, movement/on-stage/repression, archive append/relink/retirement, counters, chapter structural sealing and condensation remain. No dormant enemy scanner or currently missing chapter callback was activated. Optional existing embedding indexing remains outside the foreground prerequisite.

Explicit Retry, swipe and Scene Continue remain individual tool-free generations. Armed deep search is an explicit multi-call manual exception through a host-owned context that extension request properties cannot grant. Existing explicit utilities/media keep their scope. No idle catch-up, outbox or deferred generative backlog was added.

## 6. Fallbacks and freshness

Structured inventory/profile detail is selected deterministically from valid existing fields/categories, with equipped/name-matched items and explicitly matched abilities prioritized within the existing budget. Identity/signature floors remain. Model-disabled stances retain status, boundaries and recorded anchors in a separate cache partition. Missing stakes use calm for that turn; missing importance uses the server heuristic. Timeskip reuses its existing deterministic narration. Skipped scanners do not advance freshness markers or wipe relationship files. Sealing without generated summary leaves existing title/manual-summary/recall behavior; it does not manufacture a summary.

## 7. Historical evidence

Historical player, assistant, persisted system/OOC, tool metadata, LOD, pins and recalled quotations are escaped and labelled as inactive evidence before applicable token fitting. Actual wrapper costs enter history/world accounting and traces. Current action, deterministic rolls, scene note, confirmed direction and Absolute Command retain their dedicated active positions. Profile changes rebuild cached regeneration payloads from typed source provenance without rerunning inference or wrapping the mixed final user message. Reload/pending recovery uses the selected operational commit profile and preserves the frozen fictional window.

## 8. Current compatibility

All five v0 scenarios remain MATCH and BYTE_STABLE. `eval/baselines/v0` is unchanged. The two reviewed visibility violations and their disposition hash `760d87bd17748689666d6e35650e1a61bce1b79e8ebe357d3adb7279d9422dd7` remain unchanged. No visibility/secrecy repair is claimed.

## 9. Constrained normative suite

The existing runner accepts `--suite phase-1l-constrained-v1`. It runs the five prior scenarios plus populated six-turn Pro and Max scenarios with declared utility availability, carried memories, smart bookkeeping, missing stakes, enabled automatic gates, corrections and instruction-shaped history. Normative checks cover one successful required Story invocation/attempt through acceptance/quiescence, no automatic auxiliary/background calls, actual critical wire state, no semantic prerequisite, and history authority. Separate focused tests cover failures, unsolicited tools, cache conversion, queued/running activation, explicit manual deep search, scene-25 structural seal, LOD fallback, timeskip and backend supplied-config suppression.

## 10. Candidate provenance

Candidates live separately under `.eval-output/phase-1l-constrained-v1/`; review hashes are in [candidate hashes](phase-1l-candidate-hashes.json). Suite/profile identity, fixture revision, source/harness and environment provenance are retained. Review state remains candidate/unpinned. The existing schema-0 projection and v0 pin are preserved.

## 11. Live environment and smoke

The earlier K5 failure was resolved by quarantining a malformed **14 GB GGUF file placed in Ollama's manifest directory**, which the user identified as breaking model enumeration. The user performed the quarantine. On November 12, the resumed agent independently verified responsive enumeration/lookup and the exact reference Q4_K_M model. Ollama reports **0.40.16**; `/api/ps` confirms **llamacpp**, context **8192**, allocation **15,856,629,185 bytes**, of which **15,537,044,192 bytes** is in VRAM. The user observed **15 GB**, **98% GPU / 2% CPU**. Layer count is not inferred from percentages. See the quality report for provenance and live results. The original private Phase 0 artifacts remain untouched.

## 12. Comparative measurements

Deterministic Pro ledger changes from Director plus Story to Story alone; populated constrained fixtures also enforce a single call despite utility availability. These are structural observations. Live measurements are now in [the redacted measurement artifact](phase-1l-live-measurements.json). The primary completes seven one-attempt Story turns. The completed populated current run records 40 calls/attempts, including six background calls; the first completed constrained run records six Story calls/attempts and no auxiliary/background calls. Latencies, token counts and endpoint windows are measured, but generated histories/output lengths diverge and late context exhaustion limits interpretation. No controlled speedup or quality pass is asserted. Cumulative `commitMs` retains its meaning; commit-only durations are measured independently.

## 13. Quality artifacts

The redacted rubric and live prose artifacts distinguish deterministic prompt/state evidence from live narrative judgment. The human quality gate is **PASS WITH DOCUMENTED LIMITATIONS**; chapter-boundary live coverage and late context-starved prose remain limited. Private collection-time `not_reviewed` observations are historical and have not been rewritten. Reports retain context truncation, movement/header inconsistencies, the historical uninstrumented constrained acceptance-check failure, and the corrected live quiescence-wait defect, startup loading variance and the final warm HTTP 400 failure. The seven original inputs and bounded six-turn populated fixture are available to the same live runner; current comparison routes its declared auxiliary work to the same local provider.

## 14. Validation

Original checkpoint checks and the Package C checks are recorded separately below. Engine tests/contracts/purity, frontend build, architecture/inference gates, focused runtime/provider-wire/backend tests, i18n and both deterministic suites are included. Existing lint debt is compared against HEAD rather than silently repaired. The requested `scripts/patch-graph-imports.mjs` does not exist in this checkout; its attempted invocation failed with MODULE_NOT_FOUND, as in prior phases.

## 15. Runtime boundaries

No provider default, persistence authority/schema, epistemic model, retrieval architecture or extension framework was replaced. The server append accepts a validated operational profile field solely for deferred NLP suppression and does not persist it as fictional metadata. The source-site inventory includes the explicit manual host-context relocation. Writer ownership/family counts remain unchanged; extension freeze maintenance records only the changed queue spellings, mixed chapter veto and two moved manual-context accesses.

## 16. Deviations and remediation

Routine mock updates were needed for the explicitly classified background-model queue method. An initial fixture used a nonexistent NPC boundary property and an incorrect relationship target; corrected to existing `hardBoundaries` and `MC` before normative acceptance. Carried-memory assertions apply when its subject is on stage. No expectation was weakened to allow extra inference or promote historical instructions. No broad registry refreeze or v0 repin occurred.

## 17. Stop and limitations

K5 is resolved by the documented quarantine fix and verified model access. Package C resumes from the existing branch/checkpoint. The bounded blocker follow-up below fixes the independently reproduced live assertion defect, retains the historical uninstrumented anomaly, and establishes the HTTP 400 as provider-confirmed Phase 9A input overflow. No unexplained live runtime invariant failure reproduced in the two confirmations. Context-bound narrative limits remain documented; K6 affected-scope independent recheck and final baseline authorization remain outstanding. No Phase 9A context redesign was attempted. Arbitrary custom native code, imports and direct fetch outside the host broker remain unverified; tests cover no-mod operation, bundled deterministic Arc binding and policy denial at the controlled broker. Synthetic smoke cannot certify real backend/vector behavior, and the disposable backend test cannot certify live narrative quality. Previously derived state can become stale; opting out does not recreate skipped records. Chapter-title fallback alone is not a long-run quality acceptance claim.

## 18. Scope closure

No Phase 2/Phase 9 implementation, provider substitution, cross-provider benchmark, production default change, baseline pin or merge. The branch is reviewable; Phase 1L remains unaccepted pending the affected-scope independent recheck and final baseline authorization. The collection-blocker follow-up is recorded below.

## Initial checkpoint validation results

| Check | Result |
| --- | --- |
| Root suite | 5599 passed, 1 expected skip; 414 reported files |
| Engine suite and purity | 456 tests passed |
| Engine contract typecheck | PASS |
| TypeScript and frontend build | PASS; existing Vite chunk/dynamic-import warnings |
| Architecture writer/freeze gate | PASS; 160 writers, 24 domains, 8 competition groups; 566 frozen signatures across 143 files |
| Inference gate | PASS; 46 families, 103 frontend sites, 14 server/provider sites |
| Current eval determinism | 5 MATCH and BYTE_STABLE; v0 pin VALID; 2 reviewed visibility violations unchanged |
| Constrained determinism | 7 BYTE_STABLE; normative assertions pass; 20 logical Story invocations / 20 provider attempts; zero policy violations |
| i18n | PASS; untranslated keys use existing English fallback |
| Changed frontend files lint | 74 files checked; 25 existing errors, zero added diagnostics against HEAD |
| Changed backend lint | Existing recommended-rule debt; no new diagnostics after focused cleanup |
| git diff --check | PASS |
| Import graph rebuild | Attempted; script missing (known checkout limitation) |

Private logs: `.eval-output/phase-1l-validation.json`, `phase-1l-current-final.log`, `phase-1l-constrained-final.log`, `phase-1l-build-final.log`, `phase-1l-architecture-final.log`, `phase-1l-inference-final.log`, `phase-1l-lint-final.json`, and the focused `phase-1l-*.log` reports. Timing values are not part of deterministic artifacts.


## Original checkpoint changed files (88)

- `docs/architecture/extension-freeze.json`
- `docs/architecture/inference-inventory.json`
- `docs/architecture/inference-inventory.md`
- `docs/architecture/writer-inventory.json`
- `docs/architecture/writer-inventory.md`
- `docs/eval/phase-1l-candidate-hashes.json`
- `docs/eval/phase-1l-quality-review.md`
- `docs/eval/phase-1l-status.md`
- `docs/plan/phase-1l-implementation-plan.md`
- `scripts/architecture/check-inference.mjs`
- `scripts/run-eval.mjs`
- `server/__tests__/archiveAppend.test.js`
- `server/services/archiveService.js`
- `server/services/nlpPipeline.js`
- `src/architecture/__tests__/providerInventory.test.ts`
- `src/components/hooks/useRetryStoryAI.ts`
- `src/components/hooks/useSceneContinue.ts`
- `src/components/hooks/useSwipeVariants.ts`
- `src/components/settings-modal/GlobalSettingsTab.tsx`
- `src/eval/__tests__/assertions.ts`
- `src/eval/__tests__/constrainedPolicy.test.ts`
- `src/eval/__tests__/fixtures/liveSmoke.ts`
- `src/eval/__tests__/fixtures/scenarios.ts`
- `src/eval/__tests__/inferenceClassification.test.ts`
- `src/eval/__tests__/liveSmoke.smoke.ts`
- `src/eval/__tests__/replay.test.ts`
- `src/eval/__tests__/support/artifacts.ts`
- `src/eval/__tests__/support/baselineLocalPolicy.ts`
- `src/eval/__tests__/support/observe.ts`
- `src/eval/__tests__/support/replayIO.ts`
- `src/eval/__tests__/support/runScenario.ts`
- `src/eval/__tests__/support/types.ts`
- `src/i18n/locales/en.ts`
- `src/services/__tests__/postTurnPipeline.test.ts`
- `src/services/context-gatherer/archiveRecall.ts`
- `src/services/context-gatherer/deepSearchGather.ts`
- `src/services/inference/__tests__/activation.test.ts`
- `src/services/inference/__tests__/cachedEvidence.test.ts`
- `src/services/inference/__tests__/historicalEvidence.test.ts`
- `src/services/inference/__tests__/inferencePolicy.test.ts`
- `src/services/inference/__tests__/manualException.test.ts`
- `src/services/inference/__tests__/settingsUi.test.tsx`
- `src/services/inference/__tests__/timeskip.test.ts`
- `src/services/inference/historicalEvidence.ts`
- `src/services/inference/inferencePolicy.ts`
- `src/services/inference/operationActivity.ts`
- `src/services/infrastructure/backgroundQueue.ts`
- `src/services/llm/apiClient.ts`
- `src/services/mods/__tests__/arcComputeBinding.test.ts`
- `src/services/npc/agency/agencyEngine.ts`
- `src/services/npc/relationshipStance.test.ts`
- `src/services/npc/relationshipStance.ts`
- `src/services/payload/__tests__/lodRenderer.test.ts`
- `src/services/payload/history.ts`
- `src/services/payload/lodRenderer.ts`
- `src/services/payload/payloadBuilder.ts`
- `src/services/payload/volatile.ts`
- `src/services/payload/world.ts`
- `src/services/turn/__tests__/durableCommit.test.ts`
- `src/services/turn/__tests__/hostFacade.test.ts`
- `src/services/turn/__tests__/locationScanMovement.test.js`
- `src/services/turn/__tests__/sceneContinue.test.ts`
- `src/services/turn/__tests__/smartRetry.stamp.test.ts`
- `src/services/turn/contextGatherer.ts`
- `src/services/turn/contextMinifier.ts`
- `src/services/turn/hostFacade.ts`
- `src/services/turn/pendingCommit.ts`
- `src/services/turn/postTurnPipeline.ts`
- `src/services/turn/sceneContinue.ts`
- `src/services/turn/swipeGeneration.ts`
- `src/services/turn/tracks/__tests__/bookkeepingTracks.test.ts`
- `src/services/turn/tracks/__tests__/npcTrack.test.ts`
- `src/services/turn/tracks/__tests__/stageC.test.ts`
- `src/services/turn/tracks/npcTrack.ts`
- `src/services/turn/tracks/postCommit/chapterSealTrack.ts`
- `src/services/turn/tracks/postCommit/eventExtractionTrack.ts`
- `src/services/turn/tracks/postCommit/inventoryScanTrack.ts`
- `src/services/turn/tracks/postCommit/locationScanTrack.ts`
- `src/services/turn/tracks/postCommit/pcDriftTrack.ts`
- `src/services/turn/tracks/postCommit/profileScanTrack.ts`
- `src/services/turn/tracks/postCommit/relationshipMemoryTrack.ts`
- `src/services/turn/tracks/postCommit/traitScanTrack.ts`
- `src/services/turn/turnContext.ts`
- `src/services/turn/turnOrchestrator.ts`
- `src/services/turn/turnStages.ts`
- `src/store/slices/settingsHelpers.ts`
- `src/store/slices/settingsSlice.ts`
- `src/types/llm.ts`


## Package C resumption - November 12, 2026

Resumed only Package C from clean branch/checkpoint `57d142f7f469ab3a582157edae8938f1eb429894`. The malformed 14 GB GGUF manifest-directory file was quarantined by the user; enumeration and exact-model lookup now succeed. Runtime and application defaults were not edited. Changes are limited to live fixtures/config validation, native measurement transport, bounded live quiescence, acceptance diagnostics and reports.

The fixed primary script remains unchanged. The focused six-turn script adds a concrete local move and relationship callback, shared by both profiles. Actual inference is serial across runs. No model/provider replacement, arbitrary performance threshold, context/window increase, production-default switch, v0 repin or new constrained pin.

At the initial resumption, K5 was cleared and Package C remained **not accepted**. The later blocker follow-up below supersedes the initial K2 disposition. The fixed seven-turn constrained primary completed with seven Story calls/attempts and zero auxiliary/background calls. Populated current completed six turns with 40 actual calls/attempts, six background executions; two completed constrained sequences each used six Story calls/attempts and no auxiliary/background inference. The first constrained sequence averaged 18.547 s to draft versus current's 33.239 s, but this is not a controlled speedup claim. Generated histories, output lengths, harness revisions and context exhaustion limit comparison.

The same-final-harness constrained completion included 33.926 s of first-turn model loading despite its declared warm configuration. A subsequent verified-warm confirmation (4.072 ms first-call loading) completed four turns, then turn 5 received HTTP 400 on its single Story attempt. The response body was not retained, so this initial collection could not establish its cause. The original first-attempt acceptance-check anomaly likewise lacked predicate evidence. Successful repeats do not waive either failure. Context-bound partial headers and the movement/header mismatch remain visible in the quality report. Human quality judgments were `not_reviewed` at that collection checkpoint; the completed human disposition and later independent-review remediation are recorded below. No pin authorization is implied.

| Package C check | Result |
| --- | --- |
| Live transport/fixture/measurement regressions | 13 passed, including 700 ms actual background-quiescence regression |
| Disposable backend append + earlier transport boundary run | 22 passed; synthetic live API and disposable backend coverage remain distinct |
| TypeScript and frontend build | PASS; existing Vite warnings |
| Architecture and inference gates | PASS; original inventory/freeze counts unchanged |
| Current determinism | 5 MATCH / BYTE_STABLE; v0 VALID, two reviewed violations unchanged |
| Constrained determinism | 7 BYTE_STABLE; normative PASS, candidate remains unpinned |
| Candidate scenario hashes | All seven match the recorded review candidates |
| Changed eval files lint | PASS, zero errors/warnings across six files |
| Whitespace / report privacy review | PASS; only redacted measurements tracked |

The full root/engine suites above are checkpoint evidence, not rerun counts for this resumption. Package C changes remain uncommitted for review on the existing branch; collected runs retain their original source and working-tree provenance. Package C logs are in `.eval-output/phase-1l-package-c/`: `transport-tests.log`, `boundary-tests.log`, `typecheck.log`, `build.log`, `architecture.log`, `inference.log`, `current-determinism.log`, `constrained-determinism.log`, and `lint.json`. No production runtime module changed in this resumption.

Resumption changed files (nine):

- `docs/eval/phase-1l-status.md`
- `docs/eval/phase-1l-quality-review.md`
- `docs/eval/phase-1l-live-measurements.json`
- `src/eval/__tests__/fixtures/liveSmoke.ts`
- `src/eval/__tests__/liveSmoke.smoke.ts`
- `src/eval/__tests__/liveSmokeTransport.test.ts`
- `src/eval/__tests__/support/ollamaLive.ts`
- `src/eval/__tests__/support/replayIO.ts`
- `src/eval/__tests__/support/runScenario.ts`

Rollback remains selecting `current` in Global Preferences after known work settles; earlier records/settings are retained and suppressed derived work is not retroactively recreated. No application profile setting was changed by this collection.

Private evidence includes `.eval-output/phase-1l-package-c/environment.json`, the named ignored config/log files, preserved failed attempts, `.eval-output/phase-1l-live/`, the completed current result, and preserved constrained attempts under `.eval-output/phase-1l-package-c/`. The latest constrained output directory holds the failed warm confirmation rather than a successful result. The redacted [measurement artifact](phase-1l-live-measurements.json) contains no raw prompts, model prose or credentials. Original Phase 0 private artifacts are retained untouched.

## Package C blocker disposition - November 12, 2026

Starting branch/checkpoint remains `phase/1l-constrained-local` / `57d142f7f469ab3a582157edae8938f1eb429894`. Existing Package C work was preserved; user-provided `1LDiffs.txt` was left untouched. Changes remain uncommitted for review.

1. **Exact HTTP 400 cause:** a single replay of the preserved turn-5 native request elicited provider-reported 8193 input tokens against the 8192-token context. Only the recorded model alias was restored; messages/options/sampling were retained. Raw body and request remain ignored/private. Sanitized cause and artifact digest are in the measurement JSON.
2. **Reproduction:** HTTP 400 reproduced in that one direct diagnostic, not in either new full six-turn confirmation. No alternate model/window or retry loop was used. The diagnostic is separate from normal-turn call accounting and makes no commit.
3. **Acceptance anomaly:** no recurrence across two bounded confirmations (12 accepted turns). The original uninstrumented failure remains historical; its exact predicate cannot be recovered. A fixed-response test proves the last-message proxy can fail after a valid archive commit when deterministic movement validation appends a system message.
4. **Harness fix:** live acceptance now locates the Story by generated draft ID and requires its scene ID to match the new archive append. Nonempty content, retired pending marker, one Story call/attempt, one archive append, no draft-time append and unexpected-request rejection remain enforced. No Packages A/B runtime behavior changed. Error capture clones native failure responses and records private status/body/error/count metadata without consuming the application's response.
5. **Bounded reruns:** exactly two full confirmations, each 6/6 turns and 6 calls/attempts, no auxiliary/background inference, no unexpected requests and clean synthetic quiescence. One additional preserved-request diagnostic returned HTTP 400. One separately recorded load-only operation warmed the unloaded exact model before the first confirmation; it generated no output. No further live inference is required for these blocker classifications.
6. **Context limit:** provider-confirmed Phase 9A input overflow is deferred packing debt, not a Phase 1L operational call-budget violation. Successful late outputs remain severely truncated (including a one-token output); nonempty transport content is not usable-prose or quality acceptance. Context/output/model/sampling remain 8192/512/reference Gemma/0.7. No Phase 9 implementation.
7. **Changed files in this follow-up (six):** `src/eval/__tests__/support/replayIO.ts`, `src/eval/__tests__/support/runScenario.ts`, `src/eval/__tests__/liveSmokeTransport.test.ts`, `docs/eval/phase-1l-status.md`, `docs/eval/phase-1l-quality-review.md`, `docs/eval/phase-1l-live-measurements.json`. The nine-file resumption list above includes earlier uncommitted work; no unrelated file was edited.
8. **Validation after fix:** 16 live transport/acceptance tests PASS; current 5 MATCH/BYTE_STABLE with v0 VALID; constrained 7 BYTE_STABLE/normative PASS, unpinned; TypeScript/build, architecture/inference gates and six-file changed eval lint PASS. Candidate scenario hashes unchanged. Whitespace/privacy checks PASS. Existing Vite warnings, known visibility violations and missing graph-refresh script remain recorded limitations. Logs use `.eval-output/phase-1l-package-c/blocker-*.log` and `blocker-lint.json`; the failing-before-fix regression is retained as `acceptance-reproduction-before-fix.log`.
9. **Readiness at that checkpoint:** Package C evidence was ready for human quality review with context limitations explicit; quality was then `not_reviewed`. The completed human gate and subsequent independent-review remediation are recorded below. This checkpoint did not start independent review, change defaults, pin, merge or begin Phase 2/9 implementation.

See [quality follow-up](phase-1l-quality-review.md#package-c-blocker-follow-up---november-12-2026) and [redacted measurements](phase-1l-live-measurements.json). Private `blocker-confirmation-{1,2}` directories retain complete runs and per-turn acceptance identities; `historical-turn-5-provider-probe.json` retains the provider evidence.

## Narrow final remediation after independent review

The human verdict remains **PASS WITH DOCUMENTED LIMITATIONS**. The two blocking runtime findings are fixed in the existing working tree; final acceptance awaits an affected-scope independent recheck. No broader architecture, ordinary constrained one-Story/one-attempt policy, automatic retry/tool/background policy, provider/model/settings, history adapter or deterministic fallback was changed.

- **Manual Inject Arc:** host-rendered dispatch identifies the registered Arc action and scopes a temporary model-call view around its callback after drain/refresh. A private context-to-facade WeakMap and existing `callManualModel` WeakSet provide authorization. No extension-provided manual flag is trusted. Ordinary/automatic contexts, refreshed contexts and retained calls after settlement/throw remain denied in constrained mode. The public ModContext schema is unchanged.
- **Final visible Story:** Swipe/Retry validate the stripped display text before creating a variant; Continue validates the processed result after header and stakes removal on all terminal branches. Stripped-empty results reject. Retry restores prior retryable content without success stamping; Swipe removes its failed streaming slot and retains the old variant; Continue restores prior prose and reports failure. Backend rejection remains intact. The shared invalid-output fix applies to both profiles; valid current-profile generation behavior remains unchanged.
- **Quality documentation:** responsiveness is recurring sample-level debt in **both preserved constrained confirmations**, not one isolated miss. The available evidence does not prove a systemic constrained-profile regression or suppression-specific causation. Completed human judgments supersede collection-time `not_reviewed` fields in current redacted documentation; historical private artifacts remain untouched.

Validation: 284 affected tests in 25 files plus 54 chrome/mount tests in 3 files **PASS** (338 total); 21 new end-to-end boundary/hook regressions are included. Current determinism: all five MATCH/BYTE_STABLE, v0 VALID and the two known visibility violations unchanged. Constrained determinism: all seven BYTE_STABLE/normative PASS, all candidate hashes unchanged and still unpinned. TypeScript/build and architecture/inference gates PASS. Changed-file lint: eight files checked, zero added diagnostics versus HEAD; eight existing modContext explicit-any errors retained. Freeze metadata adds only four exact scoped-wrapper dependencies (570 signatures, 143 files), and the inference inventory adds two forwarding sites (46 families, 105 frontend sites, 14 server/provider sites). No broad refreeze. The import-graph refresh was attempted and remains unavailable (missing script). No broad live collection was rerun because normal Story/provider behavior is unchanged.

Files changed for this remediation (14; earlier Package C changes remain separately listed above):

- `src/services/mods/modContext.ts`
- `src/services/mods/mounts/chromeRenderers.tsx`
- `src/services/mods/__tests__/arcManualAuthorization.test.tsx` (7 new tests)
- `src/services/turn/swipeGeneration.ts`
- `src/services/turn/sceneContinue.ts`
- `src/components/hooks/useRetryStoryAI.ts`
- `src/components/hooks/__tests__/manualVisibleStory.test.ts` (14 new tests)
- `src/architecture/__tests__/providerInventory.test.ts`
- `docs/architecture/extension-freeze.json`
- `docs/architecture/inference-inventory.json`
- `docs/architecture/inference-inventory.md`
- `docs/eval/phase-1l-status.md`
- `docs/eval/phase-1l-quality-review.md`
- `docs/eval/phase-1l-live-measurements.json` (human-review disposition only)

Private validation logs: `.eval-output/phase-1l-final-remediation/` contains `focused.log`, `mounts.log`, `current-determinism.log`, `constrained-determinism.log`, `architecture.log`, `inference.log`, `typecheck.log`, `build.log`, `lint-comparison.json` and `graph-refresh.log`. Changes remain uncommitted. No constrained baseline pin, merge, affected-scope recheck or next-phase implementation was performed; stop here for the independent recheck.
