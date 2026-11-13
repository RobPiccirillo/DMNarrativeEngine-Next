# Phase 2 implementation plan — SQLite substrate and verified import framework

Planning date: November 12, 2026. Inspected source: `main`, `995af1c707cd2fff726d907a0e75468b6d35e5b9`, also the target of `phase-1l-complete`. The working tree was clean before this planning pass. This document is the only intended tracked change; it authorizes no implementation, conversion of user campaigns, commit, merge, or tag.

The authoritative scope is [roadmap 003, Phase 2](../architecture/003-implementation-roadmap.md#phase-2--sqlite-substrate-and-verified-import-framework), read with its dependency/authority tables and Phase 4 gates. **Phase 2 does not migrate any live gameplay domain to SQLite.** It imports preserved snapshots into disposable staging databases and proves conversion, verification, schema migration, backup, and actual isolated restore. All live gameplay reads and writes remain legacy. The first real authority switch is Phase 4B2, after Phase 3 and Phase 4 readiness gates.

The user confirms Phases 0, 1, and 1L are reviewed, merged, and tagged. Git confirms all three completion tags and the Phase 1L merge at HEAD. Some checked-in status/quality documents still describe pre-merge review or pinning as pending. Treat those passages as historical documentation lag, not a reason to reopen Phase 1L or change its candidate/pinning disposition. In particular, completion does not imply a constrained baseline was pinned: the current constrained suite still reports UNPINNED.

## A. Phase 2 roadmap acceptance matrix

This matrix precedes the implementation design. The seven numbered rows correspond, in order, to every Phase 2 acceptance bullet in roadmap 003. The second matrix captures the additional required deliverables and migration constraints in that same section.

Phase 1 dependencies used below:

- **I:** `identity.ts`: root-scoped campaign StableId, campaign-scoped child StableIds, distinct compatibility/snapshot references; no ambient allocator or identity recovery.
- **C:** `classification.ts` and `contextRecord.ts`: authority/trust/legacy status are independent; read projections cite an actual `ContentVersion`.
- **M:** `mutation.ts`, `mutationVocabulary.ts`, `authorityRouter.ts`: full envelope, provenance, expected owner/epoch/content version, logical replay identity and conflict outcomes.
- **T:** `authorityTransition.ts`, `authorityControl.ts`, `authorityControlStore.js`: strict transition/control schema, single owner, revision checks, monotonic epoch, first-write latch; dormant sidecar is not a transaction coordinator.
- **W:** writer inventory, eight competition groups, AST writer/extension freeze gates; inventory grants no authority.
- **E:** call ledger and pinned v0 comparison; retain the Phase 1L profile and historical-evidence boundaries.

| ID / roadmap acceptance criterion | Required implementation | Migration behavior | Required tests/evidence | Explicitly deferred / dependency |
| --- | --- | --- | --- | --- |
| A1. SQLite first appears only as a disposable staging/conversion artifact | Explicit-path campaign DB opener and staging-only repositories; no application bootstrap, hydrator, gameplay route, or turn imports of them | Conversion is opt-in and creates a new artifact outside live campaign files | Import-boundary gate; no artifact when merely opening/playing; DB failure cannot gate play | Live campaign authority/repositories: Phase 4; I, W |
| A2. Reports reconcile every expected legacy source by count/hash, attach source path/hash/original key/import-run provenance, and classify discrepancies | Complete source manifest, strict snapshot readers, staging records/links, findings and JSON/Markdown report | Include missing/corrupt sources explicitly; preserve bytes; never default malformed input to empty | Independent source-to-DB counts, raw and semantic hashes, ordering/link checks, per-item provenance, first-party coverage fixtures | Typed state/epistemic interpretation: Phases 4–6; I, C, W |
| A3. No later cutover proceeds with a cutover-blocking finding, including unresolved authoritative mismatch or missing critical source | Machine-readable blocker disposition and fail-closed `assertImportEligible` prerequisite; no cutover command in Phase 2 | A blocked preview can be retained for diagnosis, but cannot receive eligible status; eligibility is snapshot-specific and is not cutover permission | Every blocker class rejects eligibility; unknown severity, missing report, altered manifest, incomplete verification/restore fail closed | Actual router cutover consumes and revalidates this gate at 4B1/4B2; T, M |
| A4. Failed import leaves legacy campaign byte-identical | Read-only live/snapshot access; destination containment checks; quarantine incomplete output only | Never invoke hydration, adoption, repair, restore-to-live, source rewrite, or auto-cleanup | Before/after hashes, presence and directory inventories for success and every injected failure; source fixtures made read-only where supported | Source repair and destructive retirement excluded; I, T |
| A5. Schema migrations forward-tested and transactionally roll back on failure | Ordered checksummed migrations; version table; transaction helper; no ad hoc DDL | Upgrade disposable copies only; refuse unknown/newer schema or checksum divergence | Empty-to-current, each prior-to-current, rerun, failure between DDL/data/version writes; reopen proves previous committed schema/data | Canonical/domain schemas added by their owning phases; M, T |
| A6. Staged DB plus lore/assets manifest restores into isolation, passes integrity and comparison with source expectations | SQLite backup API, versioned bundle manifest, local asset/lore payloads, isolated restore verifier | Restore never overwrites a live campaign; vectors excluded; no success based solely on backup creation or SQLite integrity | Close original; restore elsewhere; open restored DB; integrity/FK/schema checks; independently compare records, provenance, source and asset hashes, authority metadata and outcomes | Live authority-control lifecycle/transactional recovery before 4B2; I, T |
| A7. No normal-turn code writes SQLite in this phase | No per-turn shadow feed, DB creation, DB open, migration report update, or DB-dependent compatibility read | Legacy remains the single live persistence path, including new/imported campaigns | Real frontend replay plus disk integration; spy/opener/import-graph negative tests; unchanged v0 and constrained artifacts | All gameplay writer redirection: later domain gates; W, E |

| Additional roadmap obligation | Implementation / migration requirement | Evidence and deferral / Phase 1 dependency |
| --- | --- | --- |
| 2A opener, runner, integrity, transaction helper, persistence harness | `server/db/` and temporary-root tests using existing better-sqlite3 | Real native SQLite, reopen and rollback tests; no vector extension; M, W |
| 2A non-live migration/source/report/authority/schema tables | Only the operational and staging schema in E | Strict schema round-trip and constraints; no future domain truth tables; I, C, T |
| 2A consistent backup/restore excluding vectors | Versioned migration artifact backup distinct from legacy timestamp backups | WAL-aware backup and actual restore drill; vectors absent; T |
| 2B quiesced internally consistent source | Offline, cooperating-process exclusion plus sealed manifest-addressed snapshot, as in K | App/migration lease contention, stale lease, source drift, missing files; no use of archive's in-memory lock as a global barrier; W, T |
| 2B full enumerated import coverage | Identity, chat/archive/index, NPC/location/entity identifiers, state inventories, facts/timeline/divergence, relationship files and mod tables | Fixtures cover every built-in suffix, retained enemy sources, all 16 currently declared first-party tables and unknown/uninstalled tables; I, C, W |
| 2B source counts/hashes/references/order/first-party table verification | Independent verifier, not an import-script success flag | Omitted/duplicated/reordered/changed records and orphan links fail usefully; C |
| 2B every item has path/hash/original locator/run provenance | Source FK plus immutable locator and import run on each staged item | SQL anti-join finds zero unprovenanced rows; compatibility reference validation; I, C |
| 2B informational/warning/cutover-blocking classification | Findings include code, severity, disposition, affected source/locator and evidence | No implicit waiver; missing critical source and unresolved authoritative disagreement always block; T |
| 2B human preview and machine report | Versioned JSON plus deterministic Markdown projection and nonzero blocker exit | Reports distinguish preserved, staged, unparsed, unresolved, verified and restore-tested; no fictional promotion; C |
| Failure affects new DB only | Preserve source and sealed snapshot; quarantine only owned incomplete destinations | Disk/process/crash injection plus no-source-write assertion; T |
| Old campaigns open unchanged; preview rerunnable | No conversion on load; same snapshot/tool version reruns produce equivalent staged meaning and stable references | Restart/rerun tests; different source version cannot reuse verified status; I, M |
| All legacy routes/files remain live authority; existing backups work | Keep gameplay writers and legacy backup/transfer API contracts; add separate migration artifact workflow | Existing filesystem regressions and new boundary tests; known legacy coverage limits documented in N/O; W |
| No runtime SQLite reads, per-turn dual writes, typed-state/prompt change, or vectors in DB | Static boundary plus dynamic denied-opener tests | Both profiles retain prompts, inference ledger, gameplay state and accepted results; E |
| Pre-implementation evidence | Capture current v0, legacy round trips, and empty/small/corrupt-optional/long/relationships/first-party fixtures before importer implementation | Package A/B test fixtures first; do not repin baselines or substitute synthetic frontend IO for disk proof; E |

The roadmap's broad future target in 002 is not a description of this checkout. Its Phase 2 assumptions are substantially correct: files remain authority and SQLite exists for vectors. Necessary source corrections are in B: paths are mostly flat files, reads can write, stable IDs are contracts rather than adopted runtime IDs, and current lifecycle copies are incomplete recovery artifacts. None justifies advancing a later-phase cutover.

## B. Current persistence architecture

### Verified live flow

```text
UI / turn / deterministic engines / model tracks / native+sandboxed mods
  -> Zustand useAppStore (campaign/chat and other slices)
     -> campaignStore / apiClient / table and relationship adapters
        -> Express campaign/archive/chapter/fact/timeline/divergence/map/table routes
           -> archiveService / archiveRepository / fileStore / tableRegistry
              -> data/campaigns/<storageId>.<suffix> (mostly flat files)

archive append -> index + entities + chapters (separate writes)
               -> optional embedding work -> data/embeddings.db
               -> deferred NLP, if allowed by operational profile

data/authority/<storageId>.authority.json
  = dormant Phase 1 control API; no live route consults it
```

`src/store/useAppStore.ts` composes six Zustand slices without persistence middleware. While active, campaign/chat state is writable gameplay state, not the final architecture's query cache. `context` mirrors structured inventory, character profile and PC data held in separate slice fields; map/module projections add more overlaps. Persisted files and active memory can differ during debounce, failure, recovery and module activity. There is no implemented single transactional owner across these representations.

`campaignSlice.ts` schedules one-second whole-state, NPC, lore, dedicated per-campaign divergence, and generic location saves. The state saver obtains fresh active state at firing time; other schedules capture campaign/data differently. `flushAllPendingSaves()` flushes known schedules, not every in-flight/background producer, and several saves swallow network errors or do not reject non-OK HTTP. It is not proof of durable global quiescence. Chat actions reuse state/divergence savers. `pendingCommit.ts` separately persists pending draft state and immediately stamps retirement/failure; these are multi-file effects, not database replay protection.

`saveCampaignState()` serializes context/messages/condenser/pins and removes message `debugPayload`, `retryable` and `precontext`. Some slice flush paths build their own bodies; the server independently removes `debugPayload` and preserves omitted pins. `PUT /state` then separately updates metadata `lastPlayedAt`. Most routes replace full JSON values without owner/epoch/version preconditions. `writeJson()` uses temp+rename, but has no multi-file transaction or fsync durability guarantee. Archive append uses `appendFileSync` before awaited index/entity/chapter lock sections. `writeLock.js` is per-process and covers only participating archive operations.

### Domain inventory verified against runtime

All paths below are relative to `DATA_DIR`, except the explicit portrait path. “Legacy ID” means a locator, not a Phase 1 canonical StableId. Current authority classifications describe behavior/debt; they do not approve every legacy writer as a target owner.

| Domain / semantic producers | Persistence sinks and representation | Current authoritative owner / identity | Version/concurrency and migration risk |
| --- | --- | --- | --- |
| Campaign identity/catalog; form/create/edit, hub, state-save recency | `campaignStore.ts` -> `routes/campaigns.js` -> `campaigns/<id>.json` | Legacy campaign metadata; mutable name plus uid/string filesystem key | Full overwrite, no CAS; rename changes display metadata, not path; ID collision/reuse cannot prove continuity |
| Context, PC/profile, inventory, on-stage/current place, clocks/settings, notebook, scene notes; slices, UI, engine, tracks, mods | `campaignSlice.ts`, `campaignStore.ts`, `PUT /state` -> `<id>.state.json` | Active Zustand/context mirrors and persisted state; PC/NPC/item/location string IDs | One-second full-array saves and immediate commit saves compete; unknown fields and explicit contradictions must survive staging |
| Chat, swipes, pending/failed commit, pins, condenser | `chatSlice.ts`, `pendingCommit.ts`, state route -> `.state.json` | Working messages in memory/files; archived accepted exchange also exists separately; message IDs and `sceneId` stamps | Single-flight commit is not cross-file atomic; lost acknowledgement/reconcile can leave mismatched archive/chat state; do not infer selected/accepted revision semantics before Phase 3 |
| Accepted narrative; post-turn append, edits, surgical delete/rollback/rename | `apiClient.ts` -> `routes/archive.js` -> `archiveService.js` -> `archiveRepository.js` -> `.archive.md` | Legacy archive prose plus scene stamps in chat; numeric/padded scene IDs may be reused after historic operations | Append is separate from index/entity/chapter writes; full-file edit rewrites use temp+rename; crash can leave orphan blocks/index entries |
| Archive metadata, witnesses/events/importance and chapters; archive service, chapter UI/sealing/read repair, deferred NLP | `.archive.index.json`, `.archive.chapters.json` | Index is mixed derived annotations; chapter membership/title editorial, synopsis derived; `sceneId`/`chapterId` strings | Partial archive locks; some index patches unguarded; chapter GET can repair/persist; array order and explicit membership/range must be checked independently |
| NPC identity/characterization/goals/pressure/agency; manual/import/model/agency/pressure/UI | NPC save route -> `.npcs.json`; PC also in state | Legacy NPC array plus current store; name keys/aliases and string IDs, no canonical mapping adopted | Full overwrite; eight-group inventory includes NPC, health, presence competition; loading normalizes/coerces fields in memory; importer must not run it |
| Location ledger, current location/travel; generic table, context, movement/header/scanners/worldmap | `.locations.json` via registered built-in descriptor; `.state.json`; `.overworld.json` and worldmap mod files | Legacy competing presence writers; place IDs/names and coordinates are not separate target owners | Generic full-value PUT plus debounce; no shared transaction across context/map; keep both explicit conflicting values, report ambiguity |
| Entity registry, facts, timeline and established/divergence assertions; archive NLP/heuristics, user edits, merge, hydration | `routes/facts.js`, `timeline.js`, `divergence.js`, archive service -> `.entities.json`, `.facts.json`, `.timeline.json`, `.divergence.json` | Mixed legacy assertions and entity index; `ent_*`, `fact_*`, `tl_*`, scene/chapter refs and name relations | Entity merge writes facts then entities; timeline GET creates file from facts; divergence format version is not content revision; no epistemic authority may be inferred |
| Directed relationship memory; manual editor and post-commit extractor/merge | `relationshipMemoryState.ts`/`Store.ts` -> campaign relationship route -> `.relationship-memory.npc-to-mc.json`, `.relationship-memory.npc-to-npc.json` | Two legacy collections; subject/target/scene tuples, `MC` sentinel, source/user/recorded/era tags; often no record ID | Two sequential file writes, no collection transaction; runtime only loads when feature enabled; importer must cover them even when disabled and never equate evidence with belief |
| Lore/rules/canon reference text; imports, editors, keyword enrichment | `.lore.json`; raw lore/rules/canon text and settings in `.state.json`; lore save triggers optional embeddings | Reference files/text, chunk IDs/string references; active world-lore drafts live in browser localStorage | Existing raw/chunk forms may disagree; preserve separately; do not invent Phase 8 Markdown/frontmatter schema |
| Generic/mod/first-party tables; host facade, sandbox journal, mod compute/native/UI, hydration seeding | `tableRegistry.js`, `modTableRegistry.js`, `.mod-<modId>-<table>.json`; five retained `.enemy*.json`; `.migrations.json` adoption ledger | Generic legacy tables are current module state; `context.arcs` may precede `mod.arc.arcs`; registry does not enumerate every on-disk leftover | Full overwrites, dynamic registration, read-time adoption; hyphen split ambiguous without descriptor; collision/lost installed mod must not lose raw file coverage |
| Overworld/map projections | map slice/routes and bundled worldmap -> `.overworld.json` plus worldmap table files | Existing world map and journey/projection owners; gameplay remains legacy | Independent files; generated map/movement state may disagree; preserve/report, do not reconcile mechanically here |
| Derived vector/retrieval state | `vectorService.js`/`vectorStore.js` -> shared `data/embeddings.db`, vec0 archive/lore/rules and `embedding_meta` | Non-authoritative optional indexes, keyed by legacy campaign/item IDs | Existing better-sqlite3 + sqlite-vec singleton, WAL, dimension-driven rebuild; never copy as authority or require for migration |
| Authority control | `authorityControlStore.js` -> `authority/<id>.authority.json`, `.lock`, `.tmp` | Strict canonical campaign/domain transition document, revision counter; **dormant** | Exclusive file lock/revision and file fsync+rename; not atomic with data or replay; missing means absence, not proof of never-adopted status |
| Assets/attachments/cover/gallery | asset upload/download -> dev `public/assets/portraits` or production `data/portraits`; scene images -> `campaigns/<id>/scene-images`; some data URLs in state/meta | Campaign presentation references and external local files, not vectors; shared portraits may serve multiple campaigns | Legacy file enumeration does not capture these directories; manifest must resolve allowed local references without network downloads |
| App settings, provider secrets, UI drafts/caches | settings helpers -> encrypted IndexedDB providers plus server settings; `KeyVault`; browser UI/localStorage/IDB | App-level settings/vault; not campaign migration data | Exclude `settings.json`, vaults/remembered keys, local eval config, provider transports, prompt diagnostics and unrelated browser stores |

Additional source observations:

- `campaignHydrator.ts` parallel-loads sources and can write divergence upgrades, chapter scene-ID backfills, PC migration, inventory normalization, orphan swipe cleanup, scene-stamp recovery and context-to-Arc movement. Mod-table GET calls `adoptLegacyTable`; timeline GET can create timeline; chapter GET can write repairs. Migration must read bytes directly from the sealed snapshot, never these APIs.
- `campaignFileNames()` derives 21 built-in suffixes plus registered descriptors. `campaignFiles()`/`computeCampaignHash()` do not independently scan unknown mod leftovers. Existing hash is MD5 over concatenated present contents, lacks a path/presence manifest, and is not a migration source revision.
- First-party declarations currently contain Arc `arcs`; enemies `compendium`, `instances`, `encounters`, `resolutions`, `config`; worldmap `anchors`, `settings`, `visited`, `journey`, `position`, `trails`, `discoveries`, `encounters`, `exploration`, `roads` (16 tables). “Absent” is legitimate for unused features; expected presence depends on source references, adoption ledger and actual files, not whether a mod is currently enabled.
- Existing backup is synchronous file copying to `backups/<id>/<timestamp>` with `meta.json`; restore creates a pre-restore backup, replaces recognized files and removes recognized files missing from backup, retaining campaign metadata, then purges orphan scene vectors. It is neither a global snapshot barrier nor a SQLite/lore/assets/control backup.
- Portable export is version-1 JSON, parses archive prose into scenes and reconstructs it using locale timestamps on import. It explicitly includes state/lore/NPCs/index/chapters/facts/timeline/entities/relationships, transferable descriptors, unknown mod files, retained enemy files and adoption ledger. It does not explicitly include `.divergence.json` or `.overworld.json`, physical assets or Phase 1 authority sidecars. Export/import is not byte-preserving source acquisition.
- Portable import chooses a new filesystem uid on metadata collision, otherwise retains the legacy key, and writes files sequentially before background re-embedding. It has no all-files transaction or canonical campaign remap. No distinct server campaign-copy, storage-key rename or move API was found; export/import is the effective copy/transfer route. Form rename changes `name` with the same `id`. NPC/archive rename is a different semantic operation and does rewrite history.
- Campaign delete removes recognized files and campaign vectors, not authority sidecars, backups, every unknown table, or scene-image directory. These leftovers must never be adopted into a newly created campaign by matching a name or reused storage key.
- `AI_CODEBASE_MAP.md` contains useful boundaries but some topology/count/tool descriptions are historical. In this checkout `scripts/patch-graph-imports.mjs`, Electron source and `build-server.mjs` are absent/ignored. Do not treat them as available infrastructure.

The eight competition groups remain `archive-editors`, `chapter-editors`, `derived-assertions`, `health-overlap`, `inventory-writers`, `npc-writers`, `presence-writers`, and `relationship-memory-writers`. Phase 2 does not resolve or retire any group. Preserve the semantic producer/sink distinction when adding the importer.

Inspection anchors for implementation/review:

- Live state and saves: [store composition](../../src/store/useAppStore.ts), [campaign slice](../../src/store/slices/campaignSlice.ts), [chat slice](../../src/store/slices/chatSlice.ts), [serialization/client IO](../../src/store/campaignStore.ts), [hydration/repair](../../src/store/campaignHydrator.ts), [pending commit/recovery](../../src/services/turn/pendingCommit.ts).
- Server persistence: [file paths/primitives](../../server/lib/fileStore.js), [campaign routes](../../server/routes/campaigns.js), [archive service](../../server/services/archiveService.js), [archive repository](../../server/services/archiveRepository.js), [write lock](../../server/lib/writeLock.js), [chapter routes](../../server/routes/chapters.js), [timeline](../../server/routes/timeline.js), [facts/entities](../../server/routes/facts.js), [divergence](../../server/routes/divergence.js), [overworld](../../server/routes/overworld.js).
- Modules and recovery: [table registry](../../server/lib/tableRegistry.js), [mod file enumeration](../../server/lib/modTableRegistry.js), [retained tables](../../server/lib/legacyTables.js), [adoption](../../server/lib/legacyAdoption.js), [backup](../../server/services/backup.js), [backup routes](../../server/routes/backups.js), [transfer](../../server/routes/transfer.js), [authority sidecar](../../server/lib/authorityControlStore.js), [vector store](../../server/lib/vectorStore.js).
- Contracts/gates: [identity](../../packages/engine/src/contracts/identity.ts), [ContextRecord](../../packages/engine/src/contracts/contextRecord.ts), [mutation envelope](../../packages/engine/src/contracts/mutation.ts), [router](../../packages/engine/src/contracts/authorityRouter.ts), [transition policy](../../packages/engine/src/contracts/authorityTransition.ts), [control document](../../packages/engine/src/contracts/authorityControl.ts), [writer inventory](../architecture/writer-inventory.json), [scanner](../../scripts/architecture/surfaces.mjs).

## C. Phase 2 target domains

“Import” below means an offline copy into staging/reports. There is no live migrated-domain owner, compatibility fallback for play, writer retirement, cutover sequence, or first authoritative SQLite gameplay write in this phase.

| Imported source family | Current representation / writers / path | Phase 2 target / adapter and inspection reads | Later cutover and verification boundary |
| --- | --- | --- | --- |
| Campaign identity/catalog | Form/hub/state route; `<id>.json` | Staged metadata and declared identity map; raw legacy ID retained; identity adapter returns canonical reference only for validated explicit identity, otherwise compatibility | Phase 4 adopts identity; verify metadata key/path correspondence; no ID derivation from name |
| Chat/archive/index/chapters/pins | Chat/pending/post-turn/archive/chapter writers; `.state.json`, `.archive.*` | Source-item staging with exact order, prose slices and parsed fields, index links, chapter/editorial metadata and pins; evidence adapter | Phase 3 supplies draft semantics, Phase 4 canonical evidence schema; count/hash/order/chat-scene/index/chapter checks now |
| NPC/location/entity identifiers and state-file inventory | Slices, UI, models/engines and entity registry; `.npcs.json`, `.locations.json`, `.entities.json`, `.state.json` | Raw explicit identifiers, records and field-path inventory plus unresolved link candidates; identifier/state adapters | Typed critical state at 4A2/4B2; NPC 5A and map 5D later; no health/location/ownership inference or name-based merges |
| Facts/timeline/divergence | Mixed user/model/heuristic writers; corresponding files | Opaque JSON items with classifications and original references; assertion adapter | Semantics/epistemics later; reconcile every entry, lifecycle flags and explicit reference; do not create a universal fact schema |
| Relationship files | Manual/model writers; both dedicated collections | Staged directed records and source fields, including duplicates as separate snapshot occurrences; relationship adapter | Domain redesign at 5A/6 boundaries; no belief adoption; verify scene and participant references without inventing entity identity |
| Mod/custom/retained state | Mod/native/sandbox/hydration/adoption; descriptor and on-disk files, `context.arcs`, retained enemy files/ledger | Opaque whole-table payloads plus item/table inventory and coverage report; descriptor-aware adapter with raw-filename fallback | Typed domain importers in 5B/5C/5D; preserve disabled/uninstalled/unknown data; no premature schema or adoption execution |
| Lore/assets and authority-control material | Reference/UI/media sinks and dormant control sidecar | External manifest with hashes and payloads; strict control-document copy/validation; no live adoption | Foundation recovery proof now; source version must be revalidated before 4B2; final lore schema Phase 8 |

Target owner of every staging row/report is the migration artifact service, with operational authority over that artifact only. Fictional ownership stays legacy. Each adapter reads only the manifest-addressed snapshot and emits source-versioned inspection data (F). Rollback is discarding/quarantining the staging artifact; there is no data merge-back. Before any later live cutover, acquire a fresh quiesced snapshot and rerun applicable import/verification/restore gates. A Phase 2 success cannot authorize use of a stale snapshot.

Everything used for normal play stays legacy: accepted archive, pending/swipe/chat arrays, context and structured mirrors, core identity/presence/health/inventory, NPC/agency/process/relationship state, facts/timeline/divergence/`knownBy`, chapters, worldmap/enemies/arcs/mod tables, reference storage and current retrieval. The vector DB stays derived and separate.

## D. SQLite/storage design

Use the already locked `better-sqlite3` dependency. Do not add an ORM, new database dependency, global campaign-fiction DB, vector extension, cloud service or distributed coordination layer. Current SQLite production use is `server/lib/vectorStore.js` (and rules routes using its handle): shared `data/embeddings.db`, three vector tables plus metadata, not a reusable campaign migration foundation.

New layout, with validated filesystem-safe artifact/run keys rather than `sid:...` strings in Windows paths:

```text
DATA_DIR/migration-staging/<artifactKey>/
  snapshot/manifest.json             # sealed source manifest + identity declaration
  snapshot/source/campaigns/...      # exact campaign source bytes
  snapshot/source/authority/...      # control material, if present
  snapshot/objects/<sha256>          # referenced local lore/assets
  work/campaign.sqlite              # disposable DB; WAL/SHM belong here
  reports/<runId>.json and .md
  backups/<backupKey>/               # manifest + consistent DB + external objects
  restore-drills/<drillKey>/         # isolated, never under live campaigns/
```

One DB per converted campaign snapshot/artifact; multiple attempts can be recorded in it. This proves the future per-campaign transaction boundary without changing live storage layout. No lookup from a campaign's display name or legacy storage key auto-opens this DB. A sealed snapshot can outlive a failed DB attempt. No new SQLite file is placed in the suffix-driven legacy campaign set or served through asset routes.

`CampaignDb` accepts an explicit resolved path, mode (`create-staging`, `inspect-readonly`, `upgrade-disposable-copy`) and expected artifact/campaign/manifest identity. Creation refuses existing unexplained files. Inspection uses file-must-exist/read-only behavior and never upgrades automatically. Validate artifact format, SQLite identity/application marker, schema version/checksums and campaign binding on open. Read errors/corruption are typed diagnostics, never “empty database” fallback.

Enable and assert `foreign_keys=ON` for every connection; use `journal_mode=WAL` for local writable staging DBs and `synchronous=FULL`; set a finite busy timeout (initial policy 5 seconds). Refuse unsupported WAL mode for this workflow with a clear conversion-only error rather than silently claiming the same guarantees. Read-only inspection does not attempt journal-mode changes. These are local filesystem assumptions, not support for network shares or concurrent sync tools.

One migration process/connection owns a writable artifact at a time, guarded by an exclusive artifact lease; bounded read-only inspection is allowed once a run is published. Use synchronous `db.transaction(...).immediate()` for mutation/schema units; never `await`, fetch assets, hash whole source trees or call inference inside a SQL transaction. The installed transaction wrapper explicitly rejects a promise-returning callback. Separate runs/sources can be staged in bounded transactions; only finalized runs are consumable. The final verification marker and its report digest are committed together.

Open lazily for CLI operations, close statements/handles in `finally`, and close on normal interruption before releasing leases. A process crash may leave WAL/SHM/lease state: preserve it for SQLite recovery and diagnosis. Never delete WAL as cleanup before recovering/closing the DB. Backup uses `db.backup()`; do not copy an open `.sqlite` file alone. No change to vectorStore's connection singleton or startup behavior is needed.

The migration runner is the sole DDL path. `schema_migrations` records ordered version, migration name and checked source checksum; the version marker changes in the same transaction as DDL/data migration. Reject gaps, altered applied checksums and newer schemas. Forward tests cover every supported prior schema, an intentionally failing migration, reopen, and idempotent rerun. Upgrade a disposable copy of a previously published artifact; never mutate the sole verified recovery artifact in place. No down-migration promise: discard a new failed copy or retain the prior artifact.

Tests inject temporary DATA_DIR/asset roots and explicit paths before module imports, reset singleton registries/env/module cache, close all native handles before Windows cleanup, and use synthetic campaigns only. New DB services should prefer dependency-injected roots over importing production globals. Child-process crash tests use their own roots, never the developer's campaign data.

## E. Schema design

These are operational/staging schemas, not future fictional-domain tables. SQL names below are concrete proposed names; column refinements may stay within these responsibilities during implementation.

| Table | Minimum columns / constraints and indexes | Purpose / tradeoff |
| --- | --- | --- |
| `schema_migrations` | integer version PK, name, checksum; version metadata | Only schema authority; no wall-clock value used as content/version identity |
| `staging_campaign` | singleton key, declared canonical campaign ID, legacy storage locator, artifact/snapshot ID, manifest hash, artifact format, identity disposition | Campaign binding for the **import copy**; not live adoption or canonical-head state |
| `migration_runs` | run ID PK, snapshot/manifest hash, importer+verifier versions, status, run revision, report digest, blocking count | Operational status with expected-version checks; persisted statuses distinguish incomplete, imported and verified/blocked. Restore-tested eligibility is derived from the matching external proof, not a post-backup mutation of this row |
| `migration_sources` | composite `(run_id, source_id)` PK/FK, relative path, family, presence/read/parse status, raw SHA-256, byte length, expected/observed/staged count, source version, descriptor provenance | Includes expected absent files; hashes bind names/presence/bytes through manifest, not concatenated contents |
| `staged_records` | `(run_id, source_id, locator)` PK/FK, kind, ordinal, original key nullable, compatibility reference, existing canonical reference nullable, payload encoding + payload, semantic hash | JSON/text/slices are deliberately opaque; unknown fields survive; unique source occurrence retained even for duplicate legacy IDs. Index `(run_id, kind, ordinal)` and explicit identifier lookup |
| `staged_links` | source record FK, relation/ordinal, raw target locator/key, resolved target FK nullable, resolution disposition | Validates known references while retaining unresolved/name-only links honestly; no global world/knowledge graph |
| `migration_findings` | finding ID PK, run/source/locator refs, code, severity CHECK, disposition, concise evidence, blocking rationale | Severity exactly informational/warning/cutover-blocking; blocker resolution is recorded evidence/reverification, not a boolean override |
| `domain_authority` | run/domain PK, validated `AuthorityTransitionState` JSON, copied-control revision/source hash if any, `scope='staging-only'` | Reuses strict Phase 1 state and projection. Legacy/shadow only for fictional domains in this artifact; cannot authorize live routing |
| `migration_command_outcomes` | unique campaign/domain/idempotency-mode/logical-key, original canonical semantic request, applied owner/epoch, outcome/version | Small durable ledger for the narrow **operational staging** command adapter in G/H; no gameplay event stream or provider request data |

Records from state-file inventories can identify a field or collection as a source item without making it a typed-state repository. Mod-table staging retains the complete table plus inventory; item inventory links to its payload and must not double-count records in reconciliation. Raw source bytes remain the lossless fallback in the sealed snapshot; payload JSON is an inspectable staging representation, not a replacement for those bytes.

Provenance is source FK + original locator + run, with path/hash obtained by a mandatory join. Missing provenance fails publication. Occurrence locators such as a snapshot JSON pointer or archive byte range disambiguate source occurrences only; they do not create canonical entity IDs. `staged_links` enforces references among staging rows where resolvable, while semantic dangling links remain explicit findings rather than disappearing to satisfy foreign keys.

Use SQLite constraints for required fields, run/source identity, severity/status enums, unique locators and FK integrity. Validate StableId/reference/control values through Phase 1 runtime parsers at repository boundaries; branded TypeScript types alone do not validate disk input. Use parameters for values. No `turns`, `canonical_head`, final `entities`, health, inventory ownership, epistemics, FTS/retrieval, narrator-direction or generalized fact schema in Phase 2. Commit IDs belong to later canonical schemas; a migration-run revision is not a fictional commit.

Versioned external interfaces: `SourceManifest`, `MigrationPlan`, `MigrationReport`, `BackupManifest`, `RestoreVerificationReport`, and `CampaignDb`. Each includes explicit format and producer versions and immutable binding IDs/hashes. Report readers reject unknown required versions/statuses instead of inferring success.

Define each digest over an explicitly versioned canonical body, excluding its own digest field/envelope. In particular, a report body does not include the DB's stored report digest or a future restore proof; the DB stores the hash of that body. A source/backup manifest similarly does not hash its own digest field. This prevents self-referential hashing and makes independent verification reproducible.

## F. Stable identity / compatibility-read design

### Identity policy

Current `Campaign.id`, message IDs, numeric scenes, entity counters and NPC/place/mod IDs are not Phase 1 StableIds. No source-wide canonical identity map is implemented. The importer must not cast them, hash names/content into canonical identity, use array indices as canonical keys, or assume an `ent_*` row identifies the same NPC ledger row by name.

If source carries a validated explicit canonical campaign/child map with independently verified binding, preserve those IDs and scope exactly. A mismatched child campaign, duplicate canonical ID, incompatible map or unsupported binding is blocking. A dormant sidecar's filename alone is not evidence sufficient to bind canonical identity to a legacy campaign.

For the usual campaign with no canonical mapping, snapshot acquisition declares a **new identity for the disposable import copy**, allocated once from an explicit generated import-copy UUID through `createStableId({kind:'campaign', campaign:ROOT_CAMPAIGN_SCOPE, namespace:'migration.import-copy.v1', key:...})`. Store that allocation in the sealed manifest before any DB work. It is new, declared identity, not recovered historical continuity or live adoption. Rerunning/restarting/restoring the same snapshot reuses it. A new independent snapshot gets its own declaration unless an explicit validated lineage map is supplied; do not opportunistically join it to a previous import by storage key or content. Later Phase 4 must explicitly adopt a verified map or allocate its own canonical identity with recorded correspondence; it cannot mistake this copy ID for proof of live identity.

Legacy child items remain compatibility references in Phase 2. Build complete locator sets per source scope with `createCompatibilityReferences`, using immutable snapshot/manifest revision, source family/namespace, and original locator. Preserve raw IDs separately for candidate links. Duplicate legacy keys get distinct **source occurrence** locators plus a blocker for ambiguous identity, never duplicate canonical allocation, deduplication or inferred merge. Missing IDs and relationships keyed only by name/MC sentinel stay compatibility/unresolved. Existing valid canonical child IDs are retained only after campaign and uniqueness validation. No child IDs are allocated merely to fill staging rows.

### Source versions and read adapters

Every adapter in C exposes inspection as `ContextRecord<K,P>` with its existing `SourceReference`, `sourceVersion`, `RecordClassification` and read-only content. Do not add a competing citation/provenance envelope. A DB/manifest row may store operational source path, run and hash alongside that projection without changing the ContextRecord contract.

- Manifest identity includes sorted relative paths, presence, raw SHA-256 and size, format/inventory policy and declared identity bindings. Use canonical serialization and a SHA-256 manifest digest. Snapshot ID is independently explicit. Timestamps, mtimes and source schema numbers are diagnostics, not revisions.
- Compatibility reference `version` is the immutable snapshot/manifest revision; its `scope` is snapshot with the snapshot ID. `ContextRecord.sourceVersion` is an opaque token derived from the exact source file hash, e.g. `sha256:<raw-digest>`; collection/header reads can cite the manifest digest. Identity scope and content version remain separate values as Phase 1 requires.
- Read from the sealed snapshot or a verified DB row bound to that manifest; recalculate/validate relevant hashes before consuming potentially altered artifacts. `expectedSourceVersion` mismatch returns a typed stale-source error and no data, never an older/current mixed projection. Missing/corrupt sources return explicit source status and findings, not `[]`.
- Narrative archive content is historical evidence; pending messages/swipes are working data; reference lore remains reference; imported instructions remain untrusted/inert. Legacy facts/relationships retain their mixed classification and provenance; they do not become tracked truth/belief. Staging itself grants no fictional authority or prompt trust.
- Reads cease only when the snapshot/artifact is explicitly discarded or its format becomes unsupported. Live legacy readers remain unchanged throughout Phase 2. No playback path calls these adapters.
- Once live legacy source changes after capture, the old snapshot is still valid **as that snapshot**, but no longer certifies current live state. Status comparison reports drift. A future cutover requires a new quiesced snapshot and verification; it cannot patch stale rows or retain an old approval. A source change during capture prevents sealing entirely.

## G. Mutation/router integration

No existing gameplay semantic writer is adapted or rerouted in Phase 2. The roadmap explicitly defers concrete gameplay mutation/acceptance integration to Phase 4A3. Retain campaign, archive, NPC, relationship, table, recovery and hydration writers as legacy, including their documented competition/debt. Do not install a nominal production router that claims to enforce ownership while old writers still bypass it.

Use Phase 1 contracts for the new, narrow migration artifact boundary:

```text
explicit conversion CLI
  -> migration command adapter (operational domain migration-staging)
  -> MutationCommand + import/migration provenance + exact source bindings
     + expected migration-staging owner / format epoch / run revision
  -> one staging-only DomainAuthorityRouter implementation
  -> staging repository transaction (rows + source/run markers + outcome)
```

Its lookup knows only the artifact's operational `migration-staging` domain, with an explicit `AuthorityView`, epoch 1 for the initial handler format and owner `migration-staging`. It has no capability to write live files or fictional domains. Source-family selection resolves the copied/declared legacy authority view for inspection; the resulting read-only ContextRecords cite exact snapshot versions. A separate staging shadow state never selects SQLite as a live gameplay repository.

Form commands in `server/services/campaignMigration.js` (or a small adjacent adapter), not UI/turn code. Kinds should be a closed, small set such as `migration.run-create`, `migration.source-stage`, and `migration.verify`. Payloads identify immutable snapshot/source hashes, importer/verifier version, run and operation; large campaign text is read by the repository from that binding, not duplicated into provenance. Origin is `import` for source import and `migration` for verification, with a registered writer ID and compatibility import/source reference. No model/current-user-action provenance is synthesized.

Expected content version comes from the persisted run revision returned by prior accepted/duplicate results; new run uses `create-if-absent`. Subsequent commands use exact run version. Owner and format epoch come from the staging lookup, never hardcoded from inventory or inferred from file schema. Command IDs use explicit campaign-scoped StableId construction with persistent run/operation identity. Caller keys are stored by the job coordinator and distinguish run, operation, source and importer/verifier semantics. They never include owner/epoch as a replay namespace. Deterministic semantic serialization is versioned.

Malformed envelopes, reused keys with altered semantics, stale run/source versions, wrong owner/epoch, unsupported domains and writes-disabled views surface as typed failures with CLI exit/report status. Do not silently rebase a mutation or retry with a new key. A source-stage command can retry after inspection with the same identity; the original outcome is returned if already applied. Incomplete physical snapshot/backup publication is handled by the artifact protocol, not by pretending external file copies are one SQL command.

This is one internal coordinator and one staging capability, not a generalized command bus. Reuse the public engine exports and guards; no parallel identity/mutation model, changes to Story proposals, or contract-breaking optional replay mode. Whether artifact IO is called from CLI now or a narrow explicit preview API later, the same service boundary applies. A new migrations HTTP router is **not required** for Phase 2; do not collide with the existing `/campaigns/:id/migrations` adoption-ledger endpoint.

## H. Replay/idempotency durability

**Full production gameplay replay persistence is not required in Phase 2:** no gameplay domain writes SQLite or changes owner, no live operation can be re-enabled by discarding its DB, and conversion only reads immutable source. The mandatory pre-live gate remains Phase 4A3/4B1/4B2 and each subsequent domain cutover. Phase 3 separately owns idempotent acceptance/recovery over legacy effects. Do not claim that a migration-run ledger implements either feature.

The staging router still must obey the Phase 1 contract: both supported idempotency modes require protection. Implement the minimum durable operational outcomes in `migration_command_outcomes`:

1. Identity is canonical import-copy campaign + operational domain + mode + original command ID/caller key. Owner/epoch are execution metadata only.
2. After envelope validation, retrieve historical outcome and compare the original semantic request **before** current owner/epoch/version/support checks. Exclude only expectedOwner/expectedFormatEpoch, and commandId for caller-key retries, exactly as the existing router contract specifies. Payload, kind, provenance, source/evidence refs, expected content precondition and other semantics must match.
3. Identical retry returns original result/version without applying again, including after run progress or owner/epoch test changes. Changed semantics under a reused key return `idempotency-key-reused`.
4. Source staging rows, completion/run revision and outcome commit in the same SQLite transaction. Crash before commit applies nothing; crash after commit/before acknowledgement recovers the original result on reopen. Partial earlier source units may exist only in an unpublished run; rerun/retry reconciles exact completed units.
5. Backup/restore carries this operational ledger with its DB. An abandoned artifact can be rebuilt from its sealed source using the same declared identities; it must be reported as reconstruction, not proof that an older lost command outcome was recovered. Do not garbage-collect outcomes within a retained artifact.

This ledger stores compact operation bindings/outcomes, not a full event stream, accepted-domain changes, provider requests, source prose duplicated as audit text or universal causal replay. Later gameplay durability must preserve logical identities through real transitions and coordinate outcomes with domain writes/latches in the same transaction; it may extend the proven primitive without treating migration commands as gameplay history.

## I. Authority-transition lifecycle

The exact Phase 1 stages are `legacy -> shadow -> sqlite -> retired`; verification and `cutoverPrepared` are fields on shadow, not new invented stages. `projectAuthorityView` keeps the legacy owner during shadow and disables writes when prepared. `retired` still routes to the new owner; it is not a state that re-enables legacy files.

Phase 2 uses a **staging-only copy** of legacy/shadow policy to label what is being compared:

```text
live campaign:       legacy ------------------------------------------> legacy
artifact domain:    legacy -> shadow -> verified shadow (unprepared)
                                      -> keep / discard / rebuild
```

For each imported fictional domain, declare its legacy owner as an aggregate legacy runtime capability, not a chosen winner among competing producers; declare proposed SQLite owner only as a future candidate. Use `transitionAuthority` for staging initialization/begin-shadow/verification. `domain_authority` carries strict `AuthorityTransitionState` values, `firstNewOwnerWrite=false`, `cutoverPrepared=false`, and scope that cannot be loaded as live control. Record verification references with exactly `{type,kind,id}`; richer findings/report material lives outside the strict reference.

No live sidecar is initialized, transitioned or “repaired” by conversion. Existing sidecar bytes are preserved in source/backup material and validated; a malformed/mismatched/unexplained advanced state blocks conversion eligibility. The existing control store remains dormant. Never use missing control files alone as proof that returning to legacy is safe.

Shadow population is a finite import of the sealed snapshot, not a continuous shadow writer beside gameplay. Read/compare only that immutable version. Verification readiness requires all declared checks plus restore proof in K/N; verification of the snapshot does not prepare a live cutover. Phase 2 tools must reject `prepare-cutover`, `commit-cutover`, `mark-new-owner-write`, `rollback`, and `retire` actions with “not supported in Phase 2.” Existing pure contract tests continue to cover pre-write rollback and post-write rejection; no production rollback UI/service is added.

At Phase 4, the implementation must re-quiesce, reimport current source, validate blockers/control/identity independently, prepare and coherently commit accepted narrative plus critical domains, then enable the first new-owner write. Retirement and later-domain lifecycles remain there. Phase 2 cannot leave a live campaign in locked prepared-shadow state or claim that discarding staging exercised true authority rollback.

## J. Atomicity / first-write-latch strategy

There is **no real authoritative cutover in Phase 2**, so no domain-write/replay/first-write-latch triple to commit for gameplay. Keep the first-write latch false for every staged fictional domain, and make production latch changes unreachable from the tooling. A staging import is not an authoritative new-owner write.

Atomic units delivered now:

- A schema migration: DDL/data plus schema version/checksum in one SQL transaction.
- A source-stage operation: staged rows/links and its run/source version/completion plus operational outcome in one SQL transaction.
- Verification publication: findings/reconciled counts, report digest and run revision/status atomically; report files are projections of committed content and can be regenerated.
- Snapshot or backup publication: write into an owned temporary directory, validate/fsync payload files and manifest, then publish on the same filesystem with a completion marker/rename. This is an artifact commit protocol, not atomicity across legacy files and SQLite. Only fully validated published artifacts are consumable.

Before 4B2, the required strategy is one campaign SQLite transaction containing authoritative data mutations, durable gameplay outcomes and the irreversible first-write latch, with authority metadata needed to recover that decision in the same transactional boundary. The file sidecar may be a projection/control input, but “write domain, then call sidecar” cannot be the correctness boundary. If a future design keeps decisive metadata outside that DB, it needs a separately reviewed crash-safe protocol before live adoption. Phase 2 deliberately does not change Phase 1's control schema, adopt the sidecar into production, or pretend its atomic rename solves cross-store coordination.

Future recovery must also have independent adoption evidence: a migrated campaign with lost metadata cannot silently reset to legacy. That evidence/control/replay/domain backup and lifecycle gate is mandatory before the first live SQLite acceptance, not an optional Phase 11 enhancement.

## K. Shadow migration and verification

### Consistent snapshot protocol

Choose offline conversion for Phase 2. Do not add an in-game freeze/admin framework or attempt to enumerate and pause every existing writer.

1. The operator stops interaction and closes all app/renderer/server processes for this DATA_DIR after ordinary saving. No conversion action commits pending prose, runs post-turn inference, repairs files or chooses a swipe. The protocol certifies **persisted source**, not unsaved renderer memory; document that distinction. Pending/failed commit markers are preserved and reported, not reconciled.
2. Add a small DATA_DIR process-lease helper shared by the server entry point and source-acquisition CLI. Acquire with exclusive creation before vault init/ensureDirs/vector startup/route work. A running server holds the lease for its lifetime; snapshot acquisition requires the same lease and refuses when busy. An artifact lease separately serializes DB operations. Write PID/random instance token/purpose for diagnostics; PID alone is not proof of ownership. Order acquisition consistently to avoid deadlock.
3. Do not steal a stale lease or delete unexplained `.tmp` files automatically. Status reports the condition; an explicit operator recovery command requires independently confirming the owning instance has stopped, then quarantines that exact lease. Older uncooperative builds, editors, arbitrary native code and filesystem sync agents are outside this lock guarantee: document they must be stopped. Hash checking detects many violations but does not replace the offline exclusion requirement.
4. Enumerate the complete source set while holding the lease. Union built-in suffixes, current declarative table descriptors, retained-source registry, a strict raw on-disk scan for campaign-prefixed unknown tables/files, related control material and explicitly referenced local assets. Read declarative manifests without executing mod code or triggering table adoption. Never use a scan helper that swallows an unreadable directory as an empty result for authoritative coverage.
5. Preflight sensitive/unsupported input in memory (S). Build the expected-presence matrix, collect raw bytes, SHA-256, size, family, descriptor/schema provenance and file status. Copy allowed bytes to a new snapshot directory, then re-enumerate/rehash source and copied payloads before sealing. Added, removed or changed files/references invalidate the capture; do not bless the last scan or retry into a mixed set. Check `.tmp` remnants, duplicate/ambiguous suffix ownership and relevant authority lock files explicitly.
6. Write canonical manifest with snapshot/import-copy identity declaration and input-policy versions. Verify every payload against it, publish only complete snapshots, then release the DATA_DIR lease. Runtime may resume legacy play now; all longer import/verify/backup work uses only snapshot bytes. Snapshot acquisition errors leave every source byte/presence unchanged.

The entry-point change is for mutual exclusion only: it opens no campaign SQLite, consults no migration DB and adds no per-turn work or provider dependency. Root startup failure with a genuine active snapshot lease is intentional bounded maintenance exclusion; a damaged staging artifact by itself never affects play.

### Reconciliation

Run an independent verifier over manifest/source expectations and actual staged rows. Share low-level parsers where appropriate, but compute expected counts/order/coverage independently enough that a dropped record in the importer is detectable. Verification must not just compare two reports emitted by the same loop.

- **Bytes and inventory:** every expected source is present/missing/corrupt with explicit status, every discovered source accounted for, raw hashes match, no unmanifested payloads. Absent optional file differs from `[]`, `null` or unreadable JSON. Unknown bytes are preserved and classified, never silently ignored.
- **JSON/items:** preserve all members, array order, lifecycle flags and opaque unknown fields. Detect parse failures, invalid shapes and lossy conversions; retain original bytes. Semantic hashes use a versioned deterministic serializer that sorts object keys only; preserve meaningful arrays, strings, nulls and numbers. Do not use runtime coercion/normalization/defaulting to manufacture equivalence.
- **Archive:** account for exact raw archive and every scene block/byte span, including preambles, malformed blocks and delimiter ambiguity. Compare extracted user/assistant prose without trimming or newline rewriting that conceals loss; use structural normalization only with an explicit rule and raw-byte evidence. Validate unique scene keys, ordering and scene/index coverage. Nonmonotonic order or gaps are reported according to actual semantics; duplicates/orphan evidence or dropped prose block eligibility. Never infer canonical revisions from similar chat text.
- **Chat/index/chapter links:** compare message and swipe order, pending markers, explicit scene stamps, pin message references, index records, chapter IDs/membership/ranges and source scene links. Preserve missing explicit fields; report ambiguities. Editorial versus derived synopsis fields retain separate classifications. Do not run chapter fitting or scene-stamp recovery.
- **Identifiers/state:** inventory all explicit IDs/field paths, detect duplicate IDs and invalid cross-campaign canonical scope, resolve only unambiguous declared relations, and retain conflicting mirrors. Names, aliases and subject strings can be candidate evidence, never proof of identity or authority selection.
- **Assertions/relationships:** count every item, preserve source/manual/knownBy/witness flags and ordering, validate scene/chapter and explicit participant references. An expected special sentinel such as `MC`, `000` or `CH00` is handled by an explicit documented legacy rule; do not turn it into an invented entity/scene. A dangling mechanically relevant/authoritative link blocks; an unresolved reference in a demonstrably derived annotation may be warning with rationale.
- **Modules:** account for all first-party descriptors, installed/disabled/uninstalled/unknown tables, the five retained enemy files, adoption ledger and `context.arcs`. Do not count retained and adopted copies as one recovered canonical record. Existing nonempty mod table versus retained source disagreements are reported with adoption provenance; never overwrite either or run adoption. Missing critical referenced table, contradictory ownership or ambiguous filename collision blocks.
- **Recovery material:** source identity/control binding, DB schema/FKs/integrity, external lore/asset hashes and backup/restore equivalence must pass. SQLite integrity alone proves none of the semantic checks above.

Finding policy: informational for exact matches, legitimate absent unused files and known representation notes; warning for optional corrupt derived/presentation data that is preserved but unparsed, missing optional image, or unresolved noncritical annotation with an explicit rationale; cutover-blocking for any unresolved authoritative mismatch, missing critical source, ambiguous identity, incomplete coverage, unsafe parse/provenance, stale source/report, invalid control binding, failed integrity or incomplete restore proof. Uncertainty about criticality is blocking until resolved. Reports may retain blocked previews; they may not report successful eligible conversion.

Verification output names source/staged counts and hashes, ordering/link results, severity/disposition, importer/verifier/schema versions, manifest/report digests, authority scope and restore-proof status. Report success means the copied representation was verified, not that current gameplay is synchronized or approved for live cutover.

## L. Existing-campaign migration

| Observed condition | Required behavior |
| --- | --- |
| No Phase 2 metadata | Open/play exactly as before. Explicit acquisition creates a new independent artifact; no live metadata/ID rewrite |
| Partially populated staging DB | Status is incomplete/unpublished. Reopen and recover SQLite, validate manifest/schema/run/outcomes; retry exact completed/source units or build a fresh owned DB from the same sealed snapshot. Never expose partial records as verified |
| Fully staged campaign after restart | Explicit inspection opens the verified artifact with file-must-exist and source/campaign binding; app still loads legacy. Restore/report proof remains linked to the original snapshot, not current live head |
| Interrupted source acquisition | Temporary snapshot is unsealed and unusable. Reacquire lease and capture anew; quarantine only owned partial output. Source unchanged |
| Interrupted import/verification | Last SQL transaction rolls back or recovers committed outcome. Missing final marker/report is incomplete, not success. Regenerate report from committed DB if projection write alone failed |
| Corrupt legacy source | Preserve bytes and report status. Optional derived corruption may warn; missing/corrupt authoritative state/prose or unknown criticality blocks eligibility. Never call `readJson` fallback/repair |
| Corrupt SQLite target | Refuse verified status; retain forensic copy; rebuild another disposable DB from sealed source. No effect on legacy play and no attempt to merge damaged DB values into it |
| Missing authority metadata | Record actual absence. In this known pre-adoption build ordinary legacy play remains the baseline; conversion does not establish a future safety fallback. If any canonical/adoption/advanced-control evidence is present but its binding/control is missing, block eligibility for recovery; ENOENT alone never resets state |
| Control malformed, wrong campaign, lock/temp unexplained or unexpectedly sqlite/retired | Preserve/control diagnostic; fail conversion eligibility closed. Do not initialize a replacement or use its data for live routing |
| Stale source version / modified snapshot | Reject the read/command and verification. Source drift after capture marks comparison to live stale; capture a new snapshot for current-state claims |
| Same snapshot rerun | Reuse manifest identity and stable compatibility locators; exact commands recover prior outcomes; no duplicate items. A new importer version produces separately versioned run/results, not silent reinterpretation of old outcomes |
| Reused human name or storage key | Never auto-associate prior staging/control/backup state. New artifact/import-copy identity is independent; any suggested lineage is explicit and verified |

Rerun determinism concerns logical staged content, references and report findings. Operational timestamps, run UUIDs and machine-local absolute paths do not enter byte-stable semantic comparison; use injected fixed IDs/clocks only in synthetic tests. Do not relabel a changed source as the same immutable snapshot.

## M. New-campaign behavior

New campaigns continue to use the existing form/character-card initialization, legacy metadata/state/ledger/table routes and runtime defaults. They do not start in SQLite and receive no automatic Phase 2 authority sidecar or canonical identity adoption. There is no hidden startup conversion or per-turn shadow importer.

An explicit preview of an empty new campaign follows exactly the existing-campaign acquisition path. Absent archive/index/relationship/mod files can be legitimate and are distinguished from corrupted or missing referenced sources. Its disposable DB has an initialized **staging-only** authority map and identity declaration; these do not alter that live campaign. An empty staging DB must also pass migration, backup, isolated restore and zero-normal-turn-DB tests.

## N. Import/export/backup/restore lifecycle

### Existing portable import/export

Retain the version-1 `.campaign` API and current legacy import behavior; Phase 2 does not introduce a post-cutover gameplay bundle. Imported legacy campaigns stay legacy-authoritative and can be captured afterwards. Import collision/copy means a new live instance with a legacy locator; no staging/control identities or outcome ledger attach by storage name. Character-card/world/roster imports also remain their existing legacy producers.

Do not silently accept an actual future SQLite-authoritative campaign as version-1 legacy state. Add a narrow fail-closed format/authority guard at the transfer boundary for explicitly declared unsupported post-cutover/SQLite/control payloads, before any destination writes. Unknown inert `mod.*` keys continue round-tripping. Do not add DB bytes, live authority metadata or a staging artifact to ordinary legacy fields and then ignore them. A dedicated Phase 2 migration artifact can be transported and inspected/restored only by the migration tool, never imported as a playable campaign.

The existing version-1 omissions identified in B are pre-existing limitations: divergence/overworld are not explicitly bundled, asset references are not physical payloads, and archive reserialization is not byte-preserving. **Do not use that API as the Phase 2 source or recovery artifact.** Report these limitations in operator documentation and lifecycle coverage tests; do not silently label the legacy format a complete backup. Broad portable-gameplay format repair/replacement is deferred, with a mandatory complete post-cutover format/guard before 4B2 and final hardening in Phase 11. Phase 2's new exported migration artifact must itself be complete for its declared snapshot scope.

### Staging recovery artifact

`BackupManifest` includes artifact/schema/tool versions; declared import-copy and any validated source canonical identities; snapshot/manifest digest; DB backup digest; source inventory and presence/hashes; report/findings/eligibility digest; operational outcomes; staging-only authority map/control-source bytes and their binding; external object manifest and payload hashes; excluded derived/vector scope. Include the sealed legacy snapshot or its complete payload closure in the portable recovery artifact, not a pointer to a developer-only directory. Lore is currently `.lore.json` and raw state text, not assumed `lore/` Markdown; preserve those actual representations.

Use SQLite backup API to a new temporary destination while holding the artifact writer lease. Finalize the run/report state first; do not mutate the source DB during capture. Copy immutable snapshot/external objects, hash everything and publish manifest/completion only after validation. No vectors, settings, vaults, provider configuration or machine-local live config. Never rely on copying only `campaign.sqlite` while WAL may hold committed rows.

Restore proof is a required operation, not a backup checkbox:

1. Allocate a fresh isolated root outside live campaigns/authority; refuse overwrite and path escapes. Restore only allowlisted manifest members, never archive-provided arbitrary paths/symlinks.
2. Verify every payload digest before opening the restored DB. Close the original handle; make original locations unavailable to the test/verifier so dangling external pointers cannot pass.
3. Open restored DB; verify application/artifact identity, schema history/checksums, `integrity_check` and `foreign_key_check`.
4. Independently compare restored staged counts/order/content/reference/provenance and run/outcome/authority records to source expectations, not just restored-to-backup DB counts. Validate every required lore/asset object's existence/hash from the manifest. No vector rebuild or provider access is necessary.
5. Write a separately bound `RestoreVerificationReport` naming backup digest, snapshot and report digest. Avoid a self-referential backup hash: the proof describes the completed backup and is a companion artifact. `assertImportEligible` requires this matching proof plus zero blockers; a backup cannot contain proof of its own future restore.

Keep the backed-up verified DB/report immutable while producing this proof. Status may display `restore-tested` by joining the external proof to the exact backup/report digests; do not update the backed-up DB to embed that status and then claim the earlier proof covers the changed bytes. Any subsequent data/schema/report change requires a new backup and restore proof. A copied proof for another snapshot, report, schema or backup is invalid.

Restore into isolation never touches live metadata, sidecar, data or replay state and cannot activate legacy/SQLite authority. Existing legacy timestamp backups continue functioning through their current service/routes and retain their documented limits; do not change their MD5 dedupe or format as an unrelated migration. Phase 2 adds real SQLite recovery proof now. It does **not** defer that proof to Phase 11. Coherent *live* domain/control/outcome/adoption backup and restore-to-play remains an explicit pre-4B2 requirement because Phase 2 creates none of that authority.

## O. Rename/copy/transfer/delete lifecycle

| Operation | Current path | Phase 2 policy and evidence |
| --- | --- | --- |
| Display rename | `useCampaignForm` edits campaign.name with same storage id | No filesystem DB rekey. Captured snapshot retains old metadata/version; a new capture records rename. Copy identity never derives from name |
| Storage-key rename/move | No dedicated API found | Do not add one. Manual moves must be recaptured as new/unproven lineage; no lookup by old key attaches artifacts/control |
| Duplicate/copy | Effectively export/import with collision uid | New live instance does not inherit staging identity, shadow state or outcomes. Import cannot use prior artifact metadata by filename; fresh acquisition is explicit |
| Transfer between installations | Version-1 legacy bundle | Existing legacy behavior retained with limitations in N. Migration recovery bundles transfer as isolated artifacts retaining their declared copy identity and provenance; they are not automatically playable |
| Legacy backup restore | Backup service replaces recognized source files | Previous staging snapshot remains historical, never overlays restored files. Current-status comparison must reacquire source hashes; no cached eligibility across restore |
| Campaign delete | Campaign route deletes recognized files/vectors | Does not route into staging or activate an old artifact. Document that independent snapshots/backups remain retained recovery artifacts, like existing backups. No silent source or recovery deletion expansion |
| Explicit staging discard | New migration CLI, artifact key only | Close DB, validate resolved owned root, refuse active leases/unknown paths, quarantine or delete **only** specified disposable output; source snapshot retention is explicit. Never glob by campaign display name |
| Recreate same human name/storage key | Metadata creation/import can reuse legacy locator | No artifact auto-binding at runtime, status, or capture. If leftover unknown mod/control files make ownership ambiguous, report blocker; do not silently carry them into a new import-copy identity |

Do not opportunistically purge existing authority/backups/assets/orphan tables in Phase 2. The current delete/restore/copy gaps are catalogued migration risk, not repaired by changing ID syntax. Before real live adoption, lifecycle operations must bind immutable campaign identity, preserve/remap domain records and outcomes deliberately for transfer versus copy, coordinate control/adoption metadata, and delete or quarantine the correct owned state without storage-key reuse. Those are mandatory 4B2 readiness requirements. There is no Phase 2 live authority whose lifecycle is left unhandled.

## P. Crash/recovery strategy

| Fault injection point | Atomic guarantee / required recovery |
| --- | --- |
| Before lease / during lease acquisition | No source/DB change. Busy fails without stealing. Unexplained stale lease needs explicit recovery inspection |
| Mid source discovery/copy; file added/removed/changed | Snapshot unsealed; capture fails, preserves live bytes, and owns only temporary destination. Re-enumerate and recapture after proper quiescence |
| Mid schema migration | DDL/data/version transaction rolls back; reopen asserts old schema and data. Retain last verified artifact; never edit checksum history to proceed |
| Mid shadow/source population | Current source command transaction rolls back; earlier committed source units remain incomplete/unpublished. Retry exact command identities against same manifest |
| After population commit before acknowledgement | Reopen WAL with native SQLite; durable operational outcome returns original result/version, zero reapplication |
| Verification before/after commit, before report-file projection | Uncommitted findings/status roll back. Committed status/digest can regenerate projection; missing/incorrect digest/proof cannot be interpreted as eligible |
| Attempted prepared cutover / first new-owner write / live authority update | Phase 2 command/API rejects before any mutation; negative tests assert source/sidecar unchanged. Actual crash tests for those authority events belong to 4B1/4B2 |
| Backup API interruption/disk full | Temporary backup incomplete/unpublished; retained verified source DB/snapshot unchanged. No partially copied file accepted as recovery artifact |
| Partial restore/missing DB/object/manifest | Isolated destination remains failed/unpublished. Validate closure and clean/quarantine owned partial destination only; rerestore fresh. No live source changed |
| Corrupt DB/WAL or failed integrity | Refuse verification, preserve forensic bytes, rebuild independent staging DB from sealed source if valid. Never delete WAL pre-recovery |
| Stale run revision / command retry / reused key | Typed conflict/duplicate/malformed result with no silent rebase. Test disk reopen and changed owner/epoch semantics on operational ledger |
| Authority revision/lock/content mismatch | Conversion/control binding diagnostic and blocker; no automatic initialize/reset. Existing sidecar revision conflicts remain covered by its tests |
| Process kill while holding lease | SQL recovery and partial-artifact inspection on next explicit operation; stale lease never self-clears based only on PID reuse/mtime |
| Process crash after published artifact | Reopen verifies published manifest/DB/report/proof binding; file presence alone is insufficient |

Use child-process termination tests for commit-before-acknowledgement and interrupted import/backup, plus deterministic injected IO failures for precise boundaries. Assert both bytes and absence/presence across source files/control/assets. Test disk-full-like errors at writes/fsync/rename and SQLite commit separately; a thrown test exception is not proof of every real filesystem failure mode.

Durability claim: SQL commits follow SQLite/WAL/synchronous policy on the supported local filesystem; artifact files are flushed before publication and manifests are revalidated on use. Existing legacy tmp+rename/appends are not retroactively made power-loss safe. Node/Windows directory publication and the storage device may not provide universal power-loss ordering; do not claim hardware-loss guarantees beyond tested SQLite/filesystem behavior. Missing/incomplete artifact after an OS/storage failure is safely rejected and rebuilt from preserved source, not silently treated as valid.

## Q. Writer-inventory/static-gate changes

Update authoritative `docs/architecture/writer-inventory.json`, then generate Markdown through `node scripts/architecture/check-writers.mjs --write-report`; never edit the projection independently. Add migration semantic producer, DB/filesystem sinks, artifact snapshot/backup/restore/discard and process-lease operations with precise symbols, triggers, operational provenance, storage targets and Phase 2 scope. They own migration artifacts, not tracked campaign fiction. Existing gameplay producers keep `targetAuthoritativeOwner=false` and their migration debt/phase. Reuse `recovery-metadata` where accurate; if introducing `migration-staging` as the operational router domain, document that distinction explicitly rather than treating it as fictional authority.

Do not delete grandfathered producer/signature entries, change competition memberships to imply resolution, or claim a legacy route retired. No Phase 2 writer migration has occurred. Later phases must prove replacement routing and rejection before retiring those entries.

Add a focused static import/capability gate with synthetic violations:

- Campaign DB/staging repository imports allowed only from migration services/tooling/tests, never frontend, turn/prompt/hydration, generic gameplay routes or vectorStore. `server.js` may import only the process-lease helper, not campaign DB.
- `better-sqlite3` direct campaign use only through the new opener; preserve existing vectorStore exception. New campaign DDL must reside in versioned migrations (and test fixtures). No sqlite-vec load in campaign DB.
- Staging code cannot invoke live save/adoption/hydration/authority `apply`/restore-to-live APIs or derive a writable live target path. Conversion output path is distinct from source roots.
- Extend narrow recognition/coverage for new SQL mutation sinks and CLI operational writers. Existing scanner recognizes selected fs/mutator syntax and production roots, not arbitrary `db.prepare(...).run()` or every scripts path. Do not claim its current inventory automatically detects all SQL writes; add explicit imports/ownership coverage and violation fixtures.
- No automatic migration invocation, provider imports/calls, or per-turn artifact updates. Preserve extension/inference inventories; only exact justified signatures may change if lease wiring requires them.

Regenerate catalog projection twice and compare bytes. Run writer/extension, inference, engine purity and contract gates. Attempt the mandated import-graph refresh after import/config changes; the script is absent in this checkout, so record that known limitation without creating a substitute graph project or claiming refreshed graph evidence.

## R. Eval/test strategy

### Starting evidence from this planning pass

On the inspected HEAD, without production changes:

- `npm.cmd run eval`: five MATCH, v0 pin VALID, 30 ordinary normative passes, the same two reviewed visibility violations. Disposition v1 hash remains `760d87bd17748689666d6e35650e1a61bce1b79e8ebe357d3adb7279d9422dd7`.
- `npm.cmd run test:run -- server/__tests__/backup.test.js server/__tests__/legacyTransfer.test.ts server/__tests__/locationTransfer.test.ts server/__tests__/modTableTransfer.test.ts server/__tests__/archiveAtomicWrite.test.js server/__tests__/authorityControlStore.test.js`: six files, **71 tests pass**.
- `npm.cmd run eval:determinism -- --suite phase-1l-constrained-v1`: seven BYTE_STABLE passes, normative constrained checks pass, current candidate comparisons MATCH; constrained baseline remains UNPINNED. No pinning is inferred from completion tags.

These are current baseline checks, not Phase 2 implementation evidence. No live model smoke, full build/lint or new persistence tests were run for this documentation task. Phase 0/1/1L documents supply historical evidence and limitations, not proof of the proposed importer.

### Required implementation coverage

| Layer | Scenarios / acceptance |
| --- | --- |
| Native SQLite substrate | New/open/readonly refusal, schema forward upgrades/failure rollback, FK/integrity failures, transactions, WAL recovery, handle close, independent DATA_DIRs and no vector dependency |
| Source acquisition | Empty/small/long archive, all built-ins/first-party/unknown tables, directory-read error, source drift, app/snapshot mutual exclusion, stale lease/temp, no-source-write on all failures |
| Import/provenance | Missing versus empty/corrupt, every source/item accounted for, duplicate keys/identifiers/locators, ordering, prose delimiter ambiguity, unresolved links, state mirror disagreement, relationship sentinel, adoption/Arc overlap, invalid canonical scope |
| Compatibility reads | Correct snapshot/version/classification; stale hash/manifest refusal; canonical versus compatibility reference separation; rename/reorder/reused-key does not recover identity |
| Operational commands | Exact version conflict, duplicate original outcome after restart, same identity changed semantics rejection, owner/epoch rebound retry, commit-before-ack crash, no partially published run |
| Authority boundary | Staging legacy/shadow only; verification cannot prepare live cutover; all unsupported transition actions denied; sidecar unchanged; existing pure rollback-before-write/reject-after-write tests retained |
| Recovery | Backup from committed WAL state, close/unavailable original, isolated actual restore, schema/FK/integrity plus source expectations, missing/tampered object/control/report/outcome/schema/DB, interrupted restore, no vectors/provider required |
| Legacy lifecycle | Existing backup/restore/transfer/adoption/archive tests; current recognized-file restore removes later files and preserves metadata/pins; no staging auto-attachment under rename/import collision/delete/recreate; explicit unsupported authoritative bundle rejection before writes |
| Play/evaluation | Same prompts, provider formatting/call order, selected state, effects/writes, accepted messages and story semantics; zero campaign-DB opens/writes through real normal turn and reopening legacy campaign with staging present/absent/corrupt |
| Privacy | No settings/vault/provider transport copied; synthetic secret/debug canaries reject before artifact persistence; reports/logs contain codes/locators/hashes, never rejected values/source text |

Create fixture/test skeletons and capture before-behavior before implementing each replacement primitive. Fixtures are synthetic and include an explicitly optional corrupted file (warning/preserved), corrupted critical source (blocked), long ordered archive, both relationship files and all current first-party descriptors with source/retained overlaps. Use real filesystem+SQLite integration, not just mocked `CampaignDb`. Report verification must catch intentional count/content/order omissions introduced independently of the importer.

Add persistence-specific eval/test scenarios under an independent Phase 2 suite/artifact schema rather than altering v0 projection: source/create-stage, update/revision conflict, restart, duplicate, shadow verification, stale compatibility read, blocker disposition, isolated restore and forbidden-live-cutover. Desired hypothetical cutover/rollback-after-write scenarios are **not** Phase 2 gameplay acceptance criteria; keep existing contract tests and schedule real integrated versions at 4B1/4B2. Do not simulate them and label live persistence solved.

Routine gates: focused tests per package, all engine tests + `typecheck:contracts`, architecture/inference gates, `test:base-app-gate`, root `test:run`, frontend build, changed-file lint and `git diff --check`; current v0 and constrained determinism at package boundaries/final closure. Root lint has documented pre-existing debt; record starting diagnostics, reject new diagnostics in changed files and do not silently fix unrelated files. Run i18n only if user-visible strings change. No snapshot, v0 baseline, constrained candidate or known-violation repin to absorb persistence internals. Any v0 behavioral delta is unexpected in this phase and must be explained/fixed; representation changes are reported in separate persistence artifacts.

No required live inference rerun: the roadmap names Phase 4B2 as the next persistence/acceptance live milestone, and Phase 2 changes no playable narrative path. If work unexpectedly changes prompts/calls/gameplay, stop under U instead of using a new baseline or live sample to waive it.

## S. Performance/operational considerations

Normal save/commit behavior should have no Phase 2 campaign-DB IO, transaction count or extra serialization. Existing full-state serialization and legacy scans remain until their owning cutovers. Do not sell offline staging as a hot-path optimization. The only normal server change is bounded startup lease acquisition/release; a staging DB corruption never triggers a startup scan or blocks play.

Measure offline snapshot time/bytes, DB open/migration duration, stage/verify/backup/restore time, rows/transaction count, peak memory and disk amplification on declared empty/small/long fixtures. Reports use a separate operational timing companion, not deterministic result bytes. Use bounded per-source batches and prepared statements; no all-campaign content hashing on every turn/status request. Hash files during explicit acquisition/verification and cache only against immutable snapshot identity. Inspect/report queries use run/source/kind/ordinal indexes and bounded pages. Avoid new performance thresholds invented without measurements; record fixture size, versions and observed values for Phase 4/11 policy.

Disk-space preflight accounts for source snapshot, work DB/WAL, backup, isolated restore and asset payloads. Free-space estimates are advisory; every write still handles disk errors. Long conversion/report work runs outside Story and outside the app's active server process. No background generative queue, endpoint dependency, warmup or embedding indexing is introduced by migration. Existing embeddings remain optional and are not called as a side effect of copying sources.

Privacy boundary: campaign prose, lore, relationships and existing authoritative/working state are expected local persisted material. Global settings/provider endpoints/API keys/vaults and unrelated transient prompt/transport diagnostics are outside scope. Use an allowlisted source closure, safe relative paths and known local asset roots; do not read arbitrary paths referenced by imported data, follow symlinks outside roots, fetch remote URLs or execute mod code. Shared portrait assets are copied only when explicitly referenced and never deleted by conversion.

Preflight known credential/transport fields and transient `debugPayload`/captured request bodies before writing source snapshots/DB/reports. If such forbidden material already contaminates a legacy source, fail with a value-free diagnostic and leave the source unchanged; do not secretly scrub bytes while reporting a byte-identical import or persist a raw copy “for diagnostics.” Opaque custom tables require the same scan and honest limits; arbitrary secret-looking prose cannot be perfectly classified, so do not claim universal secret detection. Use field-aware rules to avoid rejecting legitimate fictional token/secret terminology. Errors/logs contain codes, relative locators and hashes, not full payloads, credentials or private source prose. Recovery artifacts are local private data under ignored DATA_DIR; no upload/export occurs automatically.

### Minimal developer/operator tooling

Implement one CLI, proposed `node scripts/campaign-migration.mjs <operation> ...`, calling the service layer. A broad HTTP/admin UI is unnecessary. The script must not import `server.js`, warm providers/vector models, execute native mods or start a listener.

| Operation | Contract |
| --- | --- |
| `inspect-source --campaign <storageId> --dry-run` | Requires offline lease; report expected/discovered sources and blockers without campaign writes or DB creation. Persist only requested value-free report |
| `snapshot --campaign <storageId>` | Acquire offline lease; create sealed manifest and identity declaration; no source repair |
| `import --snapshot <artifactKey>` | Create/retry owned disposable DB from sealed snapshot; explicit run/importer version; operational command replay |
| `verify --artifact <artifactKey> --run <runId>` | Independent reconciler and severity report; no cutover action |
| `status` / `report` / `mismatches` | Read-only bounded inspection, exact snapshot/version identity and restore proof; unsealed/blocked/stale statuses distinct |
| `backup --artifact <artifactKey> --run <runId>` | Publish versioned consistent staging recovery artifact |
| `restore-check --backup <backupKey>` | Restore to a newly allocated isolated root and produce bound proof |
| `retry` | Same persisted operation identity and source binding; no silent key/version changes |
| `discard --artifact <artifactKey> --dry-run` then explicit discard | Show owned paths; close/check leases; quarantine/delete only explicit disposable target, with separate snapshot-retention choice |
| `inspect-lease` / explicit stale-lease recovery | Value-free ownership diagnostics; never silently steal or clear an active/unexplained lock |

Use stable exit classes: success, blocked/ineligible preview, stale/conflict/busy, unsupported format/schema, IO/integrity failure. JSON status records carry precise codes; Markdown is a projection. Do not provide `prepare-cutover`/`commit-cutover` in Phase 2 or conflate current mod-adoption `/migrations` with this framework. A thin optional npm script may wrap the CLI; avoid new framework dependencies.

## T. Implementation packages

Implement the whole phase in **three broad packages**, each with internal tests. These are continuation checkpoints, not separately approved slices. Do not request permission between normal package transitions. The same implementation pass owns integration across all three.

### Package A — DB and immutable-source foundation

**Files/systems:** new `server/db/campaignDb.js`, `server/db/migrations/`, transaction/schema/integrity helpers; snapshot/manifest services under `server/services/campaignMigration/` as needed; small `server/lib/dataDirectoryLease.js`; startup lease wiring in `server.js`; pure versioned manifest/report guards where needed; new temporary-root tests. Reuse `fileStore.js`, table/retained registries and engine contracts as read-only inputs. Keep roots/paths injectable; no DB import in server startup.

**Implementation:** fixed artifact layout/path containment; exclusive process/artifact leases; exact offline snapshot acquisition; identity declaration; schema migration runner and E's initial metadata/staging schema; transaction/opener lifecycle and integrity; skeleton artifact backup/restore primitives using SQLite backup API. Add fixture factories and before-source/lifecycle tests before implementation. Do not move any gameplay writer or register new live migration routes.

**Tests:** native open/readonly/close and isolation, migration version/checksum failure rollback, source-byte immutability, two-process lease exclusion and stale handling, source drift detection, empty snapshot/DB, forbidden settings/credentials/path escape, no vector/provider import. Existing legacy round trips plus engine/architecture/import-boundary tests.

**Internal continuation gate:** source acquisition either seals a coherent manifest or leaves only owned incomplete output; no changed source bytes; DB upgrades transactional; startup/play never open campaign DB; existing v0 MATCH and constrained normative/deterministic behavior unchanged. Continue directly to B when green. Ordinary test failures are repaired here, not escalated as design questions.

### Package B — complete staging import, router and verification

**Files/systems:** `server/services/campaignMigration.js` coordinator; source adapters, source-versioned readers, staging repository/router and verifier; `server/repositories/migrationStagingRepository.js` or equivalent narrowly named module; E's schema migrations; compatibility/manifest/report code; synthetic campaign fixtures; architecture inventory and focused SQL/import gate. Existing archiveRepository/transfer parsers are reference material, not writable importer entry points.

**Implementation:** all C source families, full first-party/unknown/retained table coverage, original-key/occurrence provenance, source-versioned ContextRecords, compatibility identity policy, typed staging-only commands and durable outcomes, independent reconciliation and severity policy, strict staging-only transition metadata and unsupported cutover denial; JSON/Markdown report projection and fail-closed `assertImportEligible` checks. Verify reports never promote legacy evidence or select authority winners.

**Tests:** every K invariant, duplicates/missing/corrupt sources, array/prose ordering and malformed delimiter coverage, mirrors/name ambiguity, relationships even when disabled, NPC/location/entity scoping, Arc/adoption and module inventories; stale version/conflict/reused key/restart duplicate; intentional import omission detected; no live sidecar/files mutation; zero normal-turn DB opens/writes; report generation determinism.

**Internal continuation gate:** clean fixtures reconcile every expected source/item with complete provenance; dirty fixtures produce exact classified findings and cannot become eligible; rerun/restart does not duplicate; only immutable snapshot reads; no gameplay routing/authority change; current and constrained evals unchanged. Proceed to C automatically.

### Package C — actual recovery proof, lifecycle boundaries, tooling and closure

**Files/systems:** backup/restore manifest service (reuse existing backup service only where safe, retaining legacy behavior), CLI `scripts/campaign-migration.mjs`, narrow unsupported-authoritative-bundle preflight in `server/routes/transfer.js`, relevant backup/transfer boundary tests, child-process fault harness, separate persistence evaluation artifacts, `docs/eval/phase-2-status.md`, operator documentation and inventory projection. No broad portable bundle redesign or restore-to-live API.

**Implementation:** complete portable staging backup plus source/lore/assets/control/outcome closure; actual isolated restore and source-expectation verifier; bound companion restore proof and final eligibility; status/mismatch/dry-run/retry/discard/lease tooling; rename/copy/import collision/delete/reuse isolation; corruption/interruption/commit-ack recovery; performance/privacy reports; final architecture inventory and no-live-path evidence.

**Tests:** real staged WAL backup with original unavailable; all recovery/member-tamper/partial-restore failures; source/sidecar immutability; operational replay after restore; child-process crash windows; unsupported future authoritative import rejected before writes; legacy lifecycle suites unchanged; full root/engine/contracts/base-app/build/static gates, changed-file lint baseline, v0 and constrained determinism; no vectors/provider requirement.

**Internal continuation gate:** all A1–A7 evidence exists, including actual isolated restore and zero live migration; no unresolved implementation blockers or new behavioral delta; limitations and pre-4B2 gates explicit. Produce one review handoff with acceptance matrix, exact files/commands/artifacts and risks. Do not open another internal planning cycle or seven mini-slices.

### Phase closure workflow

One planning pass (this document) -> one implementation pass across A/B/C -> internal validation -> **one final independent Phase 2 review** -> narrow blocker remediation and affected-scope recheck only if needed -> normal authorized merge/tag. No independent review between packages. The implementation agent may use ordinary internal validation throughout; it must not claim that as the independent review. Merge/tag is a later authorized closure action, not performed by this planning request.

## U. Stop conditions

Interrupt autonomous implementation only when source evidence requires an architectural/user decision beyond this plan:

1. A requirement would move live authority, add normal-turn SQLite IO, change prompts/inference/gameplay, or require typed later-phase schemas to complete Phase 2.
2. Source identity/control evidence is inconsistent in a way that cannot be preserved and reported honestly without choosing live ownership, inferring identity or overwriting user data. Individual malformed fixture/campaign input is a blocked conversion, not a reason to stop the whole implementation.
3. A proposed primitive cannot meet the declared coherent snapshot, transactional schema/staging/outcome, or isolated recovery guarantee on the supported local environment without a larger coordination/topology decision.
4. Completion would require irreversible source loss, silently dropping an authoritative source, credential persistence, or restoration into live storage.
5. Phase 0/1L prompts, state/effects or inference behavior change unexpectedly and the cause cannot be corrected within persistence/tooling scope. Never repin to continue.
6. An actual post-cutover campaign/control artifact is encountered that the known pre-adoption source format cannot safely distinguish or inspect; preserve it and require the appropriate recovery/format decision.

Ordinary failing tests, lock contention, corrupt input, malformed optional files, missing script/deferred lint debt and fixable IO errors are expected engineering/reporting work. Repair implementation failures, classify source findings or retain explicit limitations; do not turn every error into an approval request.

## V. Deferred work / later-phase boundaries

- **Phase 3:** exact draft/revision/hash identity, acceptance command/recovery semantics, selected/displayed/canonical distinctions. Phase 2 preserves existing pending/swipe data without resolving it.
- **Phase 4A/4B:** canonical tables/repositories, native bounded gameplay queries, real central routing/read adapters, typed critical identity/presence/health/inventory, gameplay durable outcomes, atomic domain/outcome/latch, independent adoption evidence, coherent authority cutover and complete live export/backup/restore/lifecycle handling. First live switch remains 4B2.
- **Phase 4C:** narrator profile/direction scope/consumption and continuity routing.
- **Phases 5A–5E:** NPC/process/anchors and first-party Arc/enemy/map typed schemas/commands, shared-owner overlap resolution, frontend cache-only completion. Staging does not bless writable mirrors or generic truth tables.
- **Phase 6:** epistemic/secrecy redesign, belief adoption, `knownBy` replacement. Preserve provenance; do not translate memories/witnesses into beliefs.
- **Phases 7/8/9:** correction/rewind/sync, stable-ID lore and unified retrieval/FTS/correction filtering, final context packing/output reserves/provider benchmarking and scheduler redesign. No inference call, new cloud API, broad lore rewrite or model behavior change.
- **Phase 10:** executable-extension closure. Inspect descriptors and preserve data without expanding public capabilities or executing arbitrary module code.
- **Phase 11:** final legacy retirement, broad portable-format cleanup, scale/retention/recovery hardening and derived release ceilings. Basic staging restore proof is delivered now; live authority recovery is a pre-4B2 gate, not postponed here.

Tempting current defects—archive multi-file acceptance, swallowed saves, hydration repairs, missing export fields, module suffix ambiguities, delete leftovers, whole-state writes and context starvation—must be reported or bounded by the explicit Phase 2 artifact protocol. They are not permission to redesign runtime semantics during substrate work. A narrow unsupported-future-authority import rejection protects the new format boundary without claiming those legacy defects solved.

## W. Risks

| Risk | Control / remaining limit |
| --- | --- |
| Data loss from repair-on-read or lossy transfer parser | Read sealed bytes directly, retain raw sources, independent count/hash/order/link reconciliation; never use hydrate/export as snapshot |
| False confidence in snapshot consistency | Offline stop plus cooperating-process lease and rehash/enumeration; external/uncooperative writers explicitly excluded. Snapshot proves persisted files, not unsaved UI state |
| Split authority through “helpful” per-turn shadow or auto-open | Static/dynamic no-live-SQLite gates, artifact-only paths, no cutover operation; all gameplay writers remain legacy |
| False stable identity / duplicate IDs / storage-key reuse | Explicit import-copy allocation once, child compatibility refs, independent scope validation, no name/path-based adoption |
| Migration replay duplicates or changed semantics | Atomic staging rows/markers/outcomes, historical lookup first, exact semantic comparison and restart tests; gameplay replay expressly deferred |
| Rollback/latch overclaim | No Phase 2 real switch/latch; quarantine staging only. Mandatory same-transaction gameplay/outcome/latch and adoption evidence before 4B2 |
| Backup file exists but restore is unusable | Actual isolated restore with original unavailable; manifest closure, integrity and source expectation comparison; no raw WAL-unaware DB copy |
| Incorrect finding severity hides authoritative mismatch | Fail-closed eligibility, unknown criticality blocks, explicit codes/disposition/evidence and independent omission tests |
| Existing lifecycle omissions carry into future cutover | Separate complete staging artifact; format guard and documented legacy coverage; live lifecycle gate mandatory before 4B2 |
| Credential/debug payload persistence via raw snapshots | Allowlisted closure and field-aware preflight; refuse contaminated source before persistence; value-free errors; no provider/global settings reads |
| CPU/disk amplification or startup contention | Offline bounded conversion, measurements, explicit leases and disk preflight; no turn-path DB work |
| Tooling/docs imply readiness beyond evidence | Distinguish blocked preview, verified snapshot, restored artifact, live-currentness and live cutover; retain historical Phase 1L limitations and unpinned candidate status |

## X. Acceptance criteria

Phase 2 is complete only when all of the following are demonstrated on the final implementation:

1. All seven A1–A7 roadmap criteria pass with linked evidence and all additional scope rows have a disposition. No live gameplay domain moved authority.
2. A new campaign and an existing legacy campaign open/play without creating or opening a campaign SQLite DB, including when unrelated staging artifacts are absent, corrupt or partially populated. No normal-turn DB writes or migration/provider calls occur.
3. Offline acquisition excludes the cooperating app server, detects source drift and records a sealed manifest covering every expected/discovered source, missing status and required local object. Failure and success leave all source/control bytes and presence unchanged.
4. Empty/small/long, corrupt-optional, corrupt-critical, both relationship collections, every current first-party table, disabled/uninstalled/unknown tables, retained enemy/adoption sources and `context.arcs` cases have tested outcomes. Clean fixtures have zero unexplained omissions/duplicates/order changes; bad fixtures are classified and fail eligibility where required.
5. Every staged item has source path/hash/original locator/run provenance and a validated reference/version. Canonical/compatibility identities remain distinct; no inferred child identity, live ID rewrite or automatic storage-key lineage is introduced.
6. Native schema migration forward/failure/rerun tests pass; failed migration leaves prior committed schema/data/version intact after reopen. Unknown/newer schema and altered checksums reject.
7. Staging mutation tests prove expected owner/epoch/version behavior, unchanged-semantics duplicate recovery after restart, changed-semantics reuse rejection and atomic rows/completion/outcome durability. No claim of gameplay replay or first-write-latch implementation is made.
8. Verification and `assertImportEligible` reject every unresolved authoritative mismatch, missing critical source, stale/malformed report/version, incomplete run or failed restore. There is no general waiver that converts a blocker to success.
9. A consistent staged DB backup plus full declared source/lore/assets/control/outcome closure is actually restored into a fresh isolated root with the original unavailable. Integrity, FK, schema, identity, counts/order/content/references/provenance and object hashes match source expectations. Vectors/providers are unnecessary. Tampered/partial artifacts reject.
10. Fault tests cover source acquisition, schema/staging/verification commits, acknowledgement loss, process kill, disk error, stale lease/version and partial restore. Unsupported live cutover/first-write/control mutation operations have negative no-write tests.
11. Rename/copy/import collision/legacy restore/delete/recreate cannot auto-attach staging identity/control/outcomes. Explicit future-authoritative bundle declarations reject before legacy import writes. Existing legacy backup/transfer behavior passes its regressions and its recovery limits remain explicit.
12. Writer inventory/projection and new SQL/import gates pass; no producer retired or target authority granted by inventory. Engine purity/contracts, inference gate, relevant/full tests, build, changed-file lint policy and diff checks pass. Missing graph tooling/pre-existing lint are recorded, not falsely marked green.
13. All five current v0 scenarios remain MATCH and BYTE_STABLE with the same reviewed violations/disposition; the seven constrained cases retain normative/deterministic behavior and candidate comparison. No baseline/known-violation repin or prompt/inference change is used to absorb storage work.
14. One final independent review accepts the complete phase or identifies only narrowly remediated blockers; the final status report names measurable evidence, unresolved limitations and pre-4B2 obligations. No additional phase starts as part of closure.

## Y. Recommendation

**Phase 2 is ready for implementation under this plan.** The roadmap resolves the apparent cutover question: this is an offline, disposable substrate/import/recovery phase, not a live persistence migration. Current contracts and the passing starting regression checks are sufficient to begin the three packages once implementation is separately requested.

Implement A through C in one pass with automatic continuation at their internal gates, then one independent phase review and narrow remediation if needed. Keep gameplay authority, prompts and the opt-in Constrained Local behavior unchanged. Do not start implementation, convert a real user campaign, merge or tag during this planning pass.
