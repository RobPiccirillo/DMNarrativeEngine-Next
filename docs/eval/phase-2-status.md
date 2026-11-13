# Phase 2 implementation and review handoff

Implementation date: November 13, 2026. Scope: approved `docs/plan/phase-2-implementation-plan.md`, Packages A, B and C. This is an implementation report, not the independent Phase 2 review. **No gameplay authority moved; all gameplay reads and writes remain legacy. No Phase 3 or later implementation began.**

## Independent-review remediation amendment

The independent review found five blocking gaps in the initial implementation. The prior readiness/coverage claims below were too broad: they did not establish concurrent recovery safety, fail-closed unknown JSON criticality, these structural reference families, archive-text object closure, or configured/public asset-root restore isolation. This amendment supersedes those claims. The original implementation results remain historical evidence; they are not proof these previously missing cases passed.

All work remains on `phase/2-sqlite-substrate` at starting commit `7dea7b08f3b7f1c189dd5f8f0971eeb6c9cf8afb`, retaining the existing uncommitted Phase 2 diff. No accepted-Phase-2 commit, merge, tag, real campaign conversion, authority switch or Phase 3 work is authorized/performed.

| Prior blocker | Narrow remediation and reproducing evidence |
| --- | --- |
| Stale recovery could quarantine a replacement lease | All acquire/recover/release pathname mutations share an exclusive guard file. Inspection, exact token/fingerprint validation, liveness check and quarantine occur under that guard. A synchronized child pauses recovery A after inspection: B and acquisition are refused; after A completes, a fresh live owner survives old-token recovery and rejects a third owner. Simultaneous recovery cannot quarantine the wrong instance. A crash-held guard fails closed and requires full offline maintenance, never automatic theft. |
| Unknown valid JSON silently reached eligibility | Discovery declares criticality/disposition for every source. Filename/declarative descriptor policy is independently recomputed by verification. Unfamiliar JSON, inert-looking JSON, uninstalled/unknown tables and opaque binary bytes remain preserved but blocked as `unknown-source-criticality`. Known optional corruption and missing required sources keep their existing warning/blocker policy. Tests run blocked previews through actual backup/isolated restore and confirm eligibility rejection. |
| Real legacy structural references were skipped | `sourceMessageId` resolves only against actual state messages, not arbitrary IDs elsewhere in state. `sceneRef` is checked against legacy archive scene numbers with explicit manual/bootstrap exceptions. Chapter endpoints, actual scene counts and nonempty explicit membership/range contradictions are independently checked from source bytes. Empty next-scene placeholders and desktop unpopulated `sceneIds=[]` remain supported. Missing optional index annotations warn; critical references block. No repair, canonical identity inference or typed fictional schema was added. |
| Archive Markdown omitted referenced images | Supported Markdown image/link and quoted HTML image references are extracted from archive text as well as JSON strings. They enter drift checks, content-addressed snapshots, portable backups and actual isolated restore. Independent source re-extraction rejects an omitted object inventory even if resealed. Tests cover included/missing/changed/duplicate objects, remote/bare-prose exclusion, traversal and junction rejection, plus tampered/missing restored objects. |
| Restore could write private artifacts under served portraits | The restore guard resolves paths/existing ancestors and rejects equal/ancestor/descendant overlaps with all of DATA_DIR, its campaign/control/assets, configured asset roots, the development project/public tree and supplied additional served roots before mkdir/write. Vite serves project files outside its DATA_DIR deny rule; the project root is therefore protected too. Actual CLI portrait configuration is propagated; the service requires explicit asset configuration. Default drills are outside DATA_DIR and the project. Tests spy on mkdir for protected destinations and exercise the actual CLI with a custom portrait root, safe sibling, project-root variants and junction alias. |

Focused regressions are in `campaignMigrationLeaseRace.test.js`, `migrationLeaseChild.mjs` and `campaignMigrationReview.test.js`; existing import/recovery fixtures now use the stricter policy/configuration. The former all-family test no longer labels an unclassified uninstalled table as eligible: it preserves/read-verifies it while asserting the blocker. Replay, identity, SQL transaction and staging-only authority contracts are unchanged.

Remediation files (the remainder of the prior Phase 2 diff is retained):

