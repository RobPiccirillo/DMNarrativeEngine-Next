# Phase 1L — Constrained Local status

Runtime and deterministic evaluation implemented on `phase/1l-constrained-local`. **Live smoke is blocked by approved-plan Section K5; final quality/baseline review remains pending.** `current` remains the production default. No baseline was pinned, default switched, later phase started or merge performed.

Approved scope: [implementation plan](../plan/phase-1l-implementation-plan.md). Live prerequisite and quality rubric: [quality review](phase-1l-quality-review.md).

## 1. Starting state

Started from `main`, commit `7446e177325bd9c7268c2292190d49345e4a1914`. The only initial working-tree item was the approved implementation plan. Created `phase/1l-constrained-local`; no merge or reset.

## 2. Checkpoints

Package A settings/policy tests and current eval parity passed before runtime work. Package B introduced runtime enforcement, deterministic fallbacks, historical evidence and normative constrained evaluation. Package C added profile-specific smoke collection, independent commit timings, a populated comparison mode, backend evidence and review artifacts. Live collection stops at K5; this is not a Phase 1L quality acceptance declaration. Implementation checkpoint identity is available in the branch log and final report.

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

Ollama version 0.40.15 responded, but required model discovery and direct lookup timed out and no loaded model was reported. No live inference was dispatched. See the quality report for exact model identity, observed hardware and outstanding offload/context verification. The original private Phase 0 artifacts remain untouched.

## 12. Comparative measurements

Deterministic Pro ledger changes from Director plus Story to Story alone; populated constrained fixtures also enforce a single call despite utility availability. These are structural observations. Same-fixture live latency, endpoint occupancy, token usage and narrative comparison are not measured because K5 applies. No speedup is asserted. New timestamps preserve cumulative `commitMs` while reporting commit-only time separately.

## 13. Quality artifacts

The redacted rubric distinguishes deterministic prompt/state evidence from live narrative judgment. All human qualitative fields remain `not_reviewed`. The seven original inputs and bounded six-turn populated fixture are available to the same live runner; current comparison routes its declared auxiliary work to the same local provider.

## 14. Validation

Final command results and counts are recorded below after validation completes. Engine tests/contracts/purity, frontend build, architecture/inference gates, focused runtime/provider-wire/backend tests, i18n and both deterministic suites are included. Existing lint debt is compared against HEAD rather than silently repaired. The requested `scripts/patch-graph-imports.mjs` does not exist in this checkout; its attempted invocation failed with MODULE_NOT_FOUND, as in prior phases.

## 15. Runtime boundaries

No provider default, persistence authority/schema, epistemic model, retrieval architecture or extension framework was replaced. The server append accepts a validated operational profile field solely for deferred NLP suppression and does not persist it as fictional metadata. The source-site inventory includes the explicit manual host-context relocation. Writer ownership/family counts remain unchanged; extension freeze maintenance records only the changed queue spellings, mixed chapter veto and two moved manual-context accesses.

## 16. Deviations and remediation

Routine mock updates were needed for the explicitly classified background-model queue method. An initial fixture used a nonexistent NPC boundary property and an incorrect relationship target; corrected to existing `hardBoundaries` and `MC` before normative acceptance. Carried-memory assertions apply when its subject is on stage. No expectation was weakened to allow extra inference or promote historical instructions. No broad registry refreeze or v0 repin occurred.

## 17. Stop and limitations

K5 blocks live collection until the exact reference model is accessible and its actual runtime settings can be verified. K6 human quality/baseline review remains outstanding afterward. Arbitrary custom native code, imports and direct fetch outside the host broker remain unverified; tests cover no-mod operation, bundled deterministic Arc binding and policy denial at the controlled broker. Synthetic smoke cannot certify real backend/vector behavior, and the disposable backend test cannot certify live narrative quality. Previously derived state can become stale; opting out does not recreate skipped records. Chapter-title fallback alone is not a long-run quality acceptance claim.

## 18. Scope closure

No Phase 2/Phase 9 implementation, provider substitution, cross-provider benchmark, production default change, baseline pin or merge. The branch is reviewable; Phase 1L remains incomplete pending its named live prerequisite and independent review.

## Final validation results

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


## Exact changed files

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
