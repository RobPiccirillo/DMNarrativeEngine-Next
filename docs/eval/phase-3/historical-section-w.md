# Historical Phase 3 checkpoint

This is the preserved report from before implementation of the approved exception. Its blocked/prototype statements describe that checkpoint, not the current branch.

# Phase 3 — resumed after approved architecture decision

Branch: `phase/3-draft-acceptance`. Starting/current commit: `a088d56db92fdf58934204b607485cd711ff3e31`. No commits, merges or tags were created. This report supersedes the foundation-only checkpoint. **Packages A–C are incomplete and no continuation gate is certified.**

## Approved resumption — implementation in progress

The user supplied an independent Sol High architecture decision resolving the historical Section W stop:

> Phase 3 may introduce one private host-owned preparation boundary for acceptance-related deterministic movement in the application-controlled bundled world-map. The boundary is bound to one validated acceptance command and uses shared existing domain logic against an isolated working context/runtime. Refreshes remain within that view. All acceptance-caused persistent consequences must become closed, host-validated operations with recorded inputs and original preconditions, durably published before application. Capabilities are unavailable through public mod APIs, manifests, event payloads, or caller metadata and are revoked on completion or fault. Recovery applies recorded operations without native/domain recomputation or inference. Ordinary world-map operations retain their live behavior subject to acceptance write guards. This exception grants no generic interceptor, native injection framework, truth-table ownership, or authority migration.

Recorded verbatim in plan Section P before implementation resumed. Packages A–C remain incomplete. The managed-acceptance block remains in place until the new focused containment tests pass. The historical stop and native-listener evidence below are retained as the reason for the approved exception; they no longer constitute an unresolved permission/architecture stop. Evidence and remaining gates will be updated as implementation proceeds.

## Architecture stop and evidence

The required Story movement writer crosses the standing native world-map context:

`locationHeaderTrack` → `applyStoryMovement` → `requestStoryRoute` → actual `mod.worldmap.storyRoute` listener → `freshCampaignContext` → `solveAndPersist` / `writeJourney`.

Source boundaries:

- `src/services/turn/tracks/sequential/locationHeaderTrack.ts` invokes movement from the acceptance pipeline.
- `src/services/turn/applyStoryMovement.ts` now rejects private preparation before dispatch if the native Story-route listener is present.
- `src/services/turn/storyMovement.ts` sends the existing public native event.
- `public/bundled-mods/worldmap/index.js`: the registered listener at line 2194 refreshes its captured context; `freshCampaignContext` (line 1056), `solveAndPersist` (line 1062), `writeJourney` (line 883), and `ensureSettings` perform native table/cache writes. Missing settings can mint and persist a world seed. None of this bundled native source was modified.

[Native boundary characterization](phase-3/native-writer-boundary.json) comes from `server/__tests__/nativeMovementAcceptanceBoundary.test.js`. The test installs/activates the **actual bundled module**, uses its actual registered listener and refreshed context with isolated filesystem-backed synthetic tables, and connects the real host event bus. It proves both:

1. Private preparation rejects before event dispatch: zero native or private writes.
2. Invoking that native listener writes settings and anchors through the refreshed standing context before any acceptance intent exists. The private adapter captures none of those writes.

The observed test is a settings/anchors case. The wider location/journey/cache writer chain is source-backed; it is not claimed as separately fault-tested. This is not a universal static proof of opaque native code.

The stop classification is an architectural judgment under Section W's required-writer condition: **“A required deterministic writer cannot be captured/reconciled through a narrow host seam and would force a Phase 5 domain rewrite or general Phase 10 extension redesign.”** The private turn store/table adapters do not propagate into the native listener's refreshed closure. Safely preparing and reconciling that writer requires an approved native scope/preparation boundary. Section P currently says: **“Do not add new public interceptors, leases, native injection or arbitrary truth tables.”** Global store/table monkey-patching is also outside the approved approach. Returning only route hops and omitting the settings/location/anchors/journey writes would change existing deterministic behavior. Sending internal journal operations through this public event would breach its existing scalar/identity payload boundary (`src/services/mods/events/modEvents.ts`, opening contract).

No new native injection, public interceptor or native table protocol was added to bypass this conflict. Implementation of Packages B–C stopped when the real-listener proof established the boundary. Subsequent work was containment, regression validation and this report. Resumption needs an explicit architecture decision allowing a narrowly scoped native preparation/result boundary, followed by completion of the original package gates; it does not need another broad planning exercise.

## Current development-branch behavior

**Managed pending Story acceptance is deliberately blocked. This branch is not ready for ongoing gameplay with managed drafts.**

