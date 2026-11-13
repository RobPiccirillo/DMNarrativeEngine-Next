# Phase 1L — Constrained Local implementation plan

Status: planning complete; implementation has not begun.

Inspected source: main at 7446e177325bd9c7268c2292190d49345e4a1914. The working tree was clean at inspection. This document is the only change made by this planning pass. No live inference, baseline recording, production edits, dependency installation, or campaign changes were performed.

## Decision and execution contract

Implement Phase 1L in three work packages below. Continue automatically between packages when their internal gates pass. Do not seek approval for individual switches, files, tests, or checkpoints. After all packages, request one independent review of the entire phase, then make narrow remediation if needed. This plan does not authorize a merge, baseline repinning, production-default change, or later-phase implementation.

The recommended profile has exactly one streaming Story invocation and one provider attempt on a successful normal turn, zero automatic auxiliary LLM invocations before Story, zero model calls during acceptance, and zero automatically scheduled background LLM invocations. Preserve deterministic simulation, archival writes, manual editing, existing manual utilities, and the current/full profile.

Phase 1L also includes the historical-evidence adapter required by roadmap 003. Call reduction alone would leave the phase incomplete.

## Sources and interpretation

Read [the system map](../../AI_CODEBASE_MAP.md), [architecture 002](../architecture/002-target-architecture.md), [roadmap 003](../architecture/003-implementation-roadmap.md), [Phase 0 harness documentation](../eval/phase-0.md), [Phase 0 status](../eval/phase-0-status.md), [Phase 1 status](../eval/phase-1-status.md), and both [the inventory source](../architecture/inference-inventory.json) and [its generated report](../architecture/inference-inventory.md).

The current inventory describes 46 families, 102 recognizable frontend sites, and 14 provider/server sites. It is descriptive development metadata, not a runtime policy or proof of reachability. Reuse it and the existing ledger; do not load the documentation JSON into production or introduce another inventory/telemetry framework.

The relevant contracts are packages/engine/src/contracts/inference.ts and the provider-attempt contracts under the same contracts directory. Existing development observation and diagnostic projection live in src/eval/__tests__/support/observe.ts, inferenceClassification.ts, baselineLocalPolicy.ts, and the frontend/server providerObservation modules.

Architecture 002 sections 21 and 24.3 and roadmap Phase 1L establish the numeric call ceiling. The Phase 0 Director snapshot is behavioral, not an obligation to keep Director in the constrained profile. Current runtime source takes precedence over stale comments and historical handoff wording.

## A. Current inference-cost model

### A1. Lifecycle and exact dependency graph

Generation and archival acceptance are separate operations. The finished Story is pending until the next send, explicit commit-related action, campaign switch, or launch reconciliation. Consequently, model work classified as delaying commit can also delay the next visible Story.

The production path is:

~~~text
send
  await commitPendingTurn(previous pending Story), if any                  [A3]
  runTurn(current TurnState)
    buildHostFacade + TurnContext
    emit turn.start                                       [extension boundary]
    resolveEngineRolls / addUserTurnMessage                 [no LLM]
    await gatherContext
      start in parallel:
        archive planner                                    [P: 0..1]
        semantic candidates:
          optional query expansion                         [Q: 0..1]
          await archive/lore/rules semantic HTTP searches   [embedding boundary]
          optional archive and lore model rerank           [R: 0 canonical;
                                                            0..2 legacy helper]
        relationship stances                               [D: per deep NPC]
        context recommender                                [C: 0..1]
        dynamic elevation: scoped semantic HTTP + scenes    [embedding boundary]
      archive recall waits for planner + semantic candidates:
        serviceRoles.ask("memory.recall")
          default core: flat lexical recall OR
            chapter ranking -> iterative model filter      [F: 0..5]
          a role override may substitute behavior          [extension boundary]
        fetch selected scene text
      lore/rules selection waits for semantic candidates    [no additional LLM]
      await all above; slotted snippets are deterministic
      inject pinned chapters                               [no LLM]
      optional explicitly armed deep search                [manual multi-call]
      semantic-fact selection                              [no LLM]
    optional intro-engine location resolution              [I: 0..1]
    deterministic travel facts + Director watchdog
    optional Director brief                                [B: 0..1]
    await registered prompt interceptors                   [extension boundary]
    fact publishers                                        [extension boundary]
    buildPayload / buildHistory
    sendMessage(Story)                                     [S: 1 initially]
      tool result -> another sendMessage, up to 5 tools      [additional Story calls]
      failure -> 2s retry -> 4s retry without tools          [additional calls]
    strip same-response scene-stakes tag
    stamp swipe/pending state, cache payload, persist pending Story
    emit turn.generated                                    [extension boundary]
~~~

Implementation sources: [turnOrchestrator.ts](../../src/services/turn/turnOrchestrator.ts), [turnStages.ts](../../src/services/turn/turnStages.ts), [contextGatherer.ts](../../src/services/turn/contextGatherer.ts), [context-gatherer](../../src/services/context-gatherer), [pendingCommit.ts](../../src/services/turn/pendingCommit.ts).

The outer gather timeout is not a reliable early-return mechanism: gatherContext races a timer and then individually awaits the original promises. The chapter-funnel timeout returns fallback IDs without canceling the losing funnel. Dynamic elevation similarly races a timeout without establishing cancellation of the provider-side work. Do not count these timeouts as endpoint release.

### A2. Foreground families

All counts below are per generation operation unless stated otherwise. A configured/usable endpoint and the listed data prerequisites are necessary to produce an actual provider request. A facade role can appear available because a getter exists even when it resolves undefined; failed facade resolution itself is not an observed llmCall/provider execution.

Retry code U means the common nonstreaming llmCall transport: up to four HTTP attempts for 429/503/529, queue reacquisition on each attempt, Retry-After/default delay, no transport/JSON retry except where a caller separately repeats a request. A caller-level repeat creates another observed logical invocation; do not relabel it as a child attempt.

| Family; purpose; endpoint role | Trigger, frequency, direct wait | Correctness, existing fallback, stale/deferred suitability | Current retries |
| --- | --- | --- | --- |
| story-generation; narrative; Story | Every submitted playable turn; initially one; foreground, delays visible Story | Only required inference. Must produce actual nonempty visible prose before successful completion/commit; old prose cannot substitute. | sendMessage has no transport retry internally; turnStages launches up to two extra sendMessage invocations. Tool continuation can also add invocations. |
| director-brief; planning/audit; auxiliary, falling back to Story | Pro/Max; after gather/intro, before payload; absent under Absolute Command; cached by campaign + exact input; 0..1 | Adds mandatory/suggested writer directions from watchdog dossier, previous Story, NPCs, timeline and world facts. Returns null on error; deterministic watchdog/world facts still function. Turn-specific brief must not be reused as current guidance after suppression. | U; no extra parse-repair request. Success and ordinary parse-null cached; abort/timeout/thrown errors uncached. |
| archive-planner; scene selection; utility | Pro/Max + enableArchivePlanner + usable utility + event-bearing index; 0..1, blocks recall/Story | Ranks up to five scene IDs. Empty/failed result already falls back to deterministic retrieval. Selection is optional; accepted archive is not. Use current deterministic selection, not stale planner IDs. | U; error/parse -> []. |
| context-recommender; NPC/profile/inventory selection; utility | Pro/Max, usable utility, something selectable; 0..1, blocks Story | Returns NPC names and bookkeeping filters. NPC lexical fallback exists; smart bookkeeping detail fallback is insufficient without a narrow repair (E). Not required to archive. Do not cache old filters as current decisions. | U; caller catches failure; no parse-repair loop. |
| query-expansion; alternate recall queries; utility | Max, query under 8 words or callback phrase, retrievable content, utility; 0..1, before semantic search | Returns original plus two paraphrases. Existing fallback is original query. No canonical state depends on expansion. | U; errors/invalid array -> original query. |
| semantic-rerank; candidate ordering; utility | Helper supports separate archive/lore calls at >=5 candidates, Max; 0..2 in direct legacy use | Existing candidate order is fallback. Canonical facade path sets utilityEndpoint undefined but later requires utilityEndpoint.endpoint, so current runTurn makes zero rerank calls. Preserve this fact; do not repair/activate it in Phase 1L. | U per invocation; original IDs on failure. |
| archive-funnel; chapter relevance; utility | Pro/Max, sealed chapters with summaries; default memory.recall provider; iterative, up to five validations until three accepted chapters | Deterministic chapter ranking/top-three or flat retrieval exist. No utility in legacy path gives deterministic selection; facade callback is supplied even if endpoint resolution later fails. Timeout fallback does not cancel already-started funnel. No stale result required. | Facade uses U; direct legacy relevance HTTP has one attempt per chapter. Up to five validations are separate calls, not transport retries. |
| npc-stance; scene-specific interpretation; utility | relationshipMemory enabled, npcStance not explicitly false, on-stage NPCs, deep selection; scene-key cached | Base records/status/boundaries are deterministic. Deep output adds wants/hiding/manner/etc. Prompt consumer exists as well as UI consumer. Can omit deep interpretation while retaining base memory; must not claim a stale deep result is newly evaluated. | U on facade; failed deep result falls back to base, no scene-local retry loop. |
| character-intro; infer current place for location-bound intro; auxiliary | Max + npcIntroEngineActive + config + successful intro roll + eligible location candidates; 0..1 | Optional intro tag and DC update. Without provider the helper excludes location candidates and can still choose wandering candidates. Whole intro automation may be paused by profile; no archive dependency. | U, unlabelled helper call classified by existing dev scope. Error -> empty inferred location. |
| deep-search-chapters/scenes/summarize/merge; historical research; utility | Only deepSearchThisTurn + Pro/Max + usable utility + sealed chapters; blocks Story if armed | Explicit exception, not automatic normal work. deepArchiveSearch performs chapter/scene passes, optional second round, and budget-dependent summarization/partition merging; count depends on selected text, not a fixed one-call job. Standard recall is fallback. | U per helper invocation; no normal-turn entitlement to these calls. |

