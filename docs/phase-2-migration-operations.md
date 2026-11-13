# Offline staging migration operations

Phase 2 copies persisted legacy campaign files into disposable artifacts. It does not change gameplay persistence, adopt canonical child identities, repair a campaign, commit pending turns, run mods, or prepare a live cutover. Close the application, renderer and server after ordinary saving before acquisition. Stop older builds, editors and sync agents too: the lease excludes cooperating processes, not arbitrary external writers. Unsaved renderer state is outside the snapshot guarantee.

The CLI uses the existing local better-sqlite3 dependency. Build the engine contracts once after checkout (`npm run build --prefix packages/engine`). No vector extension, provider, model warmup, listener or new HTTP subsystem is used by the tool.

## Explicit roots and acquisition

The examples use placeholders. Replace them with intentional local roots; do not run these against a campaign merely to test this implementation. Tests and `npm run eval:phase2` allocate synthetic temporary roots automatically.

```powershell
node scripts/campaign-migration.mjs inspect-source --data-root <DATA_DIR> --campaign <storageId> --dry-run
node scripts/campaign-migration.mjs snapshot --data-root <DATA_DIR> --campaign <storageId> --artifact <newArtifactKey>
```

Default artifact root: `DATA_DIR/migration-staging`. Override with `--artifact-root <absoluteRoot>`. A root cannot overlap legacy campaigns, authority storage or the declared portrait root. Keys use letters, digits, hyphens and underscores, never display names or encoded StableIds. Portrait references need the correct allowed root (`--portrait-root`); scene images use the selected campaign's scene-images directory. No remote objects are fetched. Capacity estimates are advisory and writes can still fail.

Acquisition obtains `.data-directory.lease` exclusively before reading the source set. The application server obtains the same lease before initialization and holds it for its lifetime. Sources are inventoried, preflighted in memory, copied, enumerated and hashed again before sealing. Any drift fails capture. Incomplete output remains `snapshot.partial` and is not consumable. A failed capture never rewrites source data or initializes an authority sidecar.

Source scope is built-in suffixes, retained files, declarative table descriptors (bundled precedence, then installed), all discovered campaign-prefixed files, relevant authority material, and explicitly referenced allowed local objects. Global settings, vaults, embeddings and unrelated assets are excluded. Structured credential/provider/debug contamination rejects conversion before snapshot persistence; values are not included in errors. Ordinary fictional prose about secrets or tokens is allowed. Arbitrary secrets hidden in prose cannot be detected universally.

## Import, verification and inspection

```powershell
node scripts/campaign-migration.mjs import --data-root <DATA_DIR> --artifact <artifactKey> --run <runId>
node scripts/campaign-migration.mjs verify --data-root <DATA_DIR> --artifact <artifactKey> --run <runId>
node scripts/campaign-migration.mjs status --data-root <DATA_DIR> --artifact <artifactKey>
node scripts/campaign-migration.mjs report --data-root <DATA_DIR> --artifact <artifactKey> --run <runId>
node scripts/campaign-migration.mjs mismatches --data-root <DATA_DIR> --artifact <artifactKey> --run <runId>
node scripts/campaign-migration.mjs retry --operation import --data-root <DATA_DIR> --artifact <artifactKey> --run <runId>
```

Use the same artifact/run/tool identity for retries. Do not change source bindings, expected revisions, importer versions or logical keys to hide a conflict. `retry --operation verify` regenerates missing projections from an already committed verification. Changed source bytes require a new snapshot, with a newly declared import-copy identity. Existing snapshots remain historical after live files change; neither a reused storage key nor a display rename attaches an artifact to gameplay.

Import reads only sealed snapshot bytes. Every JSON node is inventoried with its JSON pointer and order; whole table/root payloads remain available. Archive records retain raw bytes, complete byte spans and exact user/assistant prose slices. This is opaque staging, not a typed fictional state schema. Legacy child IDs are compatibility references scoped to the snapshot and original occurrence. Duplicates remain separate and block ambiguous identity. Canonical-looking values without independently proven binding are retained raw and blocked, never inferred into canonical continuity. The current known pre-adoption format supplies no independently bound canonical map.