- Draft generation, immutable revisions, selection/edit/Retry/Swipe/Continue and reload restoration are wired to durable lifecycle records.
- A managed acceptance call reports `phase3-acceptance-architecture-blocked:worldmap-native-writer-scope`; it cannot fall through to legacy acceptance. Startup restores drafts and interrupts unfinished attempts without auto-acceptance or a failed-commit sweep.
- The acceptance coordinator/router and private preparation builder remain **unfinished prototypes**. The acceptance router is **not mounted in `server.js`**; there is no delivered runtime acceptance coordinator.
- Raw legacy archive append rejects either lifecycle sidecar with HTTP 409, including caller verification flags. Legacy v1 export rejects lifecycle campaigns with `lifecycle-aware-transfer-required` rather than losing their records.
- `.drafts.json` and `.acceptance.json` join host campaign suffix discovery/backup/hash/delete. They are not generic mod tables. This is preservation registration, not lifecycle-aware playable transfer or restore certification.
- Phase 2 snapshots preserve lifecycle files, but present lifecycle records yield `phase3-lifecycle-validation-incomplete` and block cutover/restore eligibility until independent validation exists. Existing fixtures without lifecycle files retain their eligibility. This is a fail-closed containment measure, not completion of Package C.
- Existing unmanaged legacy test paths remain for regression characterization. Passing them does not demonstrate managed acceptance.

## Deliverable coverage and limitations

| Area | Implemented and evidenced | Still required |
| --- | --- | --- |
| Before-state evidence | Original synthetic normal-send payload/callback/sink trace and hook/store transitions retained unchanged in [before evidence](phase-3/before/README.md). | Actual-wire equivalence across completed managed acceptance. |
| Draft contracts | Engine sets/attempts/immutable revisions/candidates, explicit compatibility references, source/turn lineage, ID-based selection. Equal-text revisions keep distinct identities. | Full Package A continuation certification. |
| Exact hashing | Fixed `story-visible-v1` encoding, malformed UTF-16 rejection, Node/WebCrypto vectors, separate hash/version/head fields. | Actual browser-process evidence if required for closure. |
| Compatibility | Strict supported pre-cutover binding; ambiguous legacy variants preserved in recovery-required records. Runtime hydration skips legacy auto-repair/acceptance for managed state. | Broader campaign and authority/control coexistence validation. Unsupported authority sidecars fail closed. |
| Generation runtime | Lifecycle route/service; persisted attempt before Story request; final exact text/hash; provisional streaming kept separate; private UUID identities independent of game RNG. | End-to-end gate and wider transport/save entry-point race coverage. |
| Revision actions | Real hooks retain two Swipe siblings, edit children with invalidated metadata, Retry/regenerate lineage, same-turn Continue children, retained nonempty aborted Continue. Explicit regeneration after reload reconstructs a payload from the source turn. | Completed coordinator integration and accepted-history end-to-end proof. |
| Save recovery | Stable transition ID/request/result replay recovers a lost finalized-draft response without model work or duplicate revision. State saves now check HTTP status. | Full checked-token scheme and serialization across all managed state PUT/debounce/Exit/hydrator surfaces. |
| Startup | Restores selected persisted revision; interrupts streaming; no model call/archive append. | Acceptance recovery/drain startup, provider-free result replay through actual runtime coordinator. |
| Acceptance contracts/journal | Exact legacy envelope validator, original semantic-request bytes/digest, reserved scene/head/result/ack; historical replay before new-head validation. Native primitive tests cover partial tails, publication/receipt/outcome crashes and fresh-process recovery. | Host coordinator authority/token proof and all Section K writer integration. Primitive proof is not runtime acceptance proof. |
| Private effects | Optional scoped store/API/queue/event forwarding threaded through relevant tracks; private preparation/coordinator/archive preview prototypes. Required native writer fails closed before its event. | Full deterministic/produced-result capture, closed target registry, archive/field patch verification, actual sandbox/native writer fault matrix and frozen-bundle recovery. |
| Transfer/backup | Lifecycle sidecars preserved in campaign file family; lossy export and unsupported cutover rejected. | Lifecycle-aware playable bundle, references/replay/ack validation, fresh restore tokens and independent Phase 2 validator. |
| Static/eval | Exact writer/forwarding inventory additions; existing inference family assigned to the prototype stakes call. Baseline phase gates rerun. | Phase 3 evaluator, managed state/marker/static negatives and whole-runtime writer closure. |
| Operations | Native primitive fsync/rename exercised on this platform. | Acceptance p50/p95, disk amplification, long-campaign journal growth, complete save/Exit races and baseline overhead. No transactional or unconditional power-loss durability claim. |