Stance cardinality needs special care. RELATIONSHIP_STANCE_DEEP_BUDGET is Lite 0 / Pro 2 / Max 3, but selectTiers forces every edge containing carried memory into deep regardless of budget. Thus D is not bounded by those numbers: D can reach the number of eligible on-stage NPCs, including on Lite, if a utility endpoint is present. Preserve carried memory deterministically while denying its model promotion.

The GatheredContext comment saying stances are UI-only is stale: turnStages passes relationshipStances to buildPayload; contributions/builtins.ts renders NPC Stances and suppresses On-Stage Relations when that contribution is admitted.

### A3. Commit and post-commit graph

~~~text
commitPendingTurn
  choose visible/edited variant and original frozen input/message window
  if stakes tag missing: optional utility scene-stakes classifier            [K]
  write lastSceneStakes
  runPostTurnPipeline
    deterministic prologue: auto-enable/seed profile, clear consumed digests
    await Promise.allSettled:
      archive track:
        optional Story importance rating                                  [W]
        appendScene -> durable prose/index + heuristics + chapter membership
          fire-and-forget native embedding                                 [boundary]
          emit archive:written -> deferred NLP only if utilityConfig supplied
        stamp scene ID; refresh index/timeline/chapters
        advance bookkeeping counter (default interval 5)
        start post-commit tracks without awaiting their completion          [A4]
      NPC track:
        deterministic name extraction
        optional Story name validation                                    [V]
        add suggestions; optionally enqueue updates/drives                  [A4]
      deterministic pressure track
      registered compute tracks                                           [extension boundary]
    await sequential tracks:
      NPC activity/heartbeat/timeskip simulation (optional narration queued)
      movement/header location resolution
      on-stage detection
      repression/reaction bookkeeping
  deterministic auto-condense index calculation; no summary LLM here
  retire pending markers ONLY after archive success; persist
~~~

| Family; role | Automatic frequency / wait | Output and fallback; effect of removal | Current retries |
| --- | --- | --- | --- |
| scene-stakes-classify; utility | Pro/Max, only chosen variant lacks valid tag; 0..1; foreground blocks commit and possibly next send | lastSceneStakes feeds agency/timeskip behavior. Existing extracted default is calm. Keep same-response tag; absent/garbled uses calm, with operational indication that auxiliary evaluation was not performed. Never reuse previous turn's stakes. | U; malformed/error -> calm. |
| importance-rating; Story | Max; 0..1 before new archive append; blocks commit | Index importance influences recall/LOD. Omitted client score already uses server heuristic. No lost prose or required write. | U; helper default/caller containment; no repair loop. |
| npc-validate; Story | Pro/Max, only extracted candidate names; one batch; blocks NPC track and commit | Semantic filter is fail-closed on failure. Tier-off branch already accepts deterministic candidates as review suggestions. Keep suggestions uncommitted as NPC identities; extra false positives are a review-quality risk. | U; no JSON repair. |

Archive append is called with campaign/input/prose/importance only in runArchiveTrack. It does not supply utilityConfig. Consequently canonical turns currently schedule zero server-witness-extract/server-timeline-extract calls, even with utility configured in application settings. Server route/API support is a latent boundary, not proof of current automatic execution.

### A4. Background and other automatic work

These do not directly delay the just-displayed Story or await completion in commit. They can occupy the same serialized endpoint and delay the next Story.

| Family; role | Current automatic gate/frequency | Output/consumer; fallback and freshness | Current retries |
| --- | --- | --- | --- |
| npc-update; Story | Due matched existing NPCs in npcTrack, Pro/Max; one batch; Pro cooldown 5 scenes, Max 0, Lite never | Mutates NPC profile, drives/relations/signature information. Existing state survives failure; can be stale but not represented as freshly checked. Name extraction/classification gates mean ordinary exact existing names may be excluded; not one update call guaranteed per turn. | sendMessageAndParseJson repeats once on malformed JSON; facade repeats use U. |
| npc-drives-backfill; Story | Max, inside npcUpdate branch; missing drives; one call per qualifying NPC | Fills missing drives consumed by agency. Existing deterministic migration/agency logic remains; do not synthesize new model-authored drives to compensate. | Same one JSON-repair repeat, U on facade. |
| profile-scan; Story | Max, bookkeeping due, Story available; default every fifth committed scene | Updates structured character sheet and last-scene marker. Failure returns existing profile. Manual state remains usable; no claim of automatic reconciliation. | U. |
| trait-scan; Story | Same profileScan gate plus active character profile; bookkeeping due | Updates active traits; fallback existing traits. Future PC provenance redesign is out of scope. | U. |
| inventory-scan; Story | Max, bookkeeping due | Updates item list/text and update marker; fallback existing inventory. Manual changes must continue to reach prompts. | U. |
| location-scan; Story | Max, bookkeeping due | Merges ledger/suggestions; pointer updates obey movement/header race guards. Keep deterministic movement/header location track. | U. |
| pc-update; Story | Pro/Max via npcUpdate gate, bookkeeping due, PC exists | PC drift patches. callJson retries malformed JSON once, existing PC retained on failure. | Up to two model.call invocations, each U. |
| relationship-memory; utility | relationshipMemory true + facade + utility + scene participants; one batched scene call; not tier gated | Persists sparse directed memory records; feeds later stance reads and related presentation. Failure produces faults/no new records. Existing stored memories can remain; new relationship developments will not be extracted automatically. | U; 15s caller timeout; no repair repeat. |
| chapter-seal; Story | At CHAPTER_SCENE_SOFT_CAP = 25: deterministic seal first; Pro/Max then attempt summarize/extract | Intended combined summary, divergences, witness corrections, event backfill feed LOD/recall/state. Current canonical chapterSealTrack constructs sealModelCall but does not pass it to runCombinedSeal, while sealProvider is undefined under facade. It can therefore enter a failing llmCall wrapper with zero HTTP attempts; it does not successfully dispatch the intended canonical model request. Preserve structural seal/membership; do not silently repair/activate the missing callback. | Working direct/manual helper defaults to maxRetries 2: up to three llmCall invocations on unusable output, each U. The current canonical undefined-provider exception escapes that loop and is caught by the background job. |
| scene-event-extract; Story | Track supports once per scene lacking events/provider | Structured events used by planner/recall. Canonical host sets eventExtractionProvider undefined when facade exists, so current canonical frequency is zero. Preserve heuristic index/evidence; do not activate this path. | U on direct legacy invocation. |
| timeskip-narration; utility preferred, otherwise Story | Pro/Max timeskip simulation with result.narration; one queued paragraph | Simulation/state/digest are deterministic; additional system chat seam is optional prose. Error already falls back to deterministic result.narration. | U facade; direct llmCall fallback lacks label. |
| server-witness-extract; supplied role/config | archive:written + explicit utilityConfig.endpoint + NPC names; canonical frequency zero | Heuristic witnesses initially stored; model optionally patches them. Existing heuristics remain if omitted. | One raw server attempt. |
| server-timeline-extract; supplied role/config | After witness work under same latent gate; canonical frequency zero | Optional model timeline, regex on null result. No invocation when config omitted; do not describe suppressed NLP as automatically running its regex fallback. | Up to two raw HTTP attempts. |
| location-enrich; caller-selected | Catalogued manual fire-and-forget utility, not a canonical normal-turn track | Adds location details. Keep explicit utility behavior; do not infer an automatic call from the tier entry alone. | Existing helper transport; manual exception. |
| model-driven enemy discovery | Mod declares toggle/tier/cooldown (Lite off, Pro 5, Max 0), but current bundled index.js contains no model scanner, model call, or discovery track registration | Canonical current count is zero. Keep enemy data/UI/prompt/combat. Enforce profile prohibition if an automatic scanner is later restored; do not implement one now. | No executable scanner to retry. |
| extension-model-access; caller-selected | Registered compute, role provider, native event/interceptor may request inference | Cardinality/behavior depend on loaded code. Arc compute tick is deterministic; arc spawn is explicit/manual. Bundled enemy/worldmap prompt/simulation work is not itself an LLM call. Arbitrary native fetch/provider leases are an unverified boundary. | Whatever the caller executes; never assume a global bound from inventory metadata. |
| semantic-embeddings; native embedder | Three foreground semantic HTTP requests plus optional elevation; commit indexing fire-and-forget; cache/batch dependent | Retrieval enhancement, not prose authority. Frontend awaits HTTP and can therefore delay Story even though server may return pending. No fixed one-embedding-per-turn claim. | Native execution, not generic LLM transport retry. |