Each source now declares `required`, `conditional-legacy`, `optional-derived`, or `unknown` criticality and a disposition. Unknown on-disk JSON/tables/binary files remain preserved but receive `unknown-source-criticality` blockers. Parsing as JSON or retaining bytes is insufficient to establish criticality. The verifier derives this policy independently from filenames/declarative descriptors, rather than trusting an optional-looking flag. No content-based authority inference or waiver is supplied.

The independent verifier derives expectations from source bytes and checks inventory, payloads, counts, order, references, provenance, control and object closure. Known unambiguous links acquire staging foreign keys during verification. Name-only relationships remain unresolved compatibility evidence with warnings. Missing/corrupt critical sources, unsafe numeric parsing, duplicate JSON keys, ambiguous identities, unsupported control and authoritative mismatches block eligibility. Optional corrupt archive indexes can warn when no accepted archive depends on them. Unknown criticality blocks. There is no waiver switch.

Statuses distinguish unsealed, sealed-not-imported, incomplete, imported, blocked and verified artifacts. Metadata-only status does not recalculate all source hashes or certify freshness. Reports certify a particular preserved snapshot, never current live state or permission to cut over. JSON/Markdown projections contain codes, locators, hashes and counts, not source prose. Schema/report/manifest formats fail closed on incompatible versions or bindings.

## Backup and isolated restore proof

```powershell
node scripts/campaign-migration.mjs backup --data-root <DATA_DIR> --artifact <artifactKey> --run <runId> --backup-key <backupKey>
node scripts/campaign-migration.mjs restore-check --data-root <DATA_DIR> --artifact <artifactKey> --backup <backupKey> --drill-key <drillKey>
node scripts/campaign-migration.mjs status --data-root <DATA_DIR> --artifact <artifactKey> --backup <backupKey> --drill-key <drillKey>
```

Writable artifact operations hold `.artifact.lease`. Backup uses the SQLite backup API, including committed WAL data, and publishes only after complete member hashing. The portable directory contains the DB, full sealed snapshot (including actual lore/control bytes), referenced objects, the selected report and a backup manifest. It excludes vectors and unrelated application configuration. Keep these artifacts private.

Restore defaults to a sibling of DATA_DIR named `<data-directory-name>-migration-restore-drills`, or an explicit `--restore-root`. If that sibling overlaps the development project root, the default is instead a sibling of the project named `<project-name>-migration-restore-drills`. It must be outside the entire DATA_DIR, configured asset roots, development project/public assets, and all additional runtime-served writable roots. Vite serves project files outside its DATA_DIR deny rule, so a new sibling directory *inside* the project is also unsafe. Equal, ancestor and descendant overlaps reject before any mkdir/write. Existing ancestors/junction aliases are resolved canonically. The old default under `migration-staging/restore-drills` is no longer allowed. Pass the actual `--portrait-root` on restore-check when using a custom configuration; the CLI propagates it into the restore guard. Service callers must explicitly provide `assetRoots` and supply any additional served roots through `liveAssetRoots`; omission fails closed. External drills are retained independently: artifact discard does not implicitly delete or move them.

Restore refuses overwrite, traversal and symlink escapes. It verifies every member, reopens the restored native DB, validates schema/checksums/integrity/FKs, independently compares staged records and links with restored source expectations, and audits operational outcomes and staging authority. Tests additionally make original source/work paths unavailable. No provider or vector system is required. Archive Markdown image/link destinations and quoted HTML image sources referencing allowed local assets now enter the same snapshot/backup/restore closure as structured JSON references. Remote URLs and bare prose paths are inert. Missing required scene images block; optional missing portraits warn. Duplicate references share content-addressed payloads, and verification re-extracts source references to catch omitted object inventories.

The companion `restore-proof.json` binds the completed backup digest, source manifest, selected report and schema. It is external to the immutable backup. `assertImportEligible` requires matching proof, revalidates restored members and reconciliation, and rejects any blocker. A backup alone is insufficient. Subsequent record/schema/report changes require another backup and drill. Eligibility means **eligible snapshot only**, not live-currentness, adoption readiness, or cutover authorization.