Package A has real runtime evidence, but its continuation gate has not been declared passed. Package B has unmounted prototypes and a required-writer architecture stop. Package C has primitive fault proof and containment tests, but no approved `phase-3-acceptance-v1` evaluator or complete lifecycle/static/operations closure. No final independent Sol High review was requested: the user's condition requires completed A–C first.

## Validation actually run on resume

- Full application suite after runtime changes and fixture corrections: **5,782 passed, 0 failed, 3 pending**. [Summary](phase-3/resume-full-validation.json). This run preceded the final seven containment tests; the subsequent focused run includes them.
- Subsequent real-router/hook/native-boundary/archive/export/migration containment suite: **54 passed** across five files, including **11 draft runtime tests**, the actual native listener proof, two raw append negatives, two lossy export negatives and two lifecycle cutover negatives. [Summary](phase-3/resume-containment-validation.json). This validates containment, not Package C closure.
- Engine: **456 passed**, platform purity gate passed, contract compiler-negative typecheck passed.
- Frontend build passed; existing dynamic-import and large-chunk warnings remain.
- Writer/projection gate passed: 178 registered writers, 144 producers, 34 sinks; extension freeze 574 sites across 144 files. Only explicit new owners/changed host forwarding signatures were updated; no target-authority grant. Existing opaque `nativeLoader` import remains unverified. [Projection determinism](phase-3/resume-projection-validation.json) passed across two regenerations.
- Inference gate passed: 46 families, 106 frontend sites, 14 server/provider sites. The one new prototype facade site uses existing `scene-stakes-classify`; no new inference policy/family or native model surface. Prior assignment retention test updated to assert this exact addition.
- Migration boundary and i18n checks passed. New lifecycle copy uses existing English fallback behavior; untranslated locales remain visible as such.
- Changed-file lint reports **14 existing errors** in four touched files; comparison against `HEAD` under the same configuration yields the same 14 rule diagnostics. No broad cleanup was performed. [Comparison](phase-3/resume-lint-validation.json). This is not a clean-lint claim.
- `git diff --check` passed. The documented graph command was attempted again; `scripts/patch-graph-imports.mjs` is absent. No graph tooling was reconstructed.
- Phase 0: five MATCH; five BYTE_STABLE PASS; baseline VALID. The same two known visibility violations remain; no repin.
- Phase 1L: seven MATCH; seven BYTE_STABLE PASS; constrained normative checks pass. Existing UNPINNED diagnostic remains; no profile/policy changes or repin.
- Phase 2 persistence evaluation passes empty, small and 250-scene fixtures without lifecycle files: all eligible-snapshot-only, zero blockers. Present lifecycle records intentionally block pending independent validation. No live SQLite authority moved.
- Previous foundation evidence remains in [foundation validation](phase-3/foundation-validation.json): contracts/compatibility, native repository, 48 native journal fault/recovery tests, foundation dependency negatives and legacy base-app coverage. Its older full-run failure was corrected and is superseded by the fresh full run above.

Validation used synthetic isolated campaign directories and deterministic fake model boundaries. No real campaign was converted, no live provider smoke ran, and no real campaign data or credentials are in the evidence summaries. Native journal recovery fixtures reject fetch/game randomness. This does not certify recovery of every gameplay writer.

## Preserved phase boundaries and next work

No live gameplay authority moved to SQLite; no canonical campaign adoption was invented; no domain tables, rewind/correction system, generic event sourcing or job outbox were introduced. Phase 1L policy and reviewed visibility dispositions are unchanged. Phase 4 and later obligations remain as written in plan Section X.

After the native boundary decision, remaining Phase 3 work is to finish/certify Package A, connect and secure the single runtime acceptance coordinator and all required deterministic/produced-result adapters, deliver checked save tokens and lifecycle transfer/backup/restore/Phase 2 validation, complete the full native fault matrix, evaluator/static negatives and operational measurements, then request the one final independent Sol High review. Green foundational and legacy regression suites do not replace any of those gates.

## Exact changed-file inventory

Paths are relative to the repository root. Includes prior foundation work and resumed runtime/prototype/containment work; no completion/ownership claim is implied.