```text
docs/eval/phase-2-status.md
docs/phase-2-migration-operations.md
docs/architecture/writer-inventory.json
docs/architecture/writer-inventory.md
eslint.config.js
scripts/campaign-migration.mjs
scripts/phase2/evaluate-persistence.mjs
server/lib/dataDirectoryLease.js
server/repositories/migrationStagingRepository.js
server/services/campaignMigration/artifact.js
server/services/campaignMigration/assetReferences.js
server/services/campaignMigration/sourcePolicy.js
server/services/campaignMigration/snapshot.js
server/services/campaignMigration/readers.js
server/services/campaignMigration/verifier.js
server/services/campaignMigration/recovery.js
server/__tests__/campaignMigrationImport.test.js
server/__tests__/campaignMigrationRecovery.test.js
server/__tests__/campaignMigrationLeaseRace.test.js
server/__tests__/campaignMigrationReview.test.js
server/__tests__/migrationLeaseChild.mjs
```

Validation: the focused suite passes **8 files / 50 tests**, including all five reproductions. The lease inventory/projection includes the guard writer; no legacy gameplay writer/competition membership/authority grant changed.

| Remediation validation | Result |
| --- | --- |
| `npm run test:phase2 -- --maxWorkers=4` | PASS: 8 files, 50 tests; final affected-scope rerun includes development-project root protection |
| `npm run test:run -- --maxWorkers=4` | PASS: 423 files, 5,678 tests; one existing skipped file/test |
| Selected backup / legacy transfer / location / mod table / archive atomic-write / authority-control tests | PASS: 6 files, 71 tests |
| Engine tests / platform purity | PASS: 11 files, 456 tests; boundary gate PASS |
| Engine contract typecheck | PASS |
| Architecture tests | PASS: 6 files, 95 tests |
| `check:architecture`, `check:migration`, `check:inference` | PASS; existing dynamic/native unverified limitation retained |
| `npm run build` | PASS, existing chunk/static-dynamic import warnings retained |
| Changed-file ESLint | PASS, zero diagnostics |
| `npm run eval:phase2` | PASS: empty / 5-scene / 250-scene fixtures reach eligible-snapshot-only after real restore |
| `npm run eval` / `npm run eval:determinism` | All five current scenarios MATCH / BYTE_STABLE; v0 pin VALID; same two reviewed violations |
| `npm run eval:determinism -- --suite phase-1l-constrained-v1` | All seven MATCH / BYTE_STABLE; normative checks pass; constrained baseline remains UNPINNED |
| `git diff --check` | PASS |
| Dependency graph refresh | Attempted; `scripts/patch-graph-imports.mjs` remains absent, the previously documented checkout limitation |

No Phase 0/1L fixture, candidate/behavioral baseline, known-violation disposition, prompt or inference call/order was changed or repinned. Review disposition remains v1 hash `760d87bd17748689666d6e35650e1a61bce1b79e8ebe357d3adb7279d9422dd7`. No live LLM smoke was needed/run. Broader tests followed the shared lease change; subsequent migration-only root/reference checks received focused native regression reruns.

Remaining nonblocking notes: metadata-only status does not establish live freshness; dedicated killed-acquisition and corrupt-WAL cases remain recommended (not claimed as delivered); existing legacy transfer omissions and dynamic/aliased static-analysis limits remain. Prior report/proof presence is never grandfathered into success: current validation must pass, and snapshots missing text-referenced objects need fresh capture. A matching source run cannot silently change replay semantics; use an explicit fresh run/snapshot when prior validation is stale.

**Next step: blocker-focused independent recheck only.** All five fixes are implemented with focused passing regressions; acceptance remains pending that recheck. No candidate/behavioral baseline or reviewed known-violation disposition is changed.

## 1. Starting source and checkpoints

Started with a clean tree on `phase/2-sqlite-substrate`, commit `7dea7b08f3b7f1c189dd5f8f0971eeb6c9cf8afb`. Remained on that branch. No implementation commits, merge, tag, baseline repin or real campaign conversion was performed. The implementation remains a single reviewable working-tree diff.

Package A's native foundation checks passed before continuation: raw-byte/presence preservation, readonly/native lifecycle, migration failure rollback, lease exclusion, drift and privacy rejection. Existing legacy persistence regressions passed 71 tests. Package B's initial six import tests passed after fixing SQL binding counts and correcting descriptor inventory expectations (16 first-party tables plus other installed descriptors); omission/replay/blocked-preview checks passed. Package C added real isolated restores, real WAL backup, killed-process recovery, lifecycle/tooling and broader fault checks. Initial focused coverage was 34 tests; the remediation suite is now 50 tests as recorded above. Ordinary implementation/test errors were repaired without changing authority or requesting package approvals.