Media/vision/speech, Ask GM/OOC, guided creation, manual NPC/lore/rules/import tools, synopsis/witness backfill, fact dedup/clustering, chapter summary/index tools, world generation, arc/troublemaker injection, swipes, continuation and explicit Retry are separate operations. Some are unlabelled/dynamic in the inventory; keep that limitation explicit and require supplied observation context when evaluating them. TTS can auto-play if enabled but is a separate media resource, not an automatic Story auxiliary request; measure any resource contention separately.

### A5. Representative costs and queue reality

For successful non-tool canonical generation:

N = 1 Story + B + P + C + Q + F + D + I.

R = 0 on the current facade path. A legacy direct helper may add up to two reranks. Embedding executions and arbitrary extension work require separate observations. Manual deep search is not included.

Representative paths, under their stated prerequisites:

- Phase 0 Lite fixtures: one Story; no deep stance records/utility, no planner/intro/manual work; zero commit/background LLM calls.
- Fresh default Pro with no selectable data/usable utility and no eligible intro: Director + Story = two foreground invocations. Director resolves auxiliary or Story; it does not require a dedicated utility endpoint.
- Populated Pro with usable utility, enabled planner/event candidates, recommender content, three chapter validations all accepted and two non-forced deep stances: nine foreground invocations (Story + Director + planner + recommender + 3 funnel + 2 stance), before optional commit work.
- Populated Max, short/callback query, five funnel validations, eligible intro: 11 + D foreground invocations, before commit/background work. This is a conditional example, not a measured maximum; forced stances and extension work defeat a universal small ceiling.
- Missing stakes tag adds one commit classifier; extracted names add one validator; Max adds one importance call. Bookkeeping/chapter/relationship/timeskip work is conditional, not an invariant per-turn charge.
- Successful tools can add up to five follow-up Story requests (initial plus up to five continuations); error retries add further invocations. Normal success without tools uses one attempt per invocation; rate-limit and parse repair increase cost as specified above.

The queue in llmRequestQueue.ts groups by normalized protocol/host, so endpoint roles and URL paths on the same host generally share a semaphore. Local/private addresses start at concurrency one; remote starts unbounded with adaptive reduction. This is transport scheduling, not profile selection or trustworthy execution-locality detection.

BackgroundQueue has two active tasks by default and an unbounded in-memory pending list; clear() rejects pending tasks but does not abort running ones. Campaign guards drop many cross-campaign writes, not all same-campaign stale-turn results. No durable outbox, general revision binding, cancellation/preemption, restart-safe ordering or endpoint-release guarantee exists.

Additionally, llmCall releases its queue slot after receiving a non-retryable response's headers, before awaiting res.json(). Do not equate semaphore occupancy with model execution completion. Streaming sendMessage holds its slot through stream completion. Phase 1L should avoid creating auxiliary traffic rather than claim a queue cap solves contention.

## B. Proposed Constrained Local policy