- `docs/architecture/extension-freeze.json`
- `docs/architecture/inference-inventory.json`
- `docs/architecture/inference-inventory.md`
- `docs/architecture/writer-inventory.json`
- `docs/architecture/writer-inventory.md`
- `docs/eval/phase-3-status.md`
- `docs/eval/phase-3/before/README.md`
- `docs/eval/phase-3/before/focused-validation.json`
- `docs/eval/phase-3/before/normal-send.json`
- `docs/eval/phase-3/before/transitions.json`
- `docs/eval/phase-3/foundation-validation.json`
- `docs/eval/phase-3/native-writer-boundary.json`
- `docs/eval/phase-3/resume-containment-validation.json`
- `docs/eval/phase-3/resume-full-validation.json`
- `docs/eval/phase-3/resume-lint-validation.json`
- `docs/eval/phase-3/resume-projection-validation.json`
- `docs/eval/phase-3/working-validation.json`
- `packages/engine/package.json`
- `packages/engine/src/contracts/draftCompatibility.ts`
- `packages/engine/src/contracts/draftLifecycle.ts`
- `packages/engine/src/contracts/legacyAcceptance.ts`
- `packages/engine/typechecks/contracts.ts`
- `server.js`
- `server/__tests__/archiveAppend.test.js`
- `server/__tests__/campaignMigrationReview.test.js`
- `server/__tests__/draftLifecycle.test.ts`
- `server/__tests__/draftLifecycleRuntime.test.ts`
- `server/__tests__/fixtureRoundtrip.test.js`
- `server/__tests__/fixtures/phase3JournalChild.mjs`
- `server/__tests__/legacyAcceptanceJournal.test.js`
- `server/__tests__/legacyDraftRepository.test.ts`
- `server/__tests__/legacyTransfer.test.ts`
- `server/__tests__/modTableRegistry.test.js`
- `server/__tests__/nativeMovementAcceptanceBoundary.test.js`
- `server/__tests__/tableRegistry.test.js`
- `server/lib/durablePublication.js`
- `server/lib/fileStore.js`
- `server/lib/legacyFieldPatch.js`
- `server/routes/acceptance.js`
- `server/routes/lifecycle.js`
- `server/routes/transfer.js`
- `server/services/acceptanceCoordinator.js`
- `server/services/archiveService.js`
- `server/services/campaignMigration/readers.js`
- `server/services/campaignMigration/sourcePolicy.js`
- `server/services/draftLifecycleService.js`
- `server/services/legacyAcceptanceJournal.js`
- `server/services/legacyArchivePreparation.js`
- `server/services/legacyDraftRepository.js`
- `src/App.tsx`
- `src/architecture/__tests__/phase3FoundationBoundary.test.ts`
- `src/architecture/__tests__/providerInventory.test.ts`
- `src/components/ChatArea.tsx`
- `src/components/__tests__/ChatArea.test.tsx`
- `src/components/chat/DraftLifecycleStatus.tsx`
- `src/components/hooks/__tests__/phase3BeforeState.test.tsx`
- `src/components/hooks/useMessageEditor.ts`
- `src/components/hooks/useRetryStoryAI.ts`
- `src/components/hooks/useSceneContinue.ts`
- `src/components/hooks/useSwipeVariants.ts`
- `src/hooks/__tests__/useChatOperations.directorBrief.test.ts`
- `src/hooks/useChatOperations.ts`
- `src/i18n/locales/en.ts`
- `src/services/npc/agency/agencyEngine.ts`
- `src/services/turn/__tests__/baseAppGate/phase3BeforeState.test.ts`
- `src/services/turn/acceptance/effectAdapter.ts`
- `src/services/turn/acceptance/prepareEffects.ts`
- `src/services/turn/applyStoryMovement.ts`
- `src/services/turn/drafts/regenerationPayload.ts`
- `src/services/turn/drafts/runtime.ts`
- `src/services/turn/pendingCommit.ts`
- `src/services/turn/postTurnPipeline.ts`
- `src/services/turn/tracks/npcTrack.ts`
- `src/services/turn/tracks/postCommit/chapterSealTrack.ts`
- `src/services/turn/tracks/postCommit/eventExtractionTrack.ts`
- `src/services/turn/tracks/postCommit/inventoryScanTrack.ts`
- `src/services/turn/tracks/postCommit/locationScanTrack.ts`
- `src/services/turn/tracks/postCommit/pcDriftTrack.ts`
- `src/services/turn/tracks/postCommit/profileScanTrack.ts`
- `src/services/turn/tracks/postCommit/relationshipMemoryTrack.ts`
- `src/services/turn/tracks/postCommit/traitScanTrack.ts`
- `src/services/turn/tracks/postCommit/travelAdvanceTrack.ts`
- `src/services/turn/tracks/sequential/locationHeaderTrack.ts`
- `src/services/turn/tracks/types.ts`
- `src/services/turn/turnOrchestrator.ts`
- `src/services/turn/turnStages.ts`
- `src/store/campaignHydrator.ts`
- `src/store/campaignStore.ts`
- `src/store/slices/uiSlice.ts`
- `src/types/campaign.ts`