## 2. Exact changed files

```text
docs/architecture/writer-inventory.json
docs/architecture/writer-inventory.md
docs/eval/phase-2-status.md
docs/phase-2-migration-operations.md
eslint.config.js
package.json
packages/engine/package.json
scripts/architecture/check-migration.mjs
scripts/architecture/inventory.mjs
scripts/architecture/surfaces.mjs
scripts/campaign-migration.mjs
scripts/phase2/evaluate-persistence.mjs
server.js
server/routes/transfer.js
server/lib/dataDirectoryLease.js
server/lib/legacyBundleGuard.js
server/db/campaignDb.js
server/db/migrations/001-staging.js
server/repositories/migrationStagingRepository.js
server/services/campaignMigration.js
server/services/campaignMigration/artifact.js
server/services/campaignMigration/readers.js
server/services/campaignMigration/recovery.js
server/services/campaignMigration/snapshot.js
server/services/campaignMigration/verifier.js
server/__tests__/campaignMigrationFaults.test.js
server/__tests__/campaignMigrationFoundation.test.js
server/__tests__/campaignMigrationImport.test.js
server/__tests__/campaignMigrationLegacyBoundary.test.ts
server/__tests__/campaignMigrationRecovery.test.js
server/__tests__/migrationCrashChild.mjs
server/__tests__/migrationFixtures.js
src/architecture/__tests__/migrationBoundary.test.ts
```

Generated inference Markdown was refreshed for validation and has no substantive change. The existing golden test rewrites its snapshot's line endings during a full test run; its normalized content was checked against HEAD and original bytes restored. No golden/eval baseline change is part of this diff.

## 3. Artifact layout and schema

Default artifact layout is `DATA_DIR/migration-staging/<artifactKey>/`, with injectable roots. It contains `snapshot/manifest.json`, exact `snapshot/source/{campaigns,authority}/` bytes, content-addressed `snapshot/objects/`, `work/campaign.sqlite`, run JSON/Markdown `reports/` and versioned `backups/`. New isolated restore drills are allocated outside DATA_DIR and the development project, as corrected in the amendment; an old internal `restore-drills/` is retained only for forensic inspection/quarantine. Temporary capture/backup output has a `.partial` suffix and cannot be consumed. Leases and explicitly quarantined forensic artifacts are separate from the live suffix-driven campaign file set.

The explicit native opener validates application marker `0x444d4e32`, binding identity, schema/checksums and foreign keys. Writable staging uses WAL, FULL synchronous mode and a finite 5-second busy timeout. Readonly inspection requires an existing DB and never creates/upgrades it. Native handles close in `finally`; asynchronous SQL callbacks are rejected. Schema 1 is the initial supported staging schema; there is no published older campaign schema to upgrade. The runner transactionally applies DDL and checksummed history, rejects gaps/altered/newer histories, and supports empty-to-current and injected-failure rollback. Service reopen does not automatically migrate published artifacts in place.

Tables are `schema_migrations`, `staging_campaign`, `migration_runs`, `migration_sources`, `staged_records`, `staged_links`, `migration_findings`, `domain_authority`, and `migration_command_outcomes`. They are operational/opaque staging tables, not turns, canonical heads, fictional entities, health, inventory ownership, beliefs or retrieval schemas. JSON pointer inventories and opaque roots are separate staging units; reported row counts do not claim canonical entity cardinality.

## 4. Snapshot and lease behavior

The server imports only the DATA_DIR lease helper and never discovers/opens campaign migration DBs. It acquires the lifetime lease before initialization. Offline capture requires that same exclusive lease; artifact writes require their own exclusive lease. PID/token/purpose/fingerprint inspection is available. Active/running ownership is not stolen, and stale/unknown leases require explicit exact-token/fingerprint recovery after independent shutdown confirmation. Recovery quarantines, rather than silently deleting, the lease.

Capture enumerates complete expected/discovered sources and references, preflights private structured fields in memory, copies bytes, then repeats enumeration/hashing before sealing. Added/removed/changed source or asset bytes invalidate capture. Source/control content and presence are never repaired or rewritten. Manifest, backup and report digests cover versioned canonical bodies excluding their own digest fields. Snapshot acquisition certifies persisted files under cooperating offline exclusion; it does not certify unsaved UI memory or arbitrary external writers.