Policy identity: constrained-local-v1. Other selection: current (the user's existing tier/settings behavior). No new rich-profile variants are necessary.

| Call/work family | Decision in constrained-local-v1 | Concrete replacement/output contract |
| --- | --- | --- |
| Story | KEEP, required | One streaming plain-prose request. No required JSON, trailer, tools or planner. |
| Director | SUPPRESS automatically; preserve current profile implementation | Retain deterministic watchdog nudge and travel facts. No conditional automatic Director exceptions in this version. Rich behavior remains available by selecting current. Do not build a new manual Director UI for Phase 1L. |
| Archive planner | SUPPRESS | No planner IDs; use existing deterministic archive retrieval. |
| Recommender | SUPPRESS + deterministic fallback | Existing lexical NPC selection; use the existing minifiers with deterministic available profile fields/inventory categories instead of silently leaving smart mode at a stub. See E. |
| Query expansion / model rerank | SUPPRESS | Original query and existing deterministic ordering/fusion. Cover dormant legacy helper branches without activating them. |
| Chapter model funnel | SUPPRESS model branch | Core flat deterministic recall already supported when funnel disabled; keep exclusions, depth, divergence/pins, fetch budget and known-ID filtering. Do not defer funnel requests. |
| Deep NPC stance | SUPPRESS model branch; KEEP deterministic base | Current memory/status/non-negotiables reading and prompt block, with no model wants/hiding/etc. Recompute for current scene; no carried-memory exception. |
| Automatic intro engine | SUPPRESS whole optional automation | No tag and no intro-DC advancement while constrained. Keep config and current-profile behavior unchanged. This avoids introducing a new location-inference algorithm or silently changing intro selection. |
| Stakes classifier | SUPPRESS; deterministic default | Honor same-response valid tag; otherwise calm as existing fallback. Record absent/evaluation-suppressed status in operational diagnostics, not invented certainty. |
| Importance rater | SUPPRESS | Omit client importance; retain server heuristic calculation. |
| NPC validation | SUPPRESS; deterministic review suggestions | Keep regex/name extraction and suggestion UX; never auto-create authoritative NPCs from unvalidated candidates. |
| NPC update / drives / PC drift | SUPPRESS automatic jobs | Retain stored state and explicit edit/generation utilities; do not advance lastUpdateScene or freshness markers for skipped checks. |
| Profile / trait / inventory / location model scans | SUPPRESS automatic jobs | Preserve manual edits, profile seeding, movement/header logic, update stamps and deterministic engine effects. No new inferred state writer. |
| Relationship-memory rating | SUPPRESS automatic job | Read existing memory/pins, retain files and manual operations. New evidence remains in accepted prose; do not mark it memory-extracted. |
| Chapter summary/divergence/witness/event model work | SUPPRESS automatic generation; KEEP structural seal | Existing deterministic chapter seal/membership, compaction read/report and archive/index writes remain. Existing summaries remain readable. New unsummarized chapters use existing renderer degradation, verified in tests. Explicit chapter tools remain available. |
| Scene event extraction | SUPPRESS latent automatic path | Preserve evidence and existing deterministic index. No new event invention or compensating model. |
| Timeskip narration | deterministic fallback; SUPPRESS extra model paragraph | Run existing deterministic simulation/deltas/digest; use existing deterministic narration seam synchronously if nonempty. Do not disable timeskip simulation by turning off its entire tier gate. |
| Server witness/timeline models | SUPPRESS on constrained append | Explicit operation policy reaches route/service; omit utility config and independently reject scheduling this work for constrained operations. Preserve initial heuristics. Current-profile omitted-field behavior unchanged. |
| Enemy discovery | SUPPRESS model automation, presently dormant | Existing tables/encounters/combat/interceptor/UI remain; no campaign enemy-config overwrite. |
| Automatic module inference / role-provider inference | SUPPRESS through application model boundary; use core deterministic recall | Keep bundled deterministic arc/worldmap/enemy behavior. Reject automatic model requests with an operational policy reason before provider dispatch. See D on coverage limitations. |
| Foreground semantic searches/elevation | BYPASS for this transitional profile | Supply undefined semantic IDs so current lexical recall/lore/rules work normally. No awaited embedding lookup, warmup or scoped semantic elevation. Slotted snippets dependent on absent elevation IDs naturally empty. |
| Native embedding indexing | CONDITIONAL, existing nonblocking maintenance only | Existing fire-and-forget index work can remain optional; it cannot become a Story/commit prerequisite. No new prefetch/cache pipeline or same-endpoint generative background job. Empty/broken/unavailable vectors cannot fail play. |
| Manual deep search / utilities / media | MANUAL-ONLY exception | Preserve explicit user-armed deep search and utility actions with separate call accounting. They may have their own explicit waiting lifecycle; never silently arm from normal input or retry failures with auxiliary models. |
| Swipe / continue / Retry | MANUAL-ONLY exception | One explicit generation request per operation in constrained mode; tools off, no automatic error recursion. Reuse/rebuild cached context safely under current trust policy. |

No automatic auxiliary LLM work is moved into background. No idle grace timer, durable job store, endpoint cancellation experiment prerequisite, periodic catch-up or automatic reprocessing is introduced. Omitted work is not a queued debt that runs on the next idle moment or profile change.

Director recommendation: disabled by default and unconditionally absent from the constrained normal path. Its useful corrections are a quality-review target, not a correctness dependency; null is already supported, Lite already plays without it, watchdog/world facts remain, and the writer framework treats a Director block conditionally. Preserve the existing current-profile call/cache/Skip UX.

## C. Profile and configuration design

Use one application-wide AppSettings field, inferenceProfileId: current | constrained-local-v1, default/missing -> current. Validate persisted values in migrateSettings; reject/normalize unsupported IDs predictably to current with a diagnostic rather than silently enabling an unrecognized policy.

Use a small application policy module, proposed src/services/inference/inferencePolicy.ts. It owns the profile ID, effective feature decisions, normal-turn ceilings, tools/retry decisions and reason strings. Reuse existing feature IDs and InferenceClassification vocabulary. Keep descriptive classifications separate from allow/deny decisions.

Proposed narrow interfaces: TransitionalLocalProfileId, ConstrainedLocalPreset, resolveInferencePolicy(settings), effectiveFeatureEnabled(policy, featureId, legacyDecision), and HistoricalEvidenceRenderer. These are application policy/adapter concepts, not new domain authority contracts. Do not add a matrix keyed by vendor/model/hardware.

Compose an immutable overlay over the user's existing selection. Never call updateSettings to bulk-write aiTier, moduleEnabled, endpoint references, relationshipMemory, smartBookkeepingActive, autoBookkeepingInterval, or campaign data as a side effect of opting in. current simply delegates to existing behavior. The constrained veto wins even over an explicit moduleEnabled true for automatic inference. Deterministic flags continue to use the user's settings/tier.

A single two-choice control in GlobalSettingsTab plus a short inspectable effective-policy summary is sufficient. Explain that automated summaries/profile/relationship extraction are paused and explicit tools remain available. Keep provider presets and this operating-profile selector visibly separate. A local provider can use current; a cloud provider can use constrained. No per-campaign/per-role profile storage is justified now.

Resolve/freeze policy at each operation start. Prevent selector changes while generation/commit is executing. Commit must resolve the current operational profile rather than accidentally read only snapshot.turnState.settings from an earlier selection; preserve the frozen fictional input/message window. A pending draft is not accepted merely by selecting a profile. Test opting in before committing an older current-profile draft and reloading with pending markers.

Document one-way Phase 9 mapping: constrained-local-v1 -> LocalCapabilityProfile with one required Story, no automatic auxiliary/background inference, tools/proposals off, historical evidence adapter enabled; provider/model routing and final context budgets supplied separately. Do not implement LocalCapabilityProfile or Phase 9 packing now.

## D. Runtime changes and boundaries

1. Thread the resolved policy through TurnState/TurnContext or a narrow immutable execution-options object and facade configuration. Avoid imports of useAppStore scattered through pure helpers. Reconstructed commit/launch state must receive the same operational resolution.
2. Make policy-aware feature decisions at existing orchestration/track boundaries. tierAllows currently ignores moduleEnabled; replacing the global tier with Lite would also disable deterministic heartbeat/arc/elevation behavior and still miss forced stances. Preserve tierAllows behavior for current and explicitly thread the policy to inference-producing branches. Do not change its global default semantics accidentally.
3. In gatherContext, skip planner/recommender model branches, bypass foreground semantic/elevation HTTP, and use deterministic core recall rather than an arbitrary inference-producing service-role override in constrained mode. Preserve known-ID filtering, exclusions, lexical lore/rules, pins, divergence selections and current budgets.
4. Repair recommender-free smart bookkeeping narrowly. Enumerate valid existing profile fields/categories from current structured data and use existing minifiers, ordering and current volatile budget. Retain the always-injected identity/signature floor. Prioritize equipped items and explicit input/name matches before remaining existing order if a selection is needed. Do not fabricate items/fields or build a new retrieval/packing algorithm. Add a fixture with a consequential existing item and a character ability under smart mode.
5. For stance, explicitly disable model execution at buildSceneStances' model branch while retaining deterministic base records. Passing only aiTier Lite or budget zero is insufficient. Profile identity/model permission must partition the scene cache, or bypass/clear it on policy changes, so cached current-profile deep results cannot leak into constrained output or suppress later rich-profile evaluation.
6. Keep Director watchdog/world-fact code running when its model branch is suppressed. Do not use Absolute Command to fake the profile; it suppresses other desired guidance.
7. Disable tool definitions AND continuation dispatch in constrained generation. A provider-emitted unsolicited tool call must not invoke a handler or schedule another request. Empty/tool-only output is a failed generation. Honor already precomputed dice/lore context; omit any profile-specific prompt instruction that requires an unavailable tool rather than asking the model to call it anyway. Mirror constraints in sceneContinue, swipe and useRetryStoryAI paths.
8. Disable automatic Story error retries in constrained mode. Use the existing terminal retryable UI/snapshot path on the first failure; explicit Retry issues one request. Keep current profile's existing two retries and tool behavior.
9. In commit, omit model stakes/importance/validation, but preserve archive verification/relink, single-flight, failed-commit markers, persistence, deterministic counters, suggestions, pressure, location/on-stage/repression and condensation. Never mark skipped model scans as completed.
10. Gate model substeps inside mixed tracks. chapterSealTrack must still seal before omitting combined generation; agencyTrack/runTimeskipPath must still simulate before using deterministic narration. Do not blanket-disable tracks using callsModel metadata.
11. Do not enqueue suppressed NPC/PC/scanner/memory jobs at all. Gate before BackgroundQueue.push, with a second policy check immediately before dispatch for any already-queued inference closure. A policy-denied call must not enter JSON-repair loops. No rerun/catch-up when returning to current.
12. Carry constrained policy with archive append as an optional validated operational request field; use it in archiveService/nlpPipeline to prevent latent supplied-utilityConfig work. Do not persist it as fictional campaign state or use it to change existing current-profile API defaults. Server tests must exercise an explicitly supplied utilityConfig with constrained policy, since normal append currently supplies none.
13. Keep host model access guarded for automatic compute/event/interceptor work, with explicit caller execution context distinguishing manual utilities. Default unknown automatic requests to denied in constrained mode; do not infer permission from trackingLabel or role alone. This is a narrow application-owned admission boundary, not a replacement telemetry or extension framework. Preserve existing ledger labels/classifications; supply valid caller context for genuinely new/previously opaque observed operations.
14. Profile switch activation must account for old background work. Reject pending inference closures on activation; do not claim BackgroundQueue.clear cancels running jobs or blindly clear deterministic tasks. If a previous-profile/manual generation is running, mark constrained activation as pending until that operation settles, then enable new Story submission. No promise of preemption or automatic retry. Already-running write guards still apply. Test a queued and a running prior-profile job.
15. Add explicit policy reasons to existing diagnostic/trace reporting: suppressed, deterministic-fallback, retained-but-not-refreshed, manual-exception. Suppressed work is not a logical model invocation and has no fabricated provider attempt. Reuse .local-policy.json output and Phase 1 capture hooks; retain old diagnostic-only report semantics for current.

Arbitrary native modules can perform direct fetches outside host access. Phase 1L must not claim universal proof or implement Phase 10's extension retirement. Qualify constrained execution with supported bundled deterministic modules; inspect loaded third-party inference hooks/role providers and expose an incompatible/unverified status if they cannot be controlled. Do not silently certify such a session or uninstall its modules. Use zero-mod plus bundled-module tests to prove the supported scope. An uncontrolled third-party execution requirement is a stop condition, not permission to redesign the host.

Existing manual calls may occupy the same server. They are explicit operations, not free concurrency: prevent overlapping Story submission while an explicit operation is running on the same controlled endpoint, or show the existing wait state. The guarantee is zero automatically created model backlog, not preemption of a user's already-running utility.

## E. Downstream dependency and suppression analysis

| Removed model output | Actual consumers and change | Prompt/persistence and next-turn treatment |
| --- | --- | --- |
| Director brief | buildTurnPayload -> builtins Director; writer framework; watchdog suppression logic | No brief block; watchdog remains. No canonical write disappears. Never retrieve a cached brief after profile denial. |
| Planner IDs | archive recall fusion/ranking | Undefined/empty optional IDs; same exclusions and deterministic recall. Existing archive/events remain unchanged. |
| Recommender NPC names | world.ts activeNPCs | Existing recent-history/current-input name/alias scan activates. Test on-stage continuity and lore-header duplicate handling. |
| Recommender inventory/profile filters | volatile.ts smart mode | Existing fallback emits only a bookkeeping stub plus signature kit; repair as D4, or suppression would remove relevant items/abilities. No setting mutation to disable smart mode. Recommender relevantLoreIds are not returned by recommenderGather; do not claim lore selection relies on them. |
| Expanded queries/reranks | semantic candidate selection | Original query/current deterministic lexical results. No stored derived queries or canonical changes. |
| Chapter relevance judgments | default memory.recall -> scene fetch -> world archive block | Flat deterministic selection. No background timeout loser started. Existing summaries stay available; no chapter data deletion. |
| Deep stance fields | builtins NPC Stances, suppression of relations, visible message stance metadata | Preserve base statuses/non-negotiables/top existing memories and current-scene diagnostics. Never invent wants/hiding text. Existing relationshipMemory true must not be rewritten false: doing so changes scalar-affinity/relationship semantics. Cache isolation is mandatory. |
| Intro tag/DC roll | ctx.finalInput, npcIntroDC | Pause optional automation, unchanged saved config/DC. No forced cameo. Resume current behavior on later turns. |
| Stakes classifier output | context.lastSceneStakes -> agency/timeskip | Valid Story tag still honored. Missing tag uses calm this turn, explicitly a fallback; affects simulation intensity and must be quality-tested. No additional classifier. |
| Importance score | server index importance -> recall/LOD | Omit client score and use existing server heuristic, not stale previous scene score. |
| NPC semantic validation | classifyNPCNames -> addNpcSuggestions; update scheduling | Deterministic candidates remain review suggestions only. No NPC identity acceptance/profile generation is implied. |
| NPC updates/drives | NPC JSON/store -> goals, pressure, future prompts | Preserve recorded values/manual edits; skipped update timestamps untouched. No synthetic psychological reconciliation. |
| Profile/trait/inventory/PC drift results | context + ledger mirrors, prompts, update markers | Existing player edits/engine changes preserved; no marker advance. Show automation paused rather than imply fresh extraction. Manual tools are the repair mechanism in this transitional phase. |
| Location model enrichment | ledger metadata, suggestions, guarded pointer patch | Movement contract/header track continues to own normal deterministic movement. Rich description may stay older; no new inferred location. |
| Relationship memory records | persisted directed-memory files -> compaction/read/stance | No new model record; old records/pins retained. Accepted prose remains canonical evidence in legacy system; missing extraction is not missing archival acceptance. This is a material quality limitation. |
| Combined chapter summary/divergence/witness/event output | LOD summaries/synopses, divergence register, witness/event indexes | Structural chapter membership persists; no fake summary/synopsis/facts. Current renderSummary emits title plus summary even when empty; renderSynopsis falls back from synopsis to summary's first sentence to title. This is title-only orientation, not recovered narrative. Preserve flat recall and explicit pins/manual summaries. Test the 25-scene boundary plus condensation and inspect actual wire loss. If usable continuity cannot be retained by existing fallback, stop rather than invent recursive summaries. |
| Timeskip model paragraph | system timeskip-seam message; deterministic digest already stored | Use existing result.narration fallback and retain state/digest. History renderer treats seam as evidence; no new LLM call. |
| Server witness/timeline patch | indexes/timeline | Initial heuristic archive work survives. Suppressing the whole optional NLP listener does not itself execute its null-result regex branch. No new inferred timeline is promised. |
| Semantic/elevation IDs | archive/lore/rules retrievers; elevated/slotted prompt blocks | Undefined means lexical fallback, not [] meaning no relevant sources. Foreground vector-only elevation/snippets absent. Preserve optional index files; do not rebuild vectors on turn. |
| Module inference | model broker/role provider/custom hooks | Supported deterministic simulation and enemy/map prompt contributions continue. Denied model branch must not partially commit an unsafe module journal; test containment. |

Old extracted state can be incomplete even in current mode. Phase 1L deliberately pauses automatic model mutation rather than promise full reconciliation. Operational freshness belongs in diagnostics/UI, not new epistemic truth fields. Never interpret “not evaluated” as “no change occurred.”

## Historical-evidence adapter (required runtime scope)

Primary files: payload/history.ts, payloadBuilder.ts, world.ts where historical snippets are inserted, pinnedMemories.ts, and history/cached-payload callers.

Implement one deterministic renderer that quotes/encodes historical content with source-role/source-kind labels, explicit evidence delimiters and a trusted instruction that quoted instructions are inactive. Escape delimiter-shaped content so imported text cannot structurally close its envelope. Source role is text metadata, never a reinstated executable role.

Apply before fitting/token estimation for the affected history segment so wrappers are counted and traces reflect the actual wire payload. Preserve existing allocation policy, history order, chapter selection and cache strategy as far as the changed evidence representation allows. Do not append uncounted wrappers after packing.

Distinguish provenance at assembly time:

- Historical player/assistant/system/OOC-like entries and old tool calls/results become evidence. Historical tool metadata must not remain executable provider tool envelopes.
- Condensed LOD chapter text, pinned narrative excerpts, and recalled historical quotations are labelled evidence at their insertion sites, including when embedded in a mixed world/volatile block.
- The current action is emitted once as active user intent, with current deterministic engine outcomes retained. Do not turn it into historical evidence.
- Active scene note, confirmed nextTurnOocBrief, current Absolute Command, trusted application rules and configured trusted characterization stay active through their existing dedicated channels. Never recover active direction from a historical string that merely says OOC/system.
- Do not demote all system messages by role: synthetic current scene guidance is different from a persisted historical system message. Preserve that distinction explicitly.

No historical evidence should be assigned new high-priority instruction authority just to satisfy provider role alternation. Verify final native Ollama, OpenAI-compatible, Claude and Gemini wire transformations using deterministic transports. Retain full-profile byte behavior; enable adapter with the constrained profile and permit rollback together.

Cached swipe/retry/continue payloads require coverage. If created under current and used after opting in, rebuild through the adapter or apply a provenance-aware, idempotent conversion. Do not blindly wrap an entire final user message containing both current intent and evidence. Do not re-run planners to reconstruct safe context. If cached payload lacks enough provenance, use the existing rebuild-from-live-context path with constrained gather policy, not guessed role boundaries. Ensure migrated/reloaded pending turns use the adapter too.

The adapter establishes application-level trust boundaries and adversarial fixtures; it cannot guarantee a single model never follows quoted instructions. Live qualitative checks remain necessary. No Phase 6 secrecy fix or Phase 9 packer redesign is implied.

## F. Evaluation and harness strategy

Use both a second profile-specific deterministic baseline and explicit normative assertions.

1. Preserve eval/baselines/v0, schema-0 projection, all five current scenarios and their results. current must remain MATCH; Director remains behavioral. Keep the exact two reviewed visibility violations/disposition unchanged unless a separately reviewed intentional change requires handling. Do not silently bless or repair them in this phase.
2. Add a distinct phase-1l-constrained-v1 suite/baseline namespace. Record candidates with existing artifact machinery; reviewed pinning remains the single final review gate, never auto-approved by implementation. Profile identity and fixture revision belong in suite provenance. Keep timing outside deterministic artifacts.
3. Run existing five scenarios under constrained policy where applicable and add focused fixtures enabling every reachable suppressed gate. The current harness hardcodes utility unavailable, deepSearchThisTurn false and strips mods; parameterize those seams for the new suite without changing original defaults.
4. Add multi-turn populated Pro/Max fixtures: usable utility/auxiliary sharing Story endpoint, archive event planner, sealed chapters, smart bookkeeping, carried memories, relationshipMemory enabled, missing stakes tag, NPC candidates/updates, fifth-turn bookkeeping, 25th-scene seal, deterministic timeskip and travel.
5. Exercise dormant paths with focused helper/server tests (rerank, event extraction, direct combined seal, supplied utilityConfig); absence in the existing baseline is not sufficient switch coverage. Capture the canonical auto-seal missing-callback failure as existing behavior; constrained mode must skip that model substep cleanly while current remains unchanged. Enemy-discovery tests should assert the current no-scanner finding and preservation of data/prompt surfaces, not install an imaginary scanner.
6. Test no-mod and bundled arc/enemy/worldmap operation; policy denial of a synthetic automatic model-capable compute/role/interceptor; manual utility allowed with explicit context. No arbitrary native bypass certification.

Normative success assertions, per normal turn through generation, actual acceptance and quiescence:

- Exactly one actual required Story logical invocation, nonempty visible prose and one successful provider attempt; zero unclassified/unassociated/undeclared executions.
- Zero automatic foreground auxiliary, zero commit LLM, zero automatic background LLM calls, including delayed timers/queued work after the next send.
- No tools sent, no handler dispatch/continuation, no undeclared replacement call, no model fallback induced by malformed optional output or policy denial.
- Required deterministic callbacks/state transitions retained; no archive append at generation; exactly one accepted scene and proper retirement after success; failed append retains recoverable markers and no duplicate on retry/reload.
- No suppressed job queued, no scan/update watermark advanced, no relationship file wiped, no campaign/global underlying setting overwritten.
- Critical fixture item/ability, NPC identity/boundaries/existing carried memories, selected lore, current location, explicit corrections and accepted evidence reach actual Story wire.
- Prior instruction-shaped text remains evidence; only current trusted intent/direction has active authority.
- Native/server observations join the existing logicalInvocation + attemptOrdinal; relay is not counted as another execution. Missing usage/locality is unknown, never zero or guessed.

Failure/exception tests: Story 503/transport/abort/empty/reasoning-only/tool-only each makes at most one constrained request before an explicit Retry; no archival acceptance of failure. Manual deep search is clearly marked as an explicit multi-call exception and never counted as a normal one-call success. Test current retains its old retry behavior.

History attacks: earlier player “ignore rules,” earlier assistant commands, persisted system/imported OOC impersonation, embedded closing delimiters, quotations, old tool calls, LOD/pins/recalled snippets, active current action, active scene note and confirmed direction. Assert final wire representation, not merely cached payload.

Use existing replay-policy enforcement to reject unknown purposes/endpoints and extra attempts. Extend inspectBaselineLocalPolicy with profile-aware normative checking without replacing its diagnostic-only behavior for current. Do not convert classifications into proof that a suppression is safe.

## G. Live-local smoke strategy

Do not run in this planning pass.

### G1. Repeatable primary run

Repeat all seven existing liveInputs in their original order using the existing native Ollama smoke path. Add inferenceProfileId to smoke config/manifest and pass it into fixture settings so this proves the real profile, not just Lite fixture luck. Keep the original known fixture context/output/sampling for comparability.

Reference fixture from Phase 0: hf.co/mradermacher/gemma-4-26B-A4B-it-heretic-GGUF:Q4_K_M; Ollama 0.40.4; native /api/chat; think false; context 8192, output 512, temperature 0.7; Ryzen 7 9800X3D, 32 GiB RAM, RX 9070 XT 16 GiB, reported 31/31 GPU layers, warm. Reconfirm actual installed model/server/offload rather than copying obsolete values as observations. Model availability is an evaluation prerequisite, never an application requirement.

Where the existing private Phase 0 artifacts/config remain available, compare actual per-turn figures; otherwise use only documented approximate observations, explicitly marked approximate. Do not invent recovered data.

The primary run uses the synthetic campaign API as before. This establishes live provider inference plus real frontend lifecycle, not real backend durability, server NLP or vector behavior.

### G2. Focused quality run and backend boundary evidence

Use one additional bounded 5–7-turn synthetic scenario with populated NPCs, carried memories, structured PC/inventory, lore, a location transition, a relationship-changing event followed by a callback, and a manual correction. Run current and constrained on the same fixture/model/sampling where practical, with declared auxiliary roles routed to the same local server for current. Current's extra calls are measured, not mocked out. This is a within-fixture comparison, not cross-provider benchmarking.

Separately use disposable server-test data to prove constrained append commits and cannot schedule NLP even with utility config; keep provider transport stubbed for this integration test. If actual full-stack inference evidence is needed to resolve a discovered issue, bound it to a disposable campaign and name its narrower purpose. Do not claim the synthetic smoke proves server disk behavior.

### G3. Measurements and reporting

Attach measurements to the existing logical ledger and keep raw live text/credentials/private configuration in ignored .eval-output locations. Commit a redacted human report with provenance and summarized observations only.

Per turn report:

- Operation start, context/gather duration, Story queue wait, dispatch, first upstream chunk (if observed), first reasoning and first visible Story separately.
- Story TTFT from dispatch and end-to-end first-visible latency from submit.
- Story dispatch-to-stream-end time; visible-generation duration from first visible token to end; total visible-turn latency from submit to completed visible draft.
- Commit start/end and commit-only duration; submit-through-commit duration; time until deterministic background quiescence.
- Logical invocations by family/trigger, provider attempts/outcome/retry reason, actual background LLM count, endpoint occupancy windows where observed.
- Actual provider input/output/reasoning/context usage, finish/done reason, model identity when returned; separately labelled tokenizer estimates when provider usage absent.
- Failures/aborts/retries, pending/active tasks after commit and before the following turn, unexpected requests and missing correlation.
- Human notes on continuity, character voice, lore, agency, repetition, relationship changes, memory, scene transitions, truncation and lost detail.

Important existing harness detail: afterTurn.commitMs is measured from turnStarted through post-commit idle; it is cumulative, not commit-only. Preserve existing meaning for compatibility; add explicit timestamps/durations or derive and label cumulative-minus-draft correctly. Do not publish the old field as archival commit duration.

The existing scope has no model background calls, so zero occupancy from automatic auxiliary inference is the acceptance target. Do not use frontend queue-slot release as proof that the local server is idle; compare dispatch/stream completion and available native server observations. Do not infer GPU compute duration.

Phase 0 approximate reference: mean completed turn ~19s, visible TTFT ~3.4s, prompt ~6.5K, visible output ~360 tokens. Seven-turn Lite already used one Story, so call count improvement against that fixture is not expected. Improvement from suppression should be demonstrated against the populated current-profile comparison.

Do not set an arbitrary absolute latency or percentage speedup threshold. Compare same-fixture queue/auxiliary occupancy and latency distributions, disclose prompt/length differences and hardware variation. Material unexplained regression requires investigation, not automatic approval because counts fell.

The known turn-7 7791-input + 401-output = 8192 length truncation remains Phase 9A. Record context effects, truncation and missing quality evidence. Do not alter the primary fixture's context or packing to manufacture a successful comparison. A supplemental larger-context run may diagnose quality, with separate provenance and no product-default change.

## H. Quality protection

Deterministic replay proves structure/state/prompt behavior; fixed canned prose cannot prove emergent narrative quality. Keep these claims separate.

| Focus | Required scenario and evidence |
| --- | --- |
| NPC continuity | Two established NPCs plus a later reappearance; retain identity, voice/signature kit, boundaries and current presence with no Director/recommender/updater. Include a carried memory that would force deep inference on Lite. |
| Lore | Name and alias callback to a prior event/lore rule; lexical selection and pins still supply the needed evidence without expansion/funnel/rerank/vectors. Human review checks contradiction or confident invention. |
| Character consistency | Existing ability, equipped item and explicit voluntary action under smart bookkeeping; no lost ability/item after recommender suppression, no invented PC decision from skipped drift scans. |
| Scene transitions | Current movement contract/header, deterministic travel checkpoint and timeskip; verify state position and continuation without a Director/location scan. |
| Relationships | Existing formative/carried memories plus new relational event and next-turn callback; verify old anchors survive and prose retains the new event despite no automatic record extraction. Report later structured-memory staleness explicitly. |
| Memory/state | Manual correction retained after rehydration, durable accepted scene, superseded fact handling, 25-scene seal/condensation with missing new summary, interruption/retry/reload. |
| Director-specific behavior | Dossier/watchdog-relevant unfair adjudication, signature-kit and travel logistics pressure; inspect current vs constrained outputs for regressions in fairness, grounded reaction and playable openings. |
| History trust | Imported instruction attack plus active trusted direction; quote attack as evidence while honoring the current action. |

Review the focused live outputs manually using a compact rubric: supported/contradicted/not evidenced for each critical fact; preserved/regressed/not reviewed for voice, agency, relationship response and coherence. No LLM judge and no assertion that one model sample proves universal quality.

Blocking quality failures: lost required prompt state, corruption/duplicate acceptance, newly introduced contradiction attributable to missing deterministic input, instructions promoted from history, or repeatedly unusable scene/character continuity in the focused run. A latency improvement cannot waive them. Isolated prose style differences are review findings; severe repeated regressions require a narrow deterministic adjustment or an explicit stop for policy reconsideration.

Human qualitative fields may be not_reviewed during autonomous collection, but Phase 1L cannot claim quality acceptance until the single final review completes them. This is the final independent gate, not an approval after every package.

## I. Failure and degradation semantics

- Suppressed work is “not evaluated by this profile,” never “success,” “no change,” or a provider failure. No provider attempt is recorded for a denied operation.
- Optional deterministic selection/fallback failure must not trigger another model. Use existing safe empty/default behavior and surface a bounded diagnostic.
- Old NPC/profile/inventory/memory state remains available with its original update markers. Do not advance timestamps or reassert old deep stance as current interpretation.
- Missing stakes tag uses calm; missing model importance uses server heuristic. No classifier/repair cascade.
- Story failure, timeout, abort, empty visible response or tool-only output leaves retryable working state; no successful pending Story/archival acceptance, no automatic model retry. Explicit user Retry is separately accounted and still tool-free.
- Successful nonempty Story can remain a pending draft exactly as today; commit waits only for required deterministic/storage work. A failed append retains recoverable pending/commitFailed markers; relink verification prevents duplicates. Do not confuse inference success with disk acceptance.
- Background LLM work has zero automatic retries because it is not scheduled. Current-profile/manual helper retries retain their own explicit scope and observation.
- Cancellation of an already-running manual/current-profile request must not be described as prompt server release without evidence. Profile activation/next submit waits for known active work to settle if necessary.
- Restart does not replay suppressed work. Existing pending-commit reconciliation uses constrained commit policy when selected. No new outbox/dirty-watermark schema is needed.
- Disable constrained profile to restore current behavior and prompt renderer. Underlying selections and stored campaign files are retained; changing profiles does not recreate derived facts/summaries that were never generated.

## J. Implementation packages

### Package A — Policy contract and deterministic evaluation

Files/systems:

- src/types/llm.ts; store/slices/settingsHelpers.ts and settingsSlice.ts; GlobalSettingsTab and typed i18n strings.
- New small inferencePolicy module and focused tests.
- Existing eval support/types/classification/local-policy/assertions/fixtures/replay transport and launcher; profile-specific suite/artifact namespace.
- Existing inference inventory/generator only as necessary to register source-site changes later; no duplicate catalog.

Work:

1. Establish profile field/validation/default/migration/UI and immutable effective policy.
2. Define exact operation allowances/ceilings and diagnostic reasons from B; current resolution is identity behavior.
3. Extend harness seam for explicit utility/auxiliary roles, profile selection, loaded deterministic modules and normal/manual operation distinction without changing original fixture defaults.
4. Add isolated normative assertion tests and prepared constrained fixtures. Runtime-dependent expectations can be introduced with Package B; do not leave a failing default test suite or claim enforcement before integration.
5. Specify profile-specific baseline candidate path and review process; preserve pinned v0 bytes.

Tests/validation:

- Missing/invalid profile, persistence/reload, provider/profile independence, no settings mutation, explicit module toggle cannot override constrained automatic denial.
- Original eval + determinism remain MATCH/BYTE_STABLE.
- Assertion unit tests reject extra Story/auxiliary/attempts, unclassified traffic and false success.
- Engine contract typecheck/build/purity and app build; focused settings/UI tests; changed-file lint/i18n checks.

Internal continuation gate: policy contract and harness tests pass; current has no behavior changes; no baseline or authority changes. Continue automatically to B. This package alone is not Phase 1L completion.

### Package B — Runtime policy, fallbacks and historical trust

Files/systems:

- turnOrchestrator, turnContext, turnStages, contextGatherer and context-gatherer helpers.
- aiTier/blockEnablement integration, hostFacade/model admission, role recall boundary and compute/native execution adapters only where needed.
- pendingCommit/postTurnPipeline; mixed NPC/chapter/agency tracks and inference-only post-commit tracks.
- npc/relationshipStance/cache; agency/agencyEngine timeskip paragraph.
- payload/history, payloadBuilder, volatile, world, pinned history insertion sites and narrow new evidence renderer.
- sceneContinue, swipe generation, useRetryStoryAI and fallback payload callers.
- apiClient/archive route/service/NLP operational policy boundary; related server tests.
- Existing inventory projections/freeze signatures only for actual reviewed maintenance changes.

Work:

1. Implement D and E, denying before requests/jobs are created.
2. Preserve deterministic simulation/seal/commit and repair smart bookkeeping input loss.
3. Enforce no-tools/no-recursive-inference/no-auto-retry for constrained generation and explicit retry variants.
4. Implement historical adapter with provider-wire and cached/reload coverage.
5. Cover old queued/running jobs and activation at idle; supported extension scope is explicit.
6. Emit profile report through current diagnostics/capture infrastructure.
7. Generate constrained suite candidates; review expected prompt/retrieval/state deltas internally, without repinning.

Tests/validation:

- Entire constrained normative suite, switch coverage and downstream fallback fixtures from F/H.
- Current v0 all MATCH and exact reviewed violations unchanged; determinism for both suites.
- Existing turn/base-app, pending commit/durable recovery, tracks, NPC/stance, payload/history/LOD, tool/swipe/continue/retry, queue/provider, bundled modules and isolated server archive/NLP suites.
- Full application test run and build, engine test/build/typecheck/purity, architecture and inference gates, changed-file lint/i18n.
- Exercise explicit manual utilities/deep search and profile round trip. Verify no automatic replacement traffic after timers/quiescence or across the next turn.
- Run node scripts/patch-graph-imports.mjs after import/config edits as AGENTS requires. The script is currently missing; record the known failure rather than inventing tooling or reporting success.

Internal continuation gate: all new normative requirements green, current parity intact, no unexplained prompt/state regression, no new unclassified traffic, no uncontrolled required extension behavior, no pending background LLM jobs. Continue automatically to C.

### Package C — Measured local smoke and closure

Files/systems:

- Existing liveSmoke fixture/entry, ollamaLive/replayIO/observe measurement hooks and ignored local configuration/artifacts.
- New docs/eval/phase-1l-status.md and a redacted smoke/quality report; final constrained baseline candidate/manifest.
- This plan's acceptance matrix, stable profile migration note and known-limitations handoff.

Work:

1. Run G primary seven-turn constrained smoke and focused same-fixture current/constrained quality comparison within configured timeouts.
2. Record actual calls/attempts/timing/usage/context, commit-only time, background occupancy and human-review material.
3. Verify server boundary through disposable integration evidence; state synthetic-vs-full-stack coverage honestly.
4. Investigate attributable regressions narrowly; do not change context architecture, acquire another model/provider or expand into benchmarking.
5. Write final report with measured acceptance status, quality not_reviewed items, known debt, rollback instructions and deferred phase ownership.
6. Present the whole phase once for independent review; only then pin the new baseline with explicit review authorization. Do not repin v0 or change production defaults.

Validation:

- Successful live normal turns each meet one-call/one-attempt and commit requirements, no unexpected requests/failures.
- Focused output/evidence ready for manual review; no silent pass for missing quality review.
- Re-run final deterministic/gate/build checks after actual remediation changes; do not repeatedly broaden checks after unchanged green results.
- Final diff review ensures only Phase 1L work, no private artifacts, no authority/schema migration and no provider-coupled policy.

Internal continuation gate: automated implementation and measurements complete, blockers absent, final review material concrete. Proceed directly to one independent review. After review, narrow remediation and only affected validation; new architecture scope requires a stop.

Recommended Windows validation commands use npm.cmd/npx.cmd because this repository's prior work encountered npm.ps1 execution-policy restrictions. Core commands: npm.cmd run eval; npm.cmd run eval:determinism; npm.cmd run test:run; npm.cmd run test:base-app-gate; npm.cmd run build; npm.cmd run check:architecture; npm.cmd run check:inference; npm.cmd test --prefix packages/engine; npm.cmd run typecheck:contracts --prefix packages/engine. Add the new suite selection to the existing eval launcher rather than a second runner. Use existing generator --write-doc/--write-report only for reviewed source metadata changes, then check generated integrity.

## K. Stop conditions

Interrupt autonomous implementation only when:

1. A needed suppression removes required deterministic behavior or continuity that cannot be preserved by the narrow existing fallbacks described here.
2. A new failing invariant, corruption/duplicate-acceptance risk, current-profile regression, history-trust failure or uncontrolled inference remains after focused remediation.
3. Required loaded custom native/role code bypasses policy and the user requires it inside the constrained guarantee; fixing it would cross the extension-freeze/Phase 10 boundary.
4. A solution requires changing authority, schema, epistemics, retrieval architecture, final packing or another explicitly deferred phase.
5. Live model/server/hardware or access is unavailable, resource ceilings fail, or environment differs enough that a valid comparison cannot be made. Finish independent code/eval work and report the exact remaining smoke prerequisite; do not fabricate observations.
6. Required final human quality/baseline review is outstanding. Stop at the final review gate with artifacts ready.
7. User changes scope or a genuine approval restriction blocks a necessary action.

Do not stop for ordinary file choices, profile reason wording, expected constrained snapshot differences, known two visibility violations, unchanged build warnings, existing unrelated lint debt, or the known missing graph script. Explain those in the handoff. Internal test failures are remediation tasks first, not automatic requests for permission.

## L. Acceptance criteria

| Requirement | Completion evidence |
| --- | --- |
| Stable opt-in profile | Persisted validated constrained-local-v1; missing remains current; independent provider roles; no underlying setting/campaign rewrite; Phase 9 mapping documented. |
| Exact normal-turn ceiling | For every successful normal turn, one required foreground Story logical invocation, zero foreground auxiliary, zero blocking postresponse/commit model calls, zero automatic background LLM calls and one provider attempt. Success-path rationale is roadmap's one-Story contract, not a guessed performance budget. |
| Bounded failure behavior | At most one automatic Story request in a failed constrained operation; explicit Retry needed; no tool recursion or auxiliary compensation; no commit of empty/error output. |
| Complete accounting | Existing ledger/correlation accounts for attempts, retries/manual exceptions and observed server boundaries; relay joined, not added; no undeclared or unclassified replacement inference. |
| No generated backlog | No constrained automatic LLM job queued/running at next submit; prior-profile active work handled explicitly; no claim of preemption. Deterministic/nonblocking native work separately reported. |
| Deterministic gameplay | Dice, pressure, agency/timeskip simulation, movement, on-stage/repression, structural chapters, manual edits, pins/corrections and archival lifecycle verified. |
| Downstream protection | Smart profile/item detail and base stance memories survive; carried memory cannot force a call; freshness stamps remain truthful; no history/evidence deletion. |
| Historical trust | Old role/OOC/tool/imported/quoted/LOD/pinned/recalled text rendered as inert evidence on actual wire; current action/direction/rules remain active; wrapper costs counted. |
| Eval preservation | v0 unchanged/current MATCH; new constrained suite byte-stable and normative PASS; separate reviewed candidate baseline; two existing known violations still explicit. |
| Live evidence | Seven fixed native-Ollama turns plus focused quality comparison, named environment, requested metrics, nonempty prose, clean commit and zero automatic auxiliary calls. Context overflow/length endings reported honestly. |
| Quality acceptance | Human review of focused continuity/lore/PC/scene/relationship/memory/trust scenarios; no material unexplained regression accepted merely for speed. |
| Reversibility | Selecting current restores prior behavior/renderer selection and settings; no deleted paths or authority cutover; missed optional derived work is not falsely recreated. |
| Closure | All internal gates, redacted report, one independent review, narrow remediation and explicit accepted limitations. No production-default change in Phase 1L. |

Manual/deep/media/native embedding work is never hidden inside the normal-turn LLM ceiling. It must be separately classified and reported; manual waiting is explicit. Optional embedding availability cannot block normal Story or make commit fail.

## M. Deferred work

- Phase 2: SQLite substrate/import/backup/restore; no data authority changes here.
- Phases 3–4: immutable draft/hash acceptance and atomic canonical state; preserve current legacy commit semantics.
- Phases 4C/5: trusted narrator-direction UX, typed NPC/PC/world domains and replacement modules.
- Phase 6: sparse epistemics, knownBy replacement, secrecy semantics; do not repair the two legacy narrator exposures here.
- Phase 8: unified retrieval, FTS/entity links/aliases/lore redesign and filtering; only choose existing lexical branches in 1L.
- Phase 9A: output-first context packing, output reserve, protected-content failure, 4K/8K/16K+ profiles and the measured 8K overflow. Evidence wrappers are counted but no new packer is designed.
- Phase 9B: final capability profiles/background scheduling/cancellation proof; no idle model queue or scheduler in 1L.
- Phase 10: public native/compute/provider-lease surface retirement and general extension closure.
- Later evaluation: provider/model benchmarking, CPU/partial-offload qualification matrix, larger-window experiments, new cloud providers and hybrid endpoint isolation.
- Separate maintenance: existing missing graph-refresh script, six overlong extension signatures, unrelated whole-repository lint debt. Do not refreeze broadly or silently fix unrelated code.
- Existing dormant/faulty wiring: facade reranker endpoint guard, facade event-extraction provider, canonical chapter auto-summary missing callback, and absent enemy scanner. Record their current behavior; Phase 1L must not activate extra calls by repairing them as incidental cleanup.

## N. Risks and mitigations

1. Relationship/character state can become stale without extractors. Preserve accepted evidence/manual edits/existing pins, expose paused automation and test next-turn callbacks. Do not promise long-campaign equivalence from seven turns.
2. Lexical recall may miss paraphrased callbacks without planner/expansion/funnel. Test aliases and explicit pins/manual deep search; defer retrieval redesign.
3. Smart mode can lose consequential detail when filters vanish. D4's deterministic existing-data selection is required, with actual-wire fixtures.
4. Carried-memory forced deep selection and scene cache can bypass a naive Lite switch. Explicit model denial and profile cache partition are required.
5. Missing scene-stakes classification changes agency intensity via calm fallback. Preserve same-response tag and measure this case; do not add a new classifier disguised as a safeguard.
6. Unsummarized sealed chapters plus condensation can lose useful orientation. Preserve structural data and verify existing LOD fallback at the boundary; stop if the narrow path cannot support usable continuity.
7. Tools/retries are hidden extra Story cost. Deny both outbound tool capability and inbound continuation, and make first failure explicitly retryable.
8. Stale queued/running work can occupy the endpoint or write after activation. Gate enqueuing/dispatch and activate at a settled operation boundary; no imaginary cancellation guarantee.
9. History quoting can alter style/token use or be semantically ignored by a model. Count wrappers, compare actual provider payloads and live output; current profile remains reversible.
10. Dynamic/native inference and server latent endpoints can escape frontend assertions. Narrow supported-module proof plus explicit server tests; no universal coverage claim.
11. Baseline arithmetic can overclaim speedup: Phase 0 Lite was already one Story, commitMs is cumulative, and proxy/native records can double-count attempts. Use populated comparisons, explicit timing windows and joined attempt identity.
12. Existing context exhaustion can dominate the result. Report it independently and keep Phase 9A ownership; never equate one call with bounded prompt size or sufficient narrative quality.

## O. Recommendation

Phase 1L is ready for implementation as these three packages. The core operating policy is supported by existing failure/default branches and deterministic runtime behavior, but it requires real integration beyond toggling Lite: model gates, mixed-track preservation, smart-bookkeeping detail, stance/cache handling, no-tools/no-auto-retry, server boundary coverage and historical trust.

No unresolved architecture decision requires another planning round before Package A. Empirical quality remains to be demonstrated in Package C and the single final independent review. Complete those gates before calling Phase 1L accepted or recommending Constrained Local as a default.
