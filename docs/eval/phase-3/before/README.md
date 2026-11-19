# Phase 3 before-state evidence

Captured on `phase/3-draft-acceptance` from runtime commit `a088d56db92fdf58934204b607485cd711ff3e31`, before any runtime behavior changes. Fixtures contain synthetic prose and endpoints only. No real campaigns or providers were used.

`normal-send.json` contains the actual canonical-turn harness result: full assembled provider payload, ordered callbacks, archive/state requests, queue observations, and final messages. It runs the real orchestrator and post-turn pipeline with transport replies fixed at the fetch boundary. It is separate from the unchanged Phase 0 baseline.

`transitions.json` records real React hooks, Zustand actions and `pendingCommit` transitions. Its pipeline and persistence calls are explicitly recorded test seams. It covers pending-to-next-send acceptance, two generated swipes, selection, edit, regenerate dispatch, archive failure followed by saving Retry, loss of the renderer snapshot followed by startup reconciliation, and campaign switch after archive failure. The snapshot-loss case characterizes current renderer recovery; it is **not** a child-process durability test. Package C must supply native filesystem/process-death evidence for the new protocol.

`focused-validation.json` is the fresh focused run (133 tests, including 25 new contract tests). Green tests supplement the traces; they do not replace them.

To recapture the original behavior, use the original runtime commit and the capture tests with `PHASE3_CAPTURE_BEFORE=1`. Capture tests are opt-in so later validation cannot overwrite historical evidence.

## Observed ownership and order

| Flow | Observed transitions and source boundaries |
| --- | --- |
| Normal send | `runTurn` resolves engines, adds user, gathers, assembles, streams and strips metadata; one variant and pending marker are saved. Next send calls `commitPendingTurn`, which updates stakes, starts prologue, archive/NPC/pressure/compute, sequential tracks and post-commit tracks, then retires the marker. Full trace is in `normal-send.json`. |
| Two swipes | Each hook invocation inserts a provisional slot, sends the cached payload, replaces its temporary variant ID on completion and displays the resulting text. Both siblings remain in the mutable array. |
| Edit | `updateVariantText` replaces text on the selected array member and message, retaining the old variant ID. The inline editor has a separate equivalent mutable replacement path. |
| Regenerate | `useMessageEditor.handleRegenerate` clears the snapshot, requests timestamp rollback, deletes from the source user message and dispatches the previous input on a timer. The old variants leave the message array. |
| Switch | `campaignSlice.setActiveCampaign` drains acceptance before switching, but catches failures and proceeds. A false archive verdict retains the failed marker only in the outgoing campaign. |
| Saving Retry | A failed pipeline retains pending variants and stamps `commitFailed`. Retry invokes the pipeline again with `verifyExistingScene: true`. The existing archive relink heuristic uses normalized user prefixes rather than exact assistant/command evidence. |
| Renderer crash/reload | Clearing the singleton snapshot leaves saved variants. `reconcilePendingCommitOnLaunch` immediately commits a ready draft through a reconstructed TurnState, then sweeps buried failures through direct append. Existing scene stamps cause early retirement without proving remaining effects. |

## Deterministic sink inventory before modification

| Required group | Implementation and actual sink |
| --- | --- |
| Generation engines | `turnStages.resolveEngineRolls`, intro/tool handlers; callback context changes and armed action consumption before finalized prose. |
| Stakes/profile/digest | `pendingCommit` and prologue tracks; callback context, NPC and profile patches. |
| Archive structure | `archiveService.appendScene`; synchronous prose append before awaiting index lock, then index JSON, entity JSON and chapter JSON writes. Numeric allocation precedes these locks. |
| Pressure/archive/restore | `pressureTrack`; facade writes, global active-campaign guard, NPC store actions and debounced NPC JSON persistence. |
| On-stage/location/movement | `onStageTrack`, `locationHeaderTrack`, `applyStoryMovement`; callbacks plus direct live-store reads/actions, asynchronous worldmap route event and generated location IDs/times. |
| Agency/activity/repression | `agencyTrack`, `agencyEngine`, `repressionTrack`; callbacks/facade writes, gameplay RNG, digest patches, optional background narration. |
| Counter/condensation | `postTurnPipeline.runArchiveTrack`, `pendingCommit`; store counter increment/reset and condenser trim. |
| Travel safety valve | `postCommit/travelAdvanceTrack`; halt context patch only, no travel-day advance. |
| Compute mods | `computeTrack` → `sandboxHost.applyJournal` → facade writes/table adapter → `setModTable` and debounced table persistence. Current journal application does not await table writes. |
| Optional produced results | NPC/profile/inventory/location/relationship/seal/event tracks and server archive NLP listener; independent state/table/archive writes. Recovery must never rerun inference to reproduce them. |

The registry order is source-backed: prologue auto-profile/digest clear; post-turn NPC/pressure plus installed compute tracks; sequential on-stage/location-header/agency/repression. Registries start promises in order, which does not imply completion order. Any replacement adapter must account for that distinction.