## 5. Imported source coverage and identity

Coverage includes metadata, state/chat/swipes/pending markers/pins, archive raw bytes/scenes/exact user and assistant prose ranges, index/chapters, NPCs, locations, entities, facts/timeline/divergence, both relationship collections, lore/reference text, overworld, `context.arcs`, the adoption ledger, all 16 current Arc/enemy/worldmap descriptors, other installed descriptors, unknown/uninstalled table files, all five retained enemy files, authority/control remnants, and referenced allowed portraits/scene images. Declarative manifests are read without executing mod code or adoption/hydration/repair.

Each snapshot explicitly allocates one new disposable import-copy campaign StableId from an explicit UUID and the Phase 1 root-scoped constructor. Child records retain raw keys plus occurrence-based compatibility references, scoped to the immutable snapshot/manifest. No child canonical IDs are allocated or inferred from names/content/storage keys. The known legacy source format has no independently bound canonical map; canonical-looking or sidecar-only identities without independent binding are preserved raw and block conversion, rather than being adopted. Separate snapshots have separate copy identities; rerun/restore of one snapshot preserves its identity.

Inspection reads return Phase 1 ContextRecords with actual source versions/classification and compatibility citations. Stale versions or altered row payloads fail closed. Imported instructions remain untrusted/inert. Evidence/relationships are never promoted into fictional truth or belief.

## 6. Router, outcomes and authority scope

The closed command set is `migration.run-create`, `migration.source-stage`, and `migration.verify`. Envelopes reuse Phase 1 identity/mutation/authority/version guards and import/migration provenance. Only operational `migration-staging` ownership at epoch 1 is supported. SQL transactions atomically commit source rows/links, run revisions/completion and durable outcomes; verification commits findings, resolved links, report digest/status, shadow verification and its outcome together. Projection files can be regenerated afterward.

Both command-ID and caller-key replay modes persist the original semantic request and original accepted result/version. Historical lookup occurs before current owner/epoch/writability/version checks. Changed semantics under a reused logical identity reject. Owner/epoch are execution metadata, not replay namespaces. Structured command contamination is rejected before ledger persistence. This ledger protects migration commands only, not production gameplay replay or acceptance.

Fictional domain rows use strict legacy/shadow transition contracts, aggregate legacy runtime ownership, `scope=staging-only`, epoch 1, false first-write latch and false prepared flag. Verification references bind the exact report. No live sidecar is initialized/applied/repaired. Prepare/commit cutover, authoritative write, first-owner write, rollback and retirement operations are rejected.

## 7. Verification and findings

The independent reconciler traverses sealed source expectations separately from the importer and compares actual SQL inventory, node/slice content, order, counts, raw/semantic hashes, occurrence references, source/run provenance, explicit links, sentinel rules, archive/index closure, duplicate identifiers, mirror/Arc/adoption disagreements, descriptor shapes, control state and external objects. A test intentionally deletes an importer-produced row; verification catches the omission without trusting importer counters. Recovery also compares published finding rows and operational/authority bindings with their independently reconstructed expectations.

Severities are exactly informational, warning and cutover-blocking, with explicit dispositions/codes/locators/value-free policy evidence. Optional absence and demonstrably optional derived corruption differ from missing/corrupt critical state. Duplicate JSON keys, unsafe JSON numbers, invalid UTF-8, ambiguous identity, unexplained control/temp material and unresolved authoritative links block. Name-only relationship evidence remains unresolved with a warning. Unknown criticality blocks. There is no waiver-to-success operation.

`assertImportEligible` requires a verified exact report, no blockers, valid backup closure, and a matching actual isolated restore proof; it revalidates restored members, source expectations, findings, outcomes and staging authority. Unknown/missing/stale report/proof versions or bindings fail. Success says eligible snapshot only, never synchronized live state or permission to cut over.

## 8. Backup, restore and fault evidence

Backup uses the native SQLite backup API and includes the full sealed source/object/control/lore closure and selected report. A specific test holds a connection open with committed data remaining in WAL, backs it up through a separate reader, restores it, and observes the committed extra operational run in the restored DB. A plain open-DB file copy is not used.