## Interrupted operations, leases and discard

```powershell
node scripts/campaign-migration.mjs inspect-lease --data-root <DATA_DIR>
node scripts/campaign-migration.mjs inspect-lease --data-root <DATA_DIR> --artifact <artifactKey>
node scripts/campaign-migration.mjs recover-lease --data-root <DATA_DIR> --artifact <artifactKey> --token <exactToken> --confirmed-stopped
node scripts/campaign-migration.mjs discard --data-root <DATA_DIR> --artifact <artifactKey> --dry-run
node scripts/campaign-migration.mjs discard --data-root <DATA_DIR> --artifact <artifactKey>
```

Never recover a lease until independently confirming its owning instance stopped. A running PID prevents recovery; PID absence/age never causes automatic theft. Malformed leases expose a fingerprint; explicit recovery can use `--fingerprint <exactFingerprint>` after independent shutdown confirmation. Acquisition, release and recovery now serialize all lease pathname mutations with an exclusive `<lease-name>.guard` file. Recovery checks the exact token/fingerprint while holding that guard through quarantine, so a replacement cannot be removed by an older recovery attempt. Contention returns `lease-busy` and can be retried. This is local cooperating-process serialization, not distributed coordination.

A process killed while holding the short serialization guard leaves a fail-closed guard file. Do not clear it automatically or run ordinary lease recovery against that guard. Independently stop **all** processes using that DATA_DIR/artifact, then explicitly quarantine that exact guard file during offline maintenance before inspecting/recovering the ordinary lease. Dedicated killed-acquisition/corrupt-WAL scenarios remain recommended; existing crash tests cover source/verification/backup commit windows. Stale WAL is preserved for SQLite recovery, never deleted before reopening. An interrupted transaction rolls back; a committed command's durable outcome prevents reapplication after acknowledgement loss. A committed verification can regenerate its projections.

Structural verification now includes pinned `sourceMessageId` (actual `state.messages` only), divergence/manual-correction `sceneRef`, chapter range endpoints, actual existing-scene counts and nonempty explicit membership/range agreement. Existing scene-number spellings are compatibility locators, not canonical IDs. Documented `000`/`CH00`/MC sentinels remain; `sceneRef=manual` requires a manual divergence record. An empty chapter may reserve the next scene with equal endpoints/count zero, and desktop `sceneIds=[]` remains an unpopulated membership field. Missing optional archive-index annotations warn; broken critical structural links block. Nothing is repaired or rewritten.

Discard quarantines only the explicitly named disposable components. By default it retains the sealed snapshot. `--include-snapshot` explicitly includes that snapshot in quarantine. It does not delete source files, shared portraits or live authority. Interrupted snapshots/backups/drills remain unpublished; retain for inspection or quarantine their explicitly owned artifact. No recursive deletion CLI is supplied.

Exit classes: `0` success, `2` blocked preview, `3` busy/stale/conflict, `4` unsupported format/schema/action, `5` IO/integrity/invalid input. Native error messages and rejected values are not echoed. Read-only inspection cannot create/upgrade a DB. Schema 1 is the initial supported schema; the transactional runner rejects history gaps/newer versions/checksum changes. Published artifacts are never automatically upgraded in place.

## Retained boundaries

Legacy timestamp backups and version-1 playable transfer remain unchanged except that explicit unsupported authoritative bundles reject before writes. Their pre-existing limitations remain: transfer omits dedicated divergence/overworld handling, asset references are not physical payloads, and archive reserialization is not byte preserving. They are not the Phase 2 recovery format.

No prepare/commit-cutover, first-new-owner-write, live rollback or retirement command exists. Phase 3 owns acceptance/revision recovery; Phase 4 must deliver independently bound canonical identity/adoption evidence, a fresh snapshot, central gameplay routing, bounded domain queries, atomic gameplay data/outcome/first-write latch, and complete post-cutover backup/transfer/lifecycle handling before 4B2. Generic staging and its operational ledger do not satisfy those gates. Local cooperating-process exclusion, filesystem publication and SQLite FULL synchronization do not claim arbitrary external-writer, distributed or hardware power-loss guarantees.
