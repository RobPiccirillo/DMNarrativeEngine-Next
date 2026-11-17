# Phase 3 implementation plan — explicit drafts and recoverable acceptance

Planning date: November 16, 2026. Inspected source: `main` at `d2aecdd807fe4c5569a8e0ac726f5909f7a98d39`, also the target of `phase-2-complete`. The working tree was clean before this planning pass. This document proposes implementation; it does not begin it.

The authoritative scope is [roadmap 003, Phase 3](../architecture/003-implementation-roadmap.md#phase-3--explicit-draft-swipe-and-acceptance-lifecycle), interpreted with [architecture 002](../architecture/002-target-architecture.md). The roadmap explicitly **does not claim atomicity across legacy multi-file effects in Phase 3**. Phase 4B2 remains the first live SQLite authority switch and the first atomic narrative/critical-state acceptance boundary. Phase 3 supplies exact revision identity, command replay protection, and honest reconciliation over existing files.

The Phase 0/1/1L/2 status documents contain historical pending-review/merge statements. Git history and completion tags confirm the user's post-Phase-2 starting point; those statements are not new stop conditions. The freshly executed constrained evaluator still reports its baseline as `UNPINNED` despite the repository containing a reviewed pin commit. Preserve that discrepancy as evaluation tooling/provenance evidence; do not repin anything during Phase 3 to conceal it.

## A. Phase 3 roadmap acceptance matrix

Dependency keys: **P1-ID** = Phase 1 stable/compatibility references; **P1-CMD** = mutation/provenance/version/replay contract; **P1-ROUTE** = authority lookup and historical-outcome ordering; **P2** = staging/source inventory/backup/restore framework. Seams below are concrete existing boundaries or proposed modules, not claims of delivered behavior.

| Roadmap requirement | Current source behavior | Required Phase 3 behavior and seam | Required evidence | Dependencies / explicit deferral |
| --- | --- | --- | --- | --- |
| 3A: draft set, revision, source player message, generation metadata, hash, selected revision, invalidation | `ChatMessage.swipeSet` stores mutable variants; selection is an index; nearest preceding user message is rediscovered | Pure draft contracts and state machine; explicit source reference, attempt identity, immutable revision, selection by ID; `turn/drafts/`, `types/campaign.ts`, `turnContext.ts` | Identity/reorder/equal-text/lineage and serialization tests | P1-ID; canonical campaign adoption and SQLite schemas remain Phase 4 |
| 3A: preserve lazy swipes and message editing | One initial variant; up to five lazy variants; edits replace text under the same variant ID | Preserve controls/limits; edit creates a child revision; swipe completion creates a sibling; streaming is provisional | Two swipes, edit, navigation while streaming, abort, regenerate, late-result UI tests | No alternate playable branches or new generation feature |
| 3B: one idempotent acceptance command | Several callers share one renderer-global promise; no persisted command identity | All triggers prepare an exact candidate and enter one host coordinator; campaign/key scoped flights and durable outcomes | Concurrent renderer/tab, duplicate after restart, changed-semantics rejection | P1-CMD/P1-ROUTE; no general command bus |
| 3B: displayed versus canonical accepted revision | `content` is both display and archive input; markers and `sceneId` imply acceptance | Separate displayed/selected/accepted/acknowledged references and state transitions | UI/content mismatch and selected-revision race tests | Keep legacy chat/archive authority |
| 3B: expected canonical head before effects | No expected-head validation | Compare an opaque legacy head version under the server campaign lock before any new acceptance effects; never rebase | Two candidates at one head, stale tab/editor, ABA/delete/restore cases; zero writes on conflict | P1-CMD equality version; no Phase 4 commit schema |
| 3B: four crash states | Pending marker, optional `commitFailed`, snippet matching and launch append sweep | Durable intent, exact prepared effects, per-effect reconciliation, completed outcome and separate acknowledgement | Real-file child-process death before intent, during effects, after effects before ack, and during restart reconciliation | P2 durability patterns only; no cross-file transaction claim |
| 3B: unambiguous retry | Generation Retry needs a volatile cached payload; commit retries infer current selection | Generation Retry creates a new attempt; acceptance recovery uses the stored candidate and same logical key only | Change current UI selection before recovery; prove original outcome and zero model calls | P1-CMD; no proposal trailer |
| 3B: keep legacy archive/post-turn behind adapter | Pipeline starts parallel work and archive append; effects can run despite archive failure | Coordinator owns invocation and effect receipts; existing archive/state/track implementations remain adapters | Existing current/constrained scenarios plus faulted adapters | Domain state redesign remains Phases 4–6 |
| Compatibility: deterministic IDs/hashes for existing pending messages; accepted history not rewritten | Hydrator strips orphan markers and heuristically recovers scene stamps | Deterministic, explicitly noncanonical compatibility references; preserve all old variants and exact display; ambiguous input is retained with a conflict | Legacy fixture load/select/edit/accept/reload; duplicate locator and malformed-index cases | P1-ID/P2; no backfill rewriting accepted prose |
| Acceptance: every variant has stable revision ID/hash | Variant IDs exist but can change on slot completion and survive mutable edits; no hashes | Every finalized revision has immutable identity/hash, including edits/Continue/imported variants | Roundtrip, identical text twice, serialization/hash golden tests | Hash is content identity only |
| Acceptance: edits/swipe changes invalidate prior hash-bound metadata | Stakes/reasoning/snapshot metadata can outlive text changes | Bind consumable metadata to revision/hash and selection generation; invalidate candidate bindings on edit/selection | Stakes/tool-proposal/snapshot contamination tests | Do not implement future Story proposals |
| Acceptance: idempotent and single-flight | Single-flight is memory-only and global | Exact logical command survives client/server restart; same key with changed semantics rejects | Concurrent same/different commands; owner/epoch changes on historical replay | P1-ROUTE; operational journal is legacy-compatible |
| Acceptance: reject unexpected head without silent candidate rebase | No corresponding gate | Typed `version-conflict`; retain candidate and text; zero append/effect calls | Stale-head tests with overlapping sends and maintenance operations | Current domain authority is unchanged |
| Acceptance: unselected variants never enter archive/retrieval | Normally only current text is appended; selection/content can diverge | Archive consumes only frozen candidate text; draft files excluded from normal retrieval/exported narrative | Unique canaries in every sibling; archive, lexical/vector source and actual wire checks | Retrieval replacement remains Phase 8 |
| Acceptance: four windows recover without confusing state | Heuristic recovery cannot prove exact revision/effects | Recovery reports precise phase, repairs only proven steps, fails closed on ambiguity | Fault matrix in R, including death during recovery itself | No automatic rollback of multi-file effects |
| Acceptance: detect/reconcile, no legacy atomicity claim | Independent archive/index/entities/chapters/state writes | Write-ahead recovery records and per-file conditional application; explicit unresolved status | Partial-write, wrong-file-version, torn-tail and disk-error tests | Transactional visibility belongs to 4B2 |
| Acceptance: equivalent swipe/edit/regenerate UX | Existing controls work before commit; accepted edits use legacy correction paths | Same normal controls and prompts; lifecycle metadata changes underneath; explicit recovery/conflict labels only | Interaction traces and tests in both profiles | No Phase 7 correction/rewind implementation |
| Acceptance: no unintended call-count/prompt change | Phase 0/1L evaluators record existing behavior | Compare actual provider wire, purposes/attempts, deterministic state and effects separately from new lifecycle artifacts | Existing evals plus new Phase 3 suite; no baseline repin | Phase 1L policy/history trust remain intact |

The roadmap also requires before-state traces for normal send, two swipes, edit, regenerate, campaign switch, retry after archive failure, and crash recovery. Capture that complete trace set at the start of Package A, before runtime edits. Existing green tests are prerequisites, not substitutes for those traces.

## B. Current Story/draft/acceptance lifecycle

Runtime evidence: [useChatOperations](../../src/hooks/useChatOperations.ts), [turnOrchestrator](../../src/services/turn/turnOrchestrator.ts), [turnStages](../../src/services/turn/turnStages.ts), [pendingCommit](../../src/services/turn/pendingCommit.ts), [postTurnPipeline](../../src/services/turn/postTurnPipeline.ts), [archive service](../../server/services/archiveService.js).

| Step | Ownership, state, persistence, effects and failure behavior today |
| --- | --- |
| Player send | `useChatOperations` captures/clears armed roll, loot, event, gallery and Absolute Command state; clears composer and old retry flags; takes a store snapshot; then awaits `commitPendingTurn().catch(...)`. A failed commit does not prevent the next `runTurn`. Some next-turn inputs are captured before the preceding commit settles. |
| Engine preparation | `resolveEngineRolls` rolls engines and writes updated DCs immediately. Other armed results become prompt/display directives. User message ID comes from `uid()`; `content` and player-facing `displayContent` differ. These are generation-time effects, not delayed archive effects. |
| Context/request | Gather, optional intro/director/interceptors/facts, payload construction, then provider streaming. `TurnContext.turnId` is a session-local monotonic counter. Profile `current` retains optional calls/tools and automatic retry branches; constrained normal play permits one Story attempt and no tools/automatic auxiliary inference. |
| Stream/validation | Assistant bubble uses `uid()` and mutates during streaming. Tools can add ephemeral tool messages and context/proposal effects; the assistant ID is reused. Header and stakes processing produces visible text. Constrained normal success explicitly rejects stripped-empty prose; manual Retry/Swipe/Continue have final-visible-text guards. The normal current branch lacks the same explicit final stripped-empty guard. There is no draft hash validation. |
| Working draft | Success creates one `SwipeVariant`, stamps `pendingCommit`, `swipeActiveIndex=0`, and freezes messages/payload/TurnContext in a singleton snapshot. An earlier snapshot supports failed-generation Retry. `persistTurnState` is invoked without awaiting its completion; `persistPendingTurn` catches failures. `turn.generated` therefore does not prove durable persistence despite the adjacent comment. |
| Acceptance trigger | Next send, campaign switch/Exit, startup reconciliation, Arc Injector and host action/menu drains reach `commitPendingTurn`. It shares one global in-flight promise, finds the latest marked assistant, chooses stakes using the current index, but archives `pendingMsg.content`. No command ID/head/version/CAS check exists. |
| Early retirement | Any pending message already carrying a `sceneId` is retired without checking archive bytes or unfinished deterministic effects. |
| Commit pipeline | Stakes fallback may call a utility; context stakes change before archive success. Prologue tracks start; archive, NPC, pressure and mod tracks start together. All settle; then the sequential registry starts on-stage, location-header, agency and repression tracks in that registration order. The registry starts promises; its name does not guarantee await-between-track ordering. They run even when archive reports failure. |
| Archive append | Server allocates max(scene numbers in prose/index)+1; synchronously appends Markdown before any await; writes index under one lock, starts embedding, then entities/chapters under another lock; emits deferred NLP event; returns the numeric locator. Allocation/append is outside those lock sections. |
| Scene stamp and bookkeeping | Client stamps the last assistant, fetches index/timeline/chapters, increments/resets bookkeeping counter, starts post-commit event/chapter/profile/trait/inventory/location/PC/relationship/travel tracks. Those promises are background and do not govern archive success. Current optional importance can precede append. |
| Retirement/save | On pipeline `archived !== false` (including missing result in old doubles), retire removes swipe variants and pending/failure flags; state save is fire-and-forget. `saveCampaignState` awaits fetch but does not check HTTP success. Several other debounced saves also ignore HTTP status. JSON files use tmp+rename, not a multi-file transaction. |

Important alternate flows:

| Flow | Current behavior / gap |
| --- | --- |
| Failed or aborted generation | Partial/error assistant gets ephemeral `retryable` and `precontext`; no successful pending variant. Current may automatically retry; constrained does not. Save strips retry fields; reload loses generation Retry context. |
| Explicit Retry | Reuses cached payload without gathering, tools off; overwrites failed bubble; success creates variant 0 and pending markers. It refreshes the frozen snapshot text. It is a generation request, not an acceptance retry. |
| Swipe | Hook inserts a streaming slot with a temporary ID; the generator returns a different completed variant ID. Navigation updates index, content and reasoning, and saves with debounce. Late completion uses refs/marker checks. All variants persist only while pending. |
| Edit | Pending visible variant text mutates under its old ID, together with message text. Other edit/rename/replace helpers mutate messages too. Accepted assistant edit is on-screen-first, archive PATCH later; failure is nonfatal. User edit/regenerate deletes a suffix and re-sends, with legacy timestamp-based archive rollback. |
| Scene Continue | Pending-only; cached payload or a fresh gather fallback; appends merged text to the current variant under its existing ID. No new turn, scene, engine-counter advance or armed-state consumption. Abort can retain partial merged prose; non-abort failure restores original text. |
| Campaign switch/Exit | Switch drains pending commit before changing campaign but catches failure and continues. Header saves first and calls the async switch without awaiting it. Generic/mod action drains also catch failure. |
| Reload | Hydrator loads messages, strips markers from non-assistants, heuristically reconstructs missing scene stamps, can save repairs. App then launches commit reconciliation asynchronously after marking campaign loaded. A fresh pending draft is automatically committed. Frozen payload/TurnContext are gone. |
| Lost archive acknowledgement | `api.archive.append` returns `undefined` for both rejected request and network loss. Recovery compares normalized first 80 characters of user input against the last three index entries. It never verifies exact assistant text or command identity. |
| Partial archive/state | Prose can exist without index/entities/chapters or a client scene stamp. Conversely client state can retain a scene stamp after archive deletion/failure. `sceneId` retirement trusts the stamp. A successful state save alone does not prove acceptance. |
| Buried failed commit | Startup scans `commitFailed` messages and directly appends them oldest-first, without the normal re-link check; it skips other bookkeeping because current state has advanced. Repeated inputs can be ambiguous or duplicated. |
| Duplicate/stale acceptance | Same-renderer overlapping calls are coalesced. Restart/two-tab replay is unprotected. No stale-head rejection exists. |

## C. Current identity/version model

| Identifier/version | Present semantics | Phase 3 treatment |
| --- | --- | --- |
| `Campaign.id` / filesystem storage key | Persisted legacy string; campaign files are flat under `data/campaigns/<id>.*` | Storage locator, never cast to `StableId<'campaign'>` |
| `ChatMessage.id` | Persisted `uid()` = clock plus `Math.random`; no canonical identity contract | Explicit legacy message reference; validate uniqueness before adapting |
| `TurnContext.turnId` | Session counter such as `turn_1`; lost with snapshot, reused across sessions | Event correlation only; retain for compatibility alongside durable turn reference |
| `SwipeVariant.id` | Persisted while pending; no immutable-content meaning; slot ID can be replaced | Compatibility locator for old variants; new attempt/revision references are separate |
| `swipeActiveIndex` | Mutable persisted display order | Projection of selected revision ID only |
| `pendingCommit`, `commitFailed`, `sceneId` | Booleans/locator imply several lifecycle states without a command | Compatibility inputs, not authoritative acceptance evidence |
| Archive `sceneId` | Padded numeric string; max of surviving prose/index plus one; tail numbers may be reused after delete/rollback | Legacy locator; reserve new managed allocations durably; never use as turn/revision identity |
| `retryable`, `precontext`, snapshot/payload | Ephemeral; stripped by primary save helper | Persist safe attempt status; keep rich prompt/provider context volatile |
| Existing hashes | Backup MD5 dedupe and Phase 2 source/semantic SHA-256 hashes | Not Story revision hashes or gameplay head versions |
| Phase 1 `ContentVersion` | Opaque equality token, not global ordering | Separate legacy head, draft-set selection version and sink content preconditions |
| Authority document `revision` / `FormatEpoch` | Control-file CAS revision and owner/schema epoch | Neither is a narrative head version; no transition is performed here |
| Phase 2 canonical-looking IDs | Explicit import-copy identity or opaque staged references | Not evidence of a live campaign/child canonical mapping |

References: [identity](../../packages/engine/src/contracts/identity.ts), [mutation vocabulary](../../packages/engine/src/contracts/mutationVocabulary.ts), [authority control store](../../server/lib/authorityControlStore.js), [migration readers](../../server/services/campaignMigration/readers.js), [fileStore](../../server/lib/fileStore.js).

## D. Draft/revision model

Implement pure contracts in the shared engine and application adapters under `src/services/turn/drafts/`. Do not serialize callbacks, providers or `TurnContext` wholesale.

| Concept | Minimum fields and rules |
| --- | --- |
| `DraftSet` | Durable set reference; legacy campaign-instance scope; durable turn reference; source player-message reference and exact archived-user-text snapshot; expected head; ordered revision references; selected/displayed revision references; selection version; lifecycle status |
| Generation attempt | Durable opaque attempt reference allocated before request; kind `initial`, `retry`, `swipe`, `regenerate`, `continue`; source attempt/revision when applicable; profile ID, sanitized model/provider alias, logical model-call reference; status streaming/completed/failed/aborted/interrupted |
| `DraftRevision` | Immutable revision reference, set/attempt reference, exact final prose, versioned hash, parent revision and reason, generation metadata, bound auxiliary metadata. Editing has no model attempt; it has user provenance. |
| `AcceptanceCandidate` | Campaign/set/turn/message/revision references, hash, expected head, expected selection version, archived user text, bound metadata version. It never means “whatever is currently visible.” |
| `DraftLifecycleState` | Draft/streaming; ready; acceptance pending; partially applied/recovery required; accepted; acknowledged; stale/conflicted; discarded/closed. Attempt status is separate. |

One active editable set per campaign. Many siblings/edits/failed attempts can exist inside it. Two tabs may prepare competing sets; only the persisted active set/selection version can advance. An unresolved acceptance blocks starting a later turn in that campaign, preventing new buried failures. Historical unresolved legacy sets are retained individually and resolved in order or surfaced for repair.

Streaming buffers are mutable provisional attempt data, never immutable finalized revisions. Completion seals a revision. A user edit creates a child even when text is unchanged; identical bytes may share a content hash while their revision identities differ. Swipe creates a sibling in the same set. Regeneration of an unaccepted turn records its source, preserving discarded revisions instead of deleting the only recovery evidence. Continue creates a child containing merged text in the same set/turn. No accepted-history branching is introduced.

Selection and display are distinct while streaming/navigation is active. Acceptance is allowed only for a finalized, nonempty revision whose persisted selection and displayed reference/content agree with the candidate. Persist selection before allowing fast acceptance. On a failed selection save, retain the local view with an unsaved indicator and block acceptance until reconciled. Never choose another sibling to make a failed command succeed.

## E. Hash/version semantics

Use `sha256` over UTF-8 canonical bytes of the fixed-field object `{"schema":"story-visible-v1","text":<exact-final-text>}`. Reject malformed string encoding. Keep Unicode, whitespace and line endings as stored; no trim, lowercase, Markdown rendering or snippet normalization in the hash. Empty-prose validation is separate. Browser and server implementations must share test vectors.

Hash the exact stored narrative string after existing scene-header/stakes stripping and tool-preamble accumulation, and after edit/Continue merging. Include surviving location/presence/movement text: some headers remain gameplay-relevant content today. Exclude only metadata actually separated from that string: hidden reasoning, stripped tags/headers, provider usage, transport/tool envelopes, attachment UI and scene allocation. Do not introduce new prose stripping or prompt changes.

Bind stakes, tag presence, tool-derived proposal references and any reusable content-dependent metadata to both revision ID and content hash. The command semantic request also includes the relevant metadata binding, source user content and lineage references; prose hash alone cannot detect changed mutation semantics. Editing invalidates prior consumable bindings. Selection changes invalidate the active candidate and its attached metadata; switching back may reuse only that revision's own still-valid metadata, never copy from the previously selected sibling. Existing reasoning panels may display revision-specific data but reasoning is not an acceptance instruction or mutation source.

Keep three versions distinct:

1. **Draft content hash:** content equality, not entity identity or order.
2. **Draft-set version:** equality token for selection/edit/discard concurrency.
3. **Legacy canonical-head `ContentVersion`:** owner-defined opaque token incorporating a persistent monotonic acceptance/maintenance generation and head receipt or initial legacy anchor. Rollback to the same numeric scene/text cannot recreate an older token. Mutable file sinks additionally use their own exact byte/version preconditions.

Bootstrap the legacy anchor from strictly read, reconciled persisted archive/state evidence under the campaign lock, preserving source hashes. Never hash all campaign content per normal turn. Managed archive maintenance increments the head generation even when the numeric tail is unchanged; initially unresolved archive/state disagreement blocks bootstrap. Head version is not proof every domain is synchronized.

## F. Acceptance-command design

The Phase 1 [MutationCommand](../../packages/engine/src/contracts/mutation.ts) requires a proven canonical campaign and command ID. Current live legacy campaigns do not have that binding. Do not mint a supposed canonical campaign from the filename or reuse Phase 2's import-copy identity to satisfy that type.

Define `AcceptanceCommand` as a discriminated boundary:

- Canonically bound branch: `MutationCommand<story.accept, AcceptancePayload>` when an independently established mapping exists; this is the future-compatible shape, not a Phase 3 adoption feature.
- Legacy branch used now: a narrowly named `LegacyAcceptanceCommand`, using Phase 1 `SourceReference`/`CompatibilityReference` for campaign, command, turn, draft and revision, and the same mandatory kind/domain, provenance, expected owner/format, exact content precondition and replay-mode vocabulary. Validate it explicitly; never claim it passes `isMutationCommand` or weaken that validator to admit legacy strings.

Generate new legacy operational locators with host-owned random UUIDs, independent of the existing `Math.random` stream. Persist the explicit campaign-instance/source scope once. These references remain compatibility identities; Phase 4 must import/map them. Deterministic hydration of old records is specified in M.

New acceptance uses domain `narrative-evidence`, kind `story.accept`, owner `legacy-runtime`, an explicit adapter format epoch, `expectedVersion: exact(expectedHead)`, and command-ID idempotency. Support caller-key mode only if needed by an existing caller; test its contract rather than inventing an unprotected mode. Namespace replay by campaign instance/domain/mode/logical key, **never current owner or format epoch**.

Provenance records user acceptance origin, host writer ID, exact source player-message/turn, revision and model-call references; generation Retry/Swipe/Continue lineage lives on the revision. Recovery records a repair execution entry without changing the original command provenance. No provider credentials, raw request objects or hidden reasoning in these records.

Order of operation is mandatory:

1. Validate envelope and kind-specific payload, campaign-instance binding and basic capability boundary.
2. Look up the logical key and compare the original versioned semantic request. Existing matching intent resumes; completed matching outcome returns the original value/version without applying effects. Changed kind/payload/provenance/precondition/source/evidence fails `idempotency-key-reused`.
3. Only an unseen command checks current owner/epoch/writability, expected canonical head, active set, selection version, exact revision/hash and nonempty visible text.
4. Persist intent before invoking any acceptance side effect.

Match Phase 1 replay semantics: owner/epoch rebinding is execution metadata, not a new logical command; caller-key mode may change command ID. Preserve all other semantic fields. Store the semantic request itself plus a digest, with deterministic key ordering and preserved array order. Do not rely exclusively on a hash, current payload parser interpretation, or current UI state to recover old commands.

Results distinguish accepted, duplicate, in-progress, version conflict, invalid/stale candidate, invalid binding, authority rejection, persistence failure and recovery required. An accepted outcome names revision/hash/scene locator/original resulting head and deterministic-effect completion. Acknowledgement is separate, idempotent and bound to that outcome.

## G. Authority/canonical-state semantics

Archive Markdown remains legacy narrative evidence. Campaign state and dedicated NPC/location/mod/etc. files keep their current ownership. Draft records own working selection only. The acceptance journal owns operational intent/outcome/recovery, not a competing fictional database. Its saved prose/effect payloads are recovery evidence, never a second normal retrieval source.

Operationally, acceptance completes only after the coordinator verifies the chosen archive block, required structural archive writes, exact message scene/revision stamp and deterministic effect receipts, then persists the completed outcome/head. A partial archive append is reported as partial acceptance, not falsely acknowledged as settled and not silently deleted. Conflicting legacy authorities require repair evidence; neither the last message nor the last index row wins automatically.

Use one narrow legacy authority adapter for these new authoritative acceptance reads/writes, implementing the Phase 1 lookup/rejection ordering. No new live SQLite router/repository. Advanced/malformed control state fails closed; absence of an authority sidecar is not universal proof of non-adoption. Phase 3 recognizes only the current explicitly supported pre-cutover format and records that legacy binding; Phase 4 must replace it with independent adoption evidence. Do not initialize/advance the dormant authority control plane as a side effect of opening a draft.

Accepted message editing, deletion, rename and rollback remain existing legacy maintenance operations. They must serialize against acceptance, invalidate its head/candidates, and retain original acceptance receipts as historical outcomes. A receipt certifies what was accepted at that time; it must not claim that later legacy editing left those bytes unchanged. Record affected scene and before/after content versions for boundary reconciliation. Do not add superseding canonical revisions, impact analysis or rewind schemas. Do not rewrite old accepted history during hydration.

## H. Persistence model

Use dedicated, schema-versioned flat files consistent with the current campaign layout:

- `<id>.drafts.json`: campaign-instance binding, active sets/attempts/revisions, selected/displayed references, selection versions, safe interrupted-generation status and compatibility mappings.
- `<id>.acceptance.json`: legacy head/generation, numeric scene high-water reservation, original semantic requests, pending intent, frozen adapter inputs, prepared effect steps, completed outcomes, acknowledgement state and explicit repair status.

Retain closed unselected/edited revisions as noncanonical working history through Phase 3; do not automatically prune them during this migration. Keep completed logical outcome tombstones even if later retention removes bulky recovery payloads. Retention/compaction can be explicit later work; the initial files may grow and that cost must be measured. Do not store full chat or archive copies in every receipt: retain only exact command inputs and the affected before/after fields/bytes needed for unresolved recovery. Accepted text is already retained in its revision/legacy archive.

Register both suffixes in campaign discovery, backup hashing, delete/restore and Phase 2 source policy. They cannot be generic writable mod tables. Strict readers distinguish absent, corrupt, unsupported and valid; do not use `readJson(...,{})` to convert corrupt journals into empty history.

Journal publication uses a dedicated durable writer: exclusive temp ownership, write/fsync/close, rename, and directory synchronization where supported. Fail before downstream writes if publication fails. Record/platform-test Windows behavior; do not advertise unconditional power-loss safety. Legacy archive/state sinks retain their file format but require verified writes and the prepared-step protocol below. Do not import Phase 2 migration implementation into gameplay to reuse its helper: share a small provider-free filesystem primitive outside that boundary if justified, preserving the migration fence.

Only safe generation status survives reload. Never persist cached assembled prompts, `precontext`, provider configurations or hidden reasoning merely to revive Retry. See J for the explicit reload fallback.

## I. Acceptance atomicity/recovery protocol

This is a write-ahead reconciliation protocol, **not a transaction across files**.

1. **Bind and flush.** Finalize/persist revision and selection; cancel/drain obsolete state saves; acquire the server campaign acceptance slot; verify expected head, selected revision and exact display acknowledgement. Capture the original frozen turn window, source player text and relevant legacy read versions. A second tab cannot overwrite these while the command is active.
2. **Persist intent.** Save original semantic command, candidate and reserved scene number/high-water mark. Once written, edit/swipe/discard cannot retarget the command. New acceptance is blocked until it settles or receives explicit repair disposition.
3. **Prepare each legacy step before application.** Store exact target data/field operations, before precondition, after value/hash, effect key and dependency/order. Include generated IDs, random outcomes and time-dependent values. Preparation operates on a private working view/callback adapter; no live write, debounced save or mod table publication may precede recording that step. Failed preparation with no published effects can be retried; a durable prepared step is never recomputed or rerolled.
4. **Apply/reconcile archive.** Store the exact formatted selected block, scene locator and original byte boundary before writing. Append once and verify bytes; index upsert, entity additions and chapter membership/count updates are separate prepared steps. Do not increment chapter counts again on retry. Correlate by persisted intent/revision/byte evidence, never user snippet alone. Add explicit revision/command binding to managed index metadata where useful; index presence is not the sole proof.
5. **Apply deterministic steps.** Publish recorded updates to their existing files with conditional preconditions. For each step, target at recorded before value means apply; at recorded after means it landed and only the receipt is missing; anything else is a conflict. Consecutive steps against one target retain their dependency chain. Use marker/version data in the same atomic target write where practical. Never replay an increment, RNG roll, engine invocation or whole old store snapshot to infer completion.
6. **Persist chat link.** Patch the exact assistant message ID with scene/revision/hash/command binding, preserving unrelated state. Verify persistence; do not stamp “last assistant.” Retire browse/pending markers only as part of that recorded update. Draft/acceptance record still retains siblings for inspection.
7. **Complete.** Verify every required step; atomically publish completed outcome and new head together in the acceptance file. If that publication fails, retries verify after-values and complete it; they do not repeat effects. Refresh UI from verified legacy state. Pending cleanup/acknowledgement is repeatable and does not change accepted content.
8. **Optional work.** Existing current-profile optional jobs may run behind the adapter, with exact revision/command identity and per-job completion/dispatch disposition. They do not determine acceptance truth. Recovery never regenerates optional inference. Persisted already-produced mutation results may finish conditional application; interrupted/unproduced optional inference remains visibly incomplete, with existing freshness fields unadvanced. No universal outbox or automatic catch-up backlog.

The legacy pipeline interleaves archive and optional/engine work. Keep normal-profile call ordering and engine inputs unless required for safety, but split the acceptance verdict from the optional-work/drain promise. A current-profile UI caller may retain its existing drain behavior before the next gather without allowing optional failure to undo an accepted outcome. Recovery uses deterministic replay of recorded writes only. Changes to incidental file/API ordering are intentional lifecycle artifacts requiring review; provider prompt/call changes are not automatically acceptable.

All cooperating writes to affected files must share the campaign serializer or reject while a prepared acceptance step owns the target. For managed campaigns, stale whole-state PUTs need exact content/write tokens; omitted/stale tokens cannot overwrite acceptance fields. Route ordinary debounce, immediate save, Exit, hydrator saves and action drains through the same checked save helper. Extend conditional checks to NPC/location/mod writes touched by prepared steps. This is a narrow legacy write guard, not a typed domain migration. Await/check HTTP errors, including 409/5xx; do not equate resolved fetch with success.

Recovery rules for specific discrepancies:

| Evidence | Detection / safe action |
| --- | --- |
| No durable intent | No acceptance effects are allowed. Restore the saved selected draft; new explicit/implicit acceptance prepares a command. |
| Intent; no archive bytes | Resume same command at its reserved scene allocation after revalidating recorded preconditions. |
| Exact archive block; missing index/chapter/entity steps | Finish only the missing prepared updates. Use upserts/membership checks or recorded after-values, not add-again logic. |
| Process dies partway through append | Compare only the recorded tail range/expected bytes and original prefix length. If a uniquely owned partial tail is proven, repair that tail to the prepared block under lock. If prefix/tail changed unexpectedly, retain bytes and report recovery required; never truncate unrelated prose. |
| Archive complete; state missing/stale | Relink exact message/revision using prepared patch and checked state version. Do not append. |
| State stamp exists; archive missing | If intent proves the planned archive operation and original version, finish it. If only a legacy stamp exists, block; a stamp cannot invent missing accepted evidence. |
| Effects applied; receipt/outcome missing | Compare after-values/target markers, record completion, return original outcome. No reroll/increment. |
| Completed outcome; ack lost | Return duplicate with original version/result even if UI/head/owner/epoch now differ. Ack/refresh only. |
| Conflicting bytes, duplicate legacy matches, unknown step state | Preserve artifacts; show typed conflict/repair details. No guessed canonical winner, automatic rollback or fresh generation. |

New sends and campaign actions must inspect typed acceptance results. Do not consume next-action armed state, clear the composer or capture the next gameplay snapshot until the previous candidate is safely accepted. Re-read turn inputs/context after the drain. On failure retain the user's composed action. Campaign navigation may leave a campaign with a durably saved unresolved command, but must neither clear it nor apply its callbacks to the next campaign; unsafe action execution remains blocked.

## J. Retry/Swipe/Continue semantics

| Operation | Phase 3 semantics |
| --- | --- |
| Retry failed generation | Explicit new model attempt in the same turn/set with retry-source lineage; no archive/acceptance retry. In-session cached-payload behavior remains. Failure/empty output never creates an acceptance candidate. |
| Retry acceptance | UI label `Retry saving` or `Recover acceptance`; resume/query exact saved logical key and revision. Zero generation/gather/model calls, both profiles. Never fall through to generation Retry. |
| Reload after failed generation | Show `interrupted/failed generation`, retained source input and partial display; it is noncanonical. If cached payload is absent, offer explicit `Regenerate response`, explaining context will be rebuilt. Do not display a dead cached Retry button or persist private prompts to make it work. Preserve lineage to the interrupted attempt; no automatic model call. |
| Swipe | Finalized siblings share set/turn/source input/expected head. Selection by revision ID; display order only controls navigation. Selected revision must be durably displayed before fast acceptance. In-flight unselected sibling may finish before acceptance but cannot replace the frozen candidate. |
| Accept selected swipe | Only selected finalized revision enters archive. Close set; siblings remain historical noncanonical drafts. Late completions cannot mutate accepted message or effects. No post-accept swipe controls; existing legacy committed-history regenerate remains a separate maintenance path. |
| Edit pending prose | Child revision/hash, same turn; invalidate parent-bound consumable metadata and active candidate. No archive PATCH. |
| Regenerate pending response | New attempt with regeneration source; preserve old revisions as discarded/noncanonical. Source player-message edits create a new source revision/set binding; old command cannot be retargeted. |
| Continue | Pending-only child revision containing merged prose, same turn/source player action/scene allocation. No separate accepted unit, counters, armed action consumption or new-turn RNG. Preserve current visible partial-on-abort policy as an explicitly marked child when nonempty; empty/metadata-only completion restores parent. Accepting either child or parent requires that exact revision to be selected. |

After an intent is persisted, lock edit/selection/Continue for that candidate until recovery resolves it. A new generation request cannot be used to escape an accepted-but-unacknowledged command.

## K. Deterministic-effect idempotency

Current effects are not a single replay-safe unit. Inventory the exact registered enabled tracks and their write sinks during Package A; the following source-backed groups must be handled.

| Group | Current stage / replay risk | Phase 3 handling |
| --- | --- | --- |
| Engine DCs, armed dice/loot/event consumption, intro DC/tool context changes | Before/during generation; `runTurn` can mutate state before a successful draft | Persist attempt provenance/results sufficiently to avoid rerunning them on acceptance recovery. Keep existing generation behavior; stage no new rerolls during commit. Generation-time rollback/domain semantics are deferred. |
| Chosen stakes, auto-profile, digest clear | Before archive or in prologue | Bound selected metadata and recorded patches; no repeated classification on recovery. |
| Archive/index/entities/chapters | Append, ID allocation, push/increment operations | Reserved number and exact block; membership/upsert/conditional recorded updates; structural sealing has its own step identity. |
| Pressure, auto-archive/restore | Parallel post-turn; accrual can repeat on failed archive | Prepare exact NPC patches/lifecycle changes once, apply conditionally once. |
| On-stage/location/movement | Sequential registry; some code writes store directly, creates locations and uses wall clock | Capture same inputs/IDs/time values and route direct writes through the scoped adapter; persist resulting location/context patches. |
| Agency, activity, goals/digest, repression | Random draws and once-per-turn accrual; some mixed model behavior | Record concrete resulting writes before publication. Split deterministic preparation from optional inference scheduling; recovery applies saved outputs, never reruns agency/repression against newer state. |
| Bookkeeping counter/reset and condensation | Client-side increments/reset/trim state | Persist intended resulting values in the relevant legacy state update; counter receipt cannot live only in module memory. |
| Travel halt safety valve | Post-commit track; currently halts, does not advance a journey/day | Preserve this behavior; once-only conditional patch. No accidental travel advance on acceptance retry. |
| Bundled compute Arc/etc. | Registered mod post-turn journal applies on clean sandbox return; not disk-transactional | Capture returned operations through the host facade/table adapter, record them before persistence, conditionally apply once. Preserve installed feature behavior. |
| Deferred current model results | NPC updates/validation, scans, chapter summaries/events, relationship work, server NLP | Preserve fresh-path policy/calls. Persist produced write batches or mark interrupted; duplicate acceptance must not dispatch again or apply twice. Optional output is not an acceptance prerequisite. |

Effect key is command logical key plus adapter step ID and occurrence, not a scene number or display index. Retain an ordered versioned step plan rather than a generic event-sourcing system. A “started” flag or a completion flag written after an arbitrary engine call is insufficient: crash between mutation and flag would double-apply. Use the before/after protocol and target-local receipt where possible.

Temporary working-state adapters must cover `callbacks`, facade writes, direct `useAppStore` calls in affected tracks, and compute table commits. Add explicit injection seams to those files where needed; do not monkey-patch the global store while concurrent UI/background work can run. Preserve current execution inputs and meaningful ordering. Jobs that escape this boundary cannot be claimed replay-safe; narrow containment or an explicit recovery conflict is required before closure.

## L. Restart/recovery behavior

Hydration must await lifecycle validation/reconciliation readiness before enabling new campaign mutations. Read-only campaign/history viewing remains available with a recovery status. Do not set playable-ready and start a background auto-commit race as App does today.

| Persisted state on restart | Required runtime/UI outcome |
| --- | --- |
| Saved ready draft, no intent | Restore selected/displayed revision and all variants for browsing. Do not turn opening a campaign into new acceptance. Next send/switch can still fast-accept that exact selection through the coordinator. |
| Streaming attempt, no finalized revision | Mark interrupted; retain partial prose as noncanonical display; show explicit generation action. No automatic acceptance. |
| Intent in progress | Reconcile exact stored candidate before new acceptance/generation. Never infer from current message/index. |
| Completed effects, missing outcome | Verify receipts/bytes, finish outcome; no model work. |
| Completed outcome, ack absent | Restore accepted message/link, mark acknowledged after UI persistence; duplicate requests return original outcome. |
| Selected swipe persisted, different volatile view lost | Restore persisted view and label any known unsaved local change; never accept a substitute for an existing intent. |
| Stale expected head/newer accepted scene | Keep text/lineage, typed conflict; no silent rebase or regeneration. |
| Ambiguous legacy pending/stamp or corrupt journal | Preserve data and block mutation for that campaign pending explicit repair. Do not sweep-append. |

Restoring pending browsing instead of unconditional startup acceptance is an intentional correction to the old recovery path, required to preserve exact revision selection and old swipe usability. It is not a general UI redesign.

## M. Existing-campaign compatibility

Perform a narrow, idempotent compatibility initialization after strict source loading and before old scene-stamp heuristics can alter managed pending messages. Preserve raw source evidence for diagnostics/repair. Do not run a whole-campaign canonical identity migration.

- Build an immutable compatibility source version from the initial captured pending-record bundle, including unique message/variant locators and source input. Bind it to a persisted random legacy campaign-instance token. Derive references deterministically from that complete scope with Phase 1 helpers; do not use array position, display name, mutable current text or `sceneId` as ongoing identity. The captured source hash is immutable provenance, not a changing identity key.
- Unique existing message and variant IDs supply locators. Missing variant IDs can receive a deterministic reference from a unique captured variant record fingerprint; identical/missing/duplicate locators that cannot be distinguished remain explicitly ambiguous. Preserve their bytes and variants; require explicit selection/repair rather than index-based invented identity.
- Validate `swipeActiveIndex`, visible message text and selected variant agreement. If uniquely reconcilable, preserve exact displayed text, including pre-upgrade edits, as a compatibility child revision. If disagreement is ambiguous, retain both versions and ask for an explicit candidate selection in the UI; do not silently accept either.
- Old pending plus no acceptance evidence becomes a ready draft, not an accepted turn. `commitFailed`/existing scene stamps require full archive user-and-assistant comparison and structural evidence, never normalized user prefix alone. Multiple matches, missing prose or newer dependent scenes produce recovery-required status.
- A legacy archive block can be unambiguously linked while legacy post-turn completion remains unknown. Do not rerun pressure/agency/mod effects to guess. Report the historical missing/unknown effect disposition separately; do not assert a complete Phase 3 receipt for an old operation that was never journaled. New managed commands must meet the stronger protocol.
- Ordinary accepted history without Phase 3 metadata stays unchanged. The old `rebuildSceneStamps` heuristic may remain for unrelated historical display compatibility but must not establish an acceptance receipt or override new exact bindings.
- Legacy failed-generation retry fields were never reliably saved. Infer no successful draft from an unstamped assistant alone; allow explicit regeneration using retained player input.

Upgrade writes only the new operational files and necessary pending-message references after the compatibility mapping is durable. If the final message patch fails, replay the mapping; do not derive different IDs from a second hydration.

## N. Phase 2 interaction

Current [source discovery](../../server/services/campaignMigration/snapshot.js) already preserves campaign-prefixed files, but [source policy](../../server/services/campaignMigration/sourcePolicy.js) blocks unknown criticality. Merely adding files therefore does not deliver usable import/recovery support.

Narrowly extend Phase 2's built-in suffix list/policy and independent verifier for drafts/acceptance files. Validate supported schema, campaign-instance binding, unique sets/revisions/commands, source-message links, selected/displayed pointers, revision hashes, expected-head/outcome references, numeric reservations and effect dependencies/status. Preserve unresolved acceptance explicitly; snapshot eligibility is not a gameplay acceptance-recovery certificate. Unknown schemas/corrupt or missing required managed metadata block rather than default empty.

Retain raw files/JSON-pointer inventory and operational original semantics; no canonical child adoption or typed fictional domain rows. Add fixtures with pending selection, completed outcome/unacknowledged acceptance and partial effect plans. Backup/restore must preserve the complete pair and all referenced source/asset data, and independently reverify after original files are unavailable. Do not automatically run gameplay recovery or a model during staging.

Use existing DB schema if generic staging can faithfully preserve these records/links. Only add a checksummed staging migration if source-backed verification demonstrates it is necessary; do not introduce live campaign tables. Keep gameplay imports fenced from `server/db`, `migrationStagingRepository` and campaignMigration implementation.

Legacy playable backup/restore must include both files through registered suffixes and serialize with acceptance. Restoring an older backup deliberately replaces its lifecycle state too; rotate a restore/currentness token so stale pre-restore clients cannot submit old unseen commands. Historical outcomes still recover by their original logical key when present; missing pre-restore outcomes cannot authorize reapplication under a new namespace. Unresolved restores fail closed.

Playable version-1 transfer currently explicitly constructs bundle fields and reserializes archive prose; registering suffixes alone does not preserve lifecycle data. Add an explicit lifecycle-aware bundle version for managed campaigns, keeping old v1 imports supported. Remap the new storage-instance scope through an import mapping, preserve original provenance/outcomes, and never execute an imported in-flight command automatically. If a safely rebindable unresolved command is impossible, reject that import before writes with an export/recovery explanation. Do not silently emit v1 and lose managed drafts/outcomes. Do not use this work to repair unrelated divergence/overworld omissions.

## O. Phase 0/1L eval interaction

Keep the v0 schema, pinned files, known-violation disposition and provider request projection. Add a separate `phase-3-acceptance-v1` lifecycle/persistence artifact/suite with references, command statuses, file-step order, versions, fault boundaries and repair decisions. Normalize new random references with a distinct result-local alias map; do not consume game RNG or leak paths/timestamps/prose into reports.

Extend replay IO to understand lifecycle endpoints and inject lost acknowledgements, but use native filesystem tests for durability. The old synthetic campaign API cannot certify real multi-file persistence. The base-app recorder should observe the real coordinator through a storage adapter, not bypass it with a fake “accepted” result.

Compare actual Story wire messages, selected recall, model purposes/attempts and meaningful engine effects. New lifecycle API/file writes and operational fields are expected separate differences. Keep old projections stable where they still accurately describe behavior; never hide altered prompts/calls, remove failed assertions or repin v0 to absorb new internals. Where an old assertion encodes the unsafe startup/heuristic behavior, add a named corrected Phase 3 invariant and document the intentional change rather than weaken the baseline silently.

Constrained normal path remains one required Story invocation/attempt through acceptance and quiescence; acceptance recovery makes zero model invocations, even with missing stakes or configured utility endpoints. Explicit generation Retry/Swipe/Continue remain manual separate operations. No automatic catch-up inference after recovery/profile change. Preserve escaped historical-evidence handling for saved drafts/accepted history; operational metadata never becomes active instructions.

Keep the two reviewed visibility violations and documented context/output-cap/movement/quality limitations visible. Phase 3 does not fix or expand their disposition. No live LLM run is required merely to validate file recovery; use the roadmap's milestone smoke policy and run a bounded smoke only if a justified runtime behavior change needs it, with the existing model/window/profile unchanged.

## P. Extension/security boundaries

The host facade exposes messages read-only plus `addMessage`/context/NPC/table writes; mod model calls can generate arbitrary text. There is no dedicated public acceptance method. Current host menu/Arc drains invoke the same pending-commit entry. Native/external code has documented dynamic escape hatches that static analysis cannot eliminate.

Keep coordinator capabilities host-owned. A caller-supplied origin, `pendingCommit`, `sceneId`, revision field or “manual” property is never authorization. Reject extension-added messages that spoof host-owned acceptance fields; a system/auxiliary message may still be added through existing behavior but cannot become accepted Story by setting flags. Server reloads and validates stored candidate, campaign scope, hash/head/selection and command semantics; it does not trust a UI payload's claim to be canonical.

Scope accepted post-turn write adapters to the active command and revoke them on completion/fault. Sandbox journal/table results are captured before application. The server owns the allowlist of target files and operation shapes; callers cannot submit arbitrary paths or journal steps for execution. Protect host-owned revision/acceptance fields on ordinary message/state PUTs as well as archive routes. Existing bundled Arc/manual authorization remains functional in both profiles. Do not add new public interceptors, leases, native injection or arbitrary truth tables. Register only exact required host forwarding changes in the extension freeze; do not refreeze the entire tree.

The supported guarantee covers host routes/facades/sandboxed writes and cooperating processes, not arbitrary hostile native code or external disk editors. Detect unexplained persisted changes and fail closed. A general extension security overhaul remains Phase 10.

## Q. Static-gate/writer-inventory changes

Update `writer-inventory.json`, regenerate its Markdown projection, and update exact producer/sink/competition signatures for draft transitions, acceptance intent/outcome, checked state saves, archive adapter and effect publication. Mark all gameplay ownership as legacy/transitional; draft coordination is not a target domain ownership grant. Existing domain retirement phases remain 4B2/5/7/10 as appropriate, with Phase 3 redirection noted separately.

Add focused AST/static negative tests:

- Only the acceptance adapter may invoke managed Story archive append; `retryFailedCommits` cannot remain a direct append bypass.
- Only lifecycle transition modules may create/change managed selection/pending/acceptance fields; UI hooks may request transitions, not patch authoritative markers.
- Prepared deterministic effects cannot publish through raw store/file/table sinks outside their adapter.
- Managed state PUTs require checked version/token handling; missing-command legacy archive POST cannot append to an enrolled campaign. Legacy API compatibility must adapt to a validated stored candidate or reject, never create a second acceptance path.
- Gameplay cannot import migration DB/staging capabilities; acceptance/recovery cannot dispatch a model.

Allow explicitly inventoried generation streaming writes and legacy accepted-history maintenance behind narrow guards. Test aliases/recognized indirections supported by the current scanner and retain its opaque-code limitation. Do not claim AST tests prove arbitrary data flow.

## R. Fault-injection strategy

Use synthetic `DATA_DIR` roots and the real file services/routes. Child processes should signal the exact boundary, be killed, then reopen with a fresh process/module/store; ordinary mocked rejected promises are insufficient.

| Injection boundary | Required restart proof |
| --- | --- |
| Revision or selection saved; before intent publication | Restored exact pending view; zero archive/effect writes |
| During intent temp write/fsync/rename | Old/new complete intent or explicit corrupt/temp recovery state; no unrecorded effect |
| Intent published; before archive preparation/application | Same command/candidate/reservation resumes |
| Partial archive append; after full append before receipt | Repair only proven owned tail or fail closed; never a duplicate scene |
| After index; after entity write; after chapter write | Complete missing prepared steps; exact membership/counts once |
| Before/after each deterministic target write; before receipt | Before/after detection; each pressure/activity/repression/counter/table change once |
| Optional job dispatched/result produced; process dies | No recovery-time inference; recorded results applied at most once or visibly incomplete |
| Before state stamp; state written before receipt | Exact message link repaired once; no append; unrelated newer data retained/conflicted |
| All effects complete; before outcome; outcome before network response | Original command yields one outcome/head/scene on duplicate |
| Response received; before local/UI acknowledgement | Accepted state restored; ack is idempotent |
| Death during recovery before cleanup | Recovery itself is idempotent across another restart |
| Concurrent stale state/debounce/edit/campaign switch | No wrong-campaign patch, overwritten receipt or silent candidate switch |
| Missing/corrupt files, disk full/permission failure, unexpected tail, duplicate old inputs | Explicit retained conflict; no false acknowledgement or destructive guessed repair |

Test rename/fsync failures as well as process interruption. Power-loss durability is limited by platform/filesystem behavior; report what was actually established. Reuse the server's existing data-directory lease to exclude a second cooperating server; do not add distributed lock topology or automatically steal abandoned leases.

## S. Test/evaluation strategy

Pre-change evidence collected in this planning pass:

| Check | Observed result |
| --- | --- |
| Nine focused files: commit single-flight, durable commit, swipe generation, smart Retry snapshot/stamp, Continue, Retry hook, manual visible Story, base-app gate | 108 tests passed |
| Five focused files: archive append/atomic write/surgical delete/rollback cleanup and orphan swipe-state cleanup | 39 tests passed |
| `npm.cmd run eval` | Five MATCH; v0 VALID; same two KNOWN_TARGET_VIOLATION results |
| `npm.cmd run eval:determinism -- --suite phase-1l-constrained-v1` | Seven BYTE_STABLE PASS and MATCH; normative constrained checks pass; launcher reports UNPINNED |

These are pre-change checks, not Phase 3 acceptance or a full-suite run. No real campaigns/providers were used. The complete roadmap trace capture remains Package A's first gate.

Implementation test layers:

1. Pure engine contracts/state machine: immutable revisions, canonical serialization/hash vectors, compatibility uniqueness, lineage, stale selection/head, terminal states and invalid transitions; compiler negative checks for missing provenance/owner/epoch/precondition/replay identity.
2. Frontend runtime/hooks: normal send, two swipes, edit, pending regenerate, user-input edit, Continue/abort, generation failure/Retry, campaign switch/Exit, Arc/menu drains, display/selection mismatch, stale result/campaign/profile transition. No next-turn armed-state consumption on failed acceptance.
3. Native file/service tests: all four crash states, duplicate/reused-key semantics, separate-tab concurrency, torn append, structural partials, deterministic effect batches, checked saves and repair conflicts. Assert exact bytes and counts after fresh-process reopen.
4. Lifecycle preservation: old campaign fixtures with variants, repeated inputs, missing IDs/stamps, buried failed commits, legacy maintenance, old backup restore and lifecycle-aware transfer. No rewriting accepted prose on initialization.
5. Phase 2 extension: actual snapshot/import/independent verify/backup/isolated restore of the new files and links; unknown/missing/corrupt data fails closed; zero gameplay SQLite opens.
6. Evaluations: existing current/constrained suites plus Phase 3 scenarios for duplicate acceptance, commit-before-ack, stale head/selection, edit invalidation, Retry lineage versus save recovery, Continue, reload selected swipe, partial effect failure and death during recovery. Assert no model calls during acceptance recovery with deliberately populated provider settings.

Final internal validation commands should use `npm.cmd`/`npx.cmd` on this Windows setup: focused tests, `npm.cmd run test:run -- --maxWorkers=4`, engine tests/purity and `typecheck:contracts`, architecture/inference/migration gates, base-app gate, current and constrained determinism, new Phase 3 eval, `eval:phase2`, build, changed-file lint and `git diff --check`. Report existing full-lint debt separately; do not bulk-fix it. Regenerate/check writer projection. Attempt the AGENTS-required `node scripts/patch-graph-imports.mjs` after import/config changes and record the known missing-script limitation if still absent; do not rebuild graph tooling as Phase 3 work.

## T. UX/conflict behavior

Keep the existing composer, lazy swipe sheet, inline editor, Continue, Stop and Retry controls. Add a small lifecycle status/action area only where necessary:

| Status | User-visible behavior |
| --- | --- |
| Ready draft | Existing browse/edit controls; next action fast-accepts exact candidate |
| Saving / recovering acceptance | Selection/edit frozen for that candidate; show saving/recovery action, never Story Retry |
| Accepted; acknowledgement pending | Show accepted outcome/scene; recover confirmation without generating text |
| Generation failed/interrupted | Existing in-session Retry or explicit regenerate-after-reload action; partial text retained as noncanonical |
| Stale candidate/head/selection | Explain that campaign changed; retain prose and sibling drafts; reload/review action. No automatic rebase or acceptance. |
| Partial legacy conflict | Read-only history plus retained draft and specific failed boundary; explicit recovery/diagnostics. Do not promise “story saved” unless draft persistence was verified. |

Successful next-send behavior stays the same. Failure behavior intentionally improves: hold the user's composed next action and armed inputs instead of generating against unresolved prior acceptance. Closing/switching must await a durable pending/recovery disposition; reopening never silently selects or generates a different revision.

## U. Performance/operational considerations

No write per streaming token. Persist attempt start/status, finalized revision, selection/edit transition, intent, prepared effect batches, completion and acknowledgement at meaningful boundaries; coalesce steps that share one target without crossing a required recovery boundary. Do not promise a fixed number of writes before the effect inventory is complete.

Measure additional writes/bytes, fsync+rename time, draft and completed-receipt size, normal acceptance p50/p95, and restart reconciliation cost on empty/small/250-scene fixtures plus a populated pending set. Keep wall-clock performance evidence outside deterministic artifacts. Compare against a pre-change sample from the same machine; explain any material overhead rather than inventing a universal latency limit.

Head/outcome lookup should use the loaded operational file and affected sources, not rescan/hash the entire campaign every acceptance. Strict startup/repair may scan archive bytes to establish a legacy anchor. Existing max-scene scans and whole-file state saves remain measured legacy debt. Initial JSON lifecycle files also grow with retained records; disclose their rewrite cost and avoid duplicating all historical prose in each receipt. Phase 4 native indexed authority is the next scaling boundary.

Diagnostics expose codes, references, source versions and effect statuses; keep provider secrets, hidden reasoning, private file roots and live prose out of shareable eval reports. Raw drafts and repair payloads are private campaign data and belong in the same protected backup/source scope.

## V. Implementation packages

Three broad packages in one implementation pass. Package gates are internal continuation gates; they do not require conversational approval or separate independent reviews.

### Package A — explicit revisions, transitions and compatibility persistence

**Files/systems:** new shared pure draft contracts/hash serialization; `src/services/turn/drafts/`; `types/campaign.ts`; `turnContext.ts`, `turnStages.ts`, `swipeGeneration.ts`, `sceneContinue.ts`; pending snapshot adapters; chat slice and Swipe/Retry/Continue/editor/rename hooks; campaign store/hydrator; new server legacy lifecycle repository/routes; suffix registrations; initial Phase 2 preservation policy.

**Implementation:** first capture all required before-state flows. Add IDs without consuming gameplay RNG; seal immutable revisions; persist selected/displayed references and safe attempt status; convert all pending content edits into transitions; implement deterministic compatibility initialization and explicit ambiguity states. Retain accepted-history behavior through existing maintenance paths. Add required checked HTTP/save handling at the touched persistence seam. Keep new contracts adapter-oriented rather than designing Phase 4 tables.

**Tests:** pure identity/hash/state machine/compiler tests; old variants roundtrip; missing/duplicate-ID ambiguity; reload selected view; metadata invalidation; Retry versus Continue lineage; manual visible-prose regressions; the existing 108-test lifecycle/base-app set; native draft save failure tests.

**Internal continuation gate:** complete required trace set captured; old pending fixtures load/select/edit without variant loss; every finalized revision ID/hash stable; no accepted-history rewrite, prompt change or extra model call; current/constrained eval comparisons understood and new fields isolated. Continue to B automatically once green.

### Package B — one legacy acceptance coordinator and recoverable effect boundary

**Files/systems:** `src/services/turn/acceptance/`; server acceptance service/journal and checked legacy write adapter; `pendingCommit.ts`, `postTurnPipeline.ts`, relevant track callbacks/direct-store seams, sandbox/table commit adapter; archive service/repository/routes; state/NPC/location/table write routes; `useChatOperations`, campaign switch, Header, Arc and host action drains; archive maintenance guards; backup/restore and lifecycle-aware transfer.

**Implementation:** exact-candidate command, original semantic request, historical replay-first routing, head/selection CAS, campaign-scoped single-flight, intent/effect/outcome/ack protocol, reserved numeric scene IDs, exact archive recovery, recorded deterministic updates and checked message linking. Replace snippet-based managed relink and direct buried append. Prevent stale debounced saves and next-turn consumption after failure. Keep optional current work behind the adapter with separate nonfatal dispatch/results; acceptance recovery never invokes a model. Route existing legacy maintenance through busy/head invalidation without implementing Phase 7 semantics.

**Tests:** normal accept; same/different concurrent keys; changed-semantics reuse; replay after restart/owner+epoch change; head/selection conflicts and ABA; lost response after archive/state/outcome; every required deterministic effect group; optional inference failure; both profiles; generation Retry cannot replace acceptance recovery; Continue one-turn semantics; exact-message/campaign guards; backup/restore/transfer closure.

**Internal continuation gate:** native persistence tests prove intent-before-write and before/after reconciliation for every touched deterministic sink; duplicate acceptance applies zero new effects; recovery makes zero model calls; unsupported/ambiguous states are retained and typed; no live SQLite authority. Continue to C automatically.

### Package C — fault proof, eval/static closure and review handoff

**Files/systems:** child-process/fault fixtures and native server tests; new Phase 3 eval fixtures/artifacts/runner projection; base-app recorder/replay IO; architecture/static negative tests and writer inventory; Phase 2 independent verifier/restore fixtures; operational recovery guide and Phase 3 status report.

**Implementation:** complete R's kill/restart matrix, including death while recovering; expand existing-campaign/maintenance/transfer coverage; classify every writer and bypass; verify migration captures the new state; measure write/fsync/reload overhead; document exact supported repair states, intentional behavior changes and limitations. Produce one reviewable final diff/report against this plan.

**Tests:** all layers in S; real isolated restore with source unavailable; full app/engine and architecture gates; both existing determinism suites plus new acceptance eval; no hidden known-violation changes; focused host/mod bypass negatives; build and changed-file lint.

**Internal continuation gate:** every A matrix row/Z criterion has concrete evidence, all required gates green or exact pre-existing debt documented, no unresolved correctness blocker. Then request **one final Sol High independent review** for the complete Phase 3 diff; perform only narrow blocker remediation and affected-scope recheck if required. Merge/tag only after that review and the implementation session's authorization. No per-package review cycle or baseline pinning shortcut.

## W. Stop conditions

Stop implementation for an actual architectural conflict, not an ordinary failing test:

- Roadmap evidence requires a live authority move before 4B2 or contradicts this legacy protocol.
- Exact legacy archive/state evidence is ambiguous and cannot be preserved with a typed recovery-required state without guessing/loss.
- A required deterministic writer cannot be captured/reconciled through a narrow host seam and would force a Phase 5 domain rewrite or general Phase 10 extension redesign.
- Canonical command IDs would require inventing an unproven campaign adoption mapping rather than using the explicit compatibility adapter.
- Compatibility would discard old variants, silently accept a stale draft or rewrite accepted history.
- Phase 0/1L prompt, trust or model-call regressions cannot be corrected inside Phase 3 scope.

Campaign-specific corrupt data may block that campaign while implementation/testing continues on preserved synthetic fixtures. A disk error, missing script or repairable test failure is not by itself a reason to abandon the entire phase.

## X. Deferred/later-phase work

Phase 4: live SQLite schemas/adoption/authority control, transactional narrative plus critical tracked state, canonical commit/entity mappings, indexed live repositories and first-write latch. Phase 5: typed NPC/process/module state and complete frontend authority migration. Phase 6: epistemic/knownBy redesign. Phase 7: superseding committed revisions, known-impact corrections and linear rewind. Phase 8: retrieval replacement. Phase 9: output-first packing, provider/profile tuning and final local-policy performance thresholds. Phase 10: extension surface closure. Phase 11: broad retirement/scale hardening.

Also defer Story proposal trailers, persistent branches, generic event sourcing/command bus/job outbox, generation-time world-state redesign, background catch-up inference, unrelated transfer omissions, graph-tool reconstruction, broad lint cleanup and changes to reviewed visibility/quality dispositions.

## Y. Risks

| Risk | Mitigation / residual limit |
| --- | --- |
| Direct store and mod writes escape the journal | Scope callback/table/direct-write adapters and static negatives; real sink faults; opaque native code remains explicitly unsupported as a universal proof |
| A stale whole-state save erases acceptance | Checked tokens and serialization at all managed save entry points; test delayed debounce/Exit/hydrator writes |
| Same prose/input appears multiple times | Immutable revision/command identity; never rely on prose or numeric scene identity; old ambiguous data blocks |
| Current optional model work changes effects/timing | Preserve fresh-path policy and call evidence; separate acceptance result, drain and produced writes; no recovery-time generation |
| Multi-file partial state is observable | Explicit pending/recovery status and mutation gates; no transaction claim; Phase 4 replaces the boundary |
| New JSON journals grow | Avoid redundant payload copies; measure size/latency and disclose O(N) legacy costs; retain replay tombstones |
| Draft hash accidentally changes Story | Exact stored-string hash after current processing; cross-runtime vectors and actual-wire comparisons |
| Compatibility metadata is mistaken for canonical adoption | Distinct reference types/guards and explicit import mapping later |
| Restore/delete reuses old locators or commands | Persistent reservations/currentness generations, restore token rotation, historical replay-before-current-check ordering |
| Partial append repair damages user data | Verify owned tail and original prefix; conflict on unexplained changes; no broad truncation or guessed rollback |
| Tests pass with mocks but recovery fails on disk | Fresh-process native-file kill/restore tests are required acceptance evidence |

## Z. Concrete acceptance criteria

Phase 3 closes only when all of the following hold:

1. Every finalized initial/swipe/edit/Retry/regenerated/Continue/compatibility draft has a persisted immutable revision reference and exact versioned content hash; equal text can have distinct revisions.
2. Source player input, attempt/lineage, selected/displayed revision and expected head are explicit and survive restart; array order cannot change identity.
3. Edit/selection invalidates the previous active metadata/candidate binding; only a finalized exact displayed selection is eligible.
4. Every host acceptance trigger enters one coordinator; same logical key is single-flight and durably replay-safe across processes/restarts; changed semantics rejects.
5. An unseen stale-head or stale-selection command performs zero acceptance archive/effect writes and never rebases itself.
6. Only the frozen candidate is archived/retrieved; unselected revisions remain noncanonical, including late generation results.
7. The four roadmap crash states and partial archive/index/entities/chapters/chat/effect windows are distinguished and reconciled by exact evidence, or retained with a typed recovery conflict.
8. Commit-before-ack returns the original revision/hash/head/scene outcome; it never appends again, rerolls, repeats deterministic increments or invokes a model.
9. Acceptance recovery and explicit generation Retry are separate operations and labels. Failed/empty/metadata-only generation is never accepted.
10. Deterministic effects in K have prepared results and per-sink recovery proof. A journal “started/done” flag without target evidence is insufficient.
11. Optional current-profile inference failure cannot make accepted prose ambiguous; constrained normal play remains one Story attempt and recovery zero calls.
12. Old pending swipe sets load/select/edit/accept without losing variants; ambiguous/stale upgrades fail closed; already accepted history is not rewritten by migration.
13. Pending draft reload restores browsing; saved acceptance intent resumes only its original candidate; interrupted generation is visibly noncanonical.
14. Managed save/API/mod paths cannot spoof or bypass acceptance, and delayed saves cannot erase it. Cross-campaign callbacks are rejected.
15. New files are preserved/independently verified by Phase 2 snapshot/import/backup/isolated restore and by lifecycle-aware playable backup/transfer; omissions fail closed.
16. All required before/after traces, focused/native/full tests, static gates and existing/new eval artifacts are present. Prompt/call deltas are absent or narrowly explained as approved corrected invariants; no repin hides representation changes.
17. Operations document recovery limitations and performance results without claiming cross-file atomicity, full reconciliation or universal native-extension containment.
18. One final independent Sol High review passes, with only blocker-focused remediation if needed, before acceptance/merge/tag.

## AA. Recommendation

**Phase 3 is ready for implementation in one pass across Packages A–C.** The inspected roadmap does not require an early SQLite authority move, and the current source supplies viable archive, store, track and host-facade seams. The difficult work is the legacy effect/write boundary and its fault proof, not additional model inference.

Use the explicit compatibility-command branch for current campaigns; do not make canonical adoption an accidental prerequisite. Begin implementation with the required before-state trace capture, then continue through the internal gates without conversational approvals between packages. This planning pass changes documentation only and does not authorize or begin runtime implementation, independent review, merge or tagging.