The actual restore drill creates a fresh isolated root, copies only allowlisted hashed members, reopens the restored native DB, checks schema/history/integrity/FKs, reconciles records/provenance/order/links against restored source expectations, and audits external objects, outcomes and authority. Tests rename the original DATA_DIR, snapshot and work roots out of reach; recovery succeeds using only portable restored payloads. Proof is a separately sealed companion bound to backup/report/source/schema digests; the backed-up DB/report are not mutated to embed it. Missing proof, substituted proof, member drift, partial restores, corrupt members and missing outcomes reject.

Real child processes are killed before source commit, after source commit/before acknowledgement, before verification commit, after verification commit/before projection, and after backup DB creation. Tests demonstrate rollback, durable duplicate recovery, explicit stale-lease handling and unpublished partial artifacts. Injected fsync/ENOSPC-like failures and source drift preserve source bytes/presence. This is local SQLite/filesystem recovery evidence, not a claim of universal disk-full or hardware power-loss simulation.

## 9. Lifecycle and static architecture evidence

The CLI implements inspection, snapshot, import, verify, status/report/mismatches, exact retry, backup, isolated restore-check, lease inspection/recovery and dry-run/explicit discard. Discard quarantines owned disposable components with explicit snapshot retention. There is no admin UI/HTTP migration subsystem and no cutover command. Metadata status is bounded and explicitly does not certify source freshness; supplying a backup/drill requires full proof validation.

Display rename/new snapshot and reused storage-key isolation are tested. Legacy backup/transfer/delete behavior remains live. Actual frontend `runTurn`/commit requests are captured by the existing deterministic harness and replayed through real Express filesystem routes; state/archive survive reopen with absent or corrupt staging artifacts, and a denied campaign-DB opener observes zero calls. This combines real frontend replay with disk route integration; it is not a live-provider or full Electron UI test. Unsupported future authoritative bundles reject before destination writes; inert unknown mod data retains existing round trips.

Writer inventory now has 169 writers (138 producers, 31 sinks), 25 domains and the same eight competition groups. New entries own operational artifacts/leases only. Existing gameplay writers, debts, competition memberships and target-authority flags remain unchanged. CLI scanning is narrowly enabled for this one tool; migration SQL/backup sinks receive focused recognition. The import/capability gate has synthetic forbidden imports, direct SQLite, provider/vector/live capability violations. Engine platform purity, extension freeze and inference inventories remain enforced. The inventory is metadata, not runtime authorization. Dynamic/aliased native escape hatches retain the existing explicit unverified limitation.

## 10. Performance, privacy and validation

The separate synthetic `phase2-persistence-v1` evaluation writes `.eval-output/phase2/performance.json`, outside frozen Phase 0/1L projections. Empty, 5-scene and 250-scene fixtures all reach eligible-snapshot-only with zero blockers and no provider/vector system. The 250-scene fixture is 294,825 source bytes and 1,259 staging rows; work, backups, isolated restore and retained unavailable originals together consume about 11.2 MB. This deliberately includes multiple recovery copies. Small/empty artifact amplification is large due to fixed SQLite/ledger overhead. Timings and process peak RSS are measurements, not release ceilings; see the generated companion for exact observations. No per-turn campaign-DB IO or serialization was added.

Privacy canaries cover credential/debug source contamination and command envelopes. Settings/vault/vector files are excluded, referenced allowed assets are included, rejected values never enter diagnostics, and fictional secret/token prose is accepted. There is no claim of universal secret detection in arbitrary prose/custom encoded data. All implementation tests/evaluations used synthetic temporary DATA_DIRs; the developer's real campaign was not used or converted.

| Command / gate | Result |
| --- | --- |
| `npm run test:phase2` | 6 files, 34 tests pass |
| `npm run test:run -- --maxWorkers=4` | Final isolated full run: 421 files pass, 1 skipped; 5,662 tests pass, 1 skipped |
| `npm test --prefix packages/engine` | 11 files, 456 tests pass; platform boundary PASS |
| `npm run typecheck:contracts --prefix packages/engine` | PASS |
| `npm run test:architecture` | 6 files, 95 tests pass |
| `npm run check:architecture` | PASS; unchanged explicit native-import unverified note |
| `npm run check:inference` | PASS; 46 families, 105 frontend sites, 14 server/provider sites |
| `npm run check:migration` | PASS |
| `npm run test:base-app-gate` | 3 tests pass, exact baseline retained |
| `npm run build` | PASS; existing chunk-size/static-dynamic import warnings |
| Direct esbuild server bundle to `.eval-output/phase2/server.bundle.mjs` | PASS; no server execution |
| Changed-file ESLint / syntax | Migration JS and changed TS PASS; existing modified JS syntax checks PASS |
| Full `npm run lint` | Existing debt: 106 errors, 12 warnings in 46 unchanged files; exact same 118 diagnostics with committed lint configuration |
| Writer Markdown regenerated twice and compared | Identical generated bytes; gate PASS |
| `git diff --check` | PASS |
| `npm run eval:phase2` | Empty/small/250-scene restore proofs pass |
| `node scripts/patch-graph-imports.mjs` | Unavailable: script absent in this checkout, as anticipated by plan |
| `node build-server.mjs` | Unavailable: script absent; direct esbuild used instead |

The initial full test run observed one transient inventory failure while new operational sink entries were still being cataloged. After catalog completion, full tests passed. Overlapping full/focused/architecture jobs later exceeded existing 5-second limits in filesystem/AST checks. The final isolated full run used four workers and passed without changing assertions or timeouts; the final affected-scope persistence checks passed separately. These were implementation/validation issues, not gameplay deltas.

## 11. Phase 0 / Phase 1L results

Current v0: all five scenarios MATCH and BYTE_STABLE; pinned v0 remains VALID. The same two reviewed visibility violations remain under disposition v1 hash `760d87bd17748689666d6e35650e1a61bce1b79e8ebe357d3adb7279d9422dd7`. No prompt, call ordering, inference profile, provider formatting, known-violation or baseline change was used to absorb persistence work.

Constrained Local: all seven Phase 1L cases BYTE_STABLE, normative policy checks pass, candidate comparisons MATCH. The constrained baseline remains UNPINNED, as approved; Phase 2 does not change that disposition. No live LLM smoke was run because playable inference behavior did not change.

## 12. Acceptance matrix, deviations and remaining gates

| Roadmap criterion | Implementation evidence / disposition |
| --- | --- |
| A1 disposable explicitly invoked SQLite only | Opener, migration import gate, denied-opener gameplay/disk integration |
| A2 complete reconciled source/provenance inventory | Snapshot/source readers, separate verifier, first-party/unknown/retained fixtures, omission test |
| A3 blockers fail eligibility closed | Strict reports, conservative severity, external bound restore proof and revalidation |
| A4 failed import preserves legacy bytes/presence | Foundation/import/crash/source-drift/privacy/fsync failure tests |
| A5 transactional checksummed schema evolution | Initial native schema migration, rerun/history refusal, failed DDL rollback and readonly reopen |
| A6 actual isolated recovery | Native WAL backup, original-unavailable restore, member/schema/FK/source/outcome/control/proof checks |
| A7 zero normal-turn campaign-DB writes | Static import fence, real frontend replay plus filesystem routes, zero denied-opener calls, unchanged behavioral gates |

Implementation refinements within the approved design: full JSON-pointer inventories rather than typed fictional schemas; quarantine instead of destructive discard; a single initial schema migration; narrowly added public engine contract subpath exports because the existing package root uses extensionless exports that native Node cannot load. These exports reuse existing pure contracts and change no engine behavior. Missing checkout build/graph scripts are recorded; direct esbuild supplies server-build evidence. No additional dependency, authority coordination topology, live repository, vector/provider dependency, gameplay/inference change, or source rewrite was introduced.

Pre-4B2 obligations remain: independent canonical identity/adoption evidence; fresh quiesced capture and live-currentness checks; typed critical-domain schemas and bounded native queries; genuine gameplay command/outcome recovery; one atomic gameplay-data/outcome/first-write-latch decision; complete live authority lifecycle and coherent post-cutover transfer/backup/restore; later domain overlap/epistemic/inference gates. Generic staging does not resolve legacy mirrors, swallowed writes, legacy archive multi-file atomicity, adoption competition, version-1 bundle omissions or dynamic extension escape hatches. Automatic schema upgrades of sole published recovery artifacts are deliberately unavailable.

**Current recommendation:** the initial independent review has occurred and raised the five blockers recorded in the amendment. Perform only the blocker-focused independent recheck after remediation validation. Internal tests do not replace it. Do not commit as accepted Phase 2, merge/tag, convert real campaigns or begin Phase 3 in this handoff.
