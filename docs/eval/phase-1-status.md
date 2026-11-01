# Phase 1 implementation handoff — Slices 1–3

Current status: Slices 1–2 are independently reviewed at `03fb192`; Slice 3's three independent-review blockers are remediated for review. Slice 4 has not started. Sections 1–10 preserve the historical Slice 1–2 handoff, including its original stop gate. Section 11 preserves the initial Slice 3 handoff; section 12 supersedes its affected metadata, counts and validation results. This is not completion of Phase 1 as a whole.

## 1. Starting point

| Item | Verified value |
| --- | --- |
| Branch | `phase/1-architecture-contracts` |
| Starting HEAD | `83f75913b078740ac213fdfb8456f14cc2ca8c47` |
| Initial working tree | Clean |
| Phase 0 completion tag | `phase-0-complete` → `87f45d106d361e2b2e646d5a35aa8541d40f76d6` |
| Baseline pinning commit | `ed5c6399cb8454422fddcace26ff0c00a7276c88` |
| Baseline manifest | `eval/baselines/v0/manifest.json`, reviewed, schema 0, suite `phase-0-v0`, seed 12345 |
| Manifest tested source | `07f67197044d68b3e3c1de3896485b5458e3cc75` |
| Manifest harness revision | `working-tree-sha256:f5e12515bf8403fdf3e73844e28dc44e766b74edd28d31817c17cb367fa8de12` |
| Fixture hash | `83b5c0b4c8f81f14f35ce94fd36a73746d88c7f1f9513a7fecf26a014d19d03e` |
| Lockfile hash | `c8d873bac7f9bea1944868f9af696ecde5cb0eedfcc93b46816140311b7e26f2` |
| Reviewed violation disposition | v1, `760d87bd17748689666d6e35650e1a61bce1b79e8ebe357d3adb7279d9422dd7` |
| Pre-change eval | Exit 0; pinned baseline VALID; all five scenarios MATCH; 30 ordinary PASS checks; two unchanged KNOWN_TARGET_VIOLATION checks |

Pre-implementation guardrails: 69 tests passed across the existing eval harness, launcher, host-facade, and LLM queue suites. The engine purity gate and package build passed before edits.

Pre-existing failures and limitations:

- The engine package test command inherited the root app Vitest configuration and failed all four suites before executing any test because `packages/engine/src/test/setup.ts` does not exist. A package-local Node Vitest configuration now fixes that test isolation problem; the original four suites pass 56 tests.
- PowerShell execution policy blocks `npm.ps1`; validation uses `npm.cmd`/`npx.cmd` with the same scripts.
- `scripts/patch-graph-imports.mjs` is absent. The required refresh command was attempted and failed with MODULE_NOT_FOUND; no replacement graph tooling was introduced.
- The two reviewed visibility violations and deferred local-context limitations remain as recorded in [the Phase 0 handoff](phase-0-status.md). No runtime remediation belongs to this pass.
- Production build retains the documented large-chunk and mixed static/dynamic import warnings.

No newly introduced failing gate remains.

## 2. Files changed

All paths below are repository-relative.

| File | Classification | Purpose |
| --- | --- | --- |
| `packages/engine/src/contracts/identity.ts` | Pure contract | Branded IDs, scoped references, deterministic construction and validation |
| `packages/engine/src/contracts/classification.ts` | Pure contract | Independent authority, trust, and legacy-status vocabulary |
| `packages/engine/src/contracts/domain.ts` | Pure contract | Extensible validated `DomainId` |
| `packages/engine/src/index.ts` | Pure contract/public exports | Expose the contracts through the existing package entry point |
| `packages/engine/src/contracts/__tests__/identity.test.ts` | Test | Identity/reference determinism, validation, ambiguity and isolation |
| `packages/engine/src/contracts/__tests__/classification.test.ts` | Test | Authority/trust/status independence and domain validation |
| `packages/engine/typechecks/contracts.ts` | Test | Compiler-checked negative assignability cases through public exports |
| `packages/engine/tsconfig.contracts.json` | Build configuration | Explicit strict typecheck including the compiler fixture |
| `packages/engine/vitest.config.ts` | Build/test configuration | Isolate package tests from browser app setup |
| `packages/engine/package.json` | Build configuration | Add `typecheck:contracts` script; no dependency changes |
| `docs/eval/phase-1-status.md` | Documentation | This starting-point and completion handoff |

The shared engine entry point changed to export new pure helpers/types. No existing behavioral implementation changed, and no app/server production runtime file, production ID creator, prompt, provider, store, persistence path, or eval harness implementation changed. Generated package/app build output stays ignored. Baseline artifacts and lockfiles are untouched.

## 3. Identity contract

`StableId<K>` is a branded string whose kind is preserved by the compiler. `CORE_ID_KINDS` lists campaign, entity, turn, draft, revision, annotation, evidence, command, and change-set. It is a convenience vocabulary, not the complete set of legal kinds: callers may supply future lowercase dotted/hyphenated kinds explicitly.

Canonical-identity representation is `sid:1:c:` followed by URI-encoded JSON of `[kind, campaign, namespace, key]`. This is a reversible tuple encoding rather than a hash, so delimiter boundaries are preserved without relying on probabilistic collision absence. Construction uses explicit input only. Text is neither trimmed nor Unicode-normalized; whitespace-only, empty, and malformed Unicode inputs reject. Kind grammar is `[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*`. Parsing accepts unknown input and an expected kind, returns the branded ID or `undefined`, and rejects malformed or alternate/noncanonical encodings.

### Independent-review remediation: campaign scope

The independent review approved Slices 1–2 except for one blocker: the original canonical input required an undefined campaign string even when constructing a campaign itself. That ambiguity is resolved by a single hierarchy:

- Canonical campaigns use the exported `ROOT_CAMPAIGN_SCOPE`, whose fixed serialized value is `root:campaign`. It is independent of source/namespace versions and cannot parse as a canonical campaign ID.
- All other canonical kinds, including future kinds, use a canonical `StableId<'campaign'>` as their campaign field. There is no separate campaign scope key.

Campaign bootstrap is nonrecursive: `createStableId({ kind: 'campaign', campaign: ROOT_CAMPAIGN_SCOPE, namespace: 'campaign.v1', key: 'explicit-campaign-key' })`. A child then supplies that returned campaign ID as its `campaign` field. Keys remain explicit caller-owned input; nothing is allocated or persisted.

`StableIdInput<K>` is a small distributive conditional type: campaign inputs require the root literal, while child inputs require the canonical campaign brand. The distinction also holds when input kinds form a union. Construction and parsing validate the same rule at runtime; campaign validation terminates at the root comparison rather than following nested campaign scopes. Children reject raw legacy scope strings, compatibility references, IDs of other kinds, malformed campaign IDs, and alternate encodings.

Compatibility/snapshot reference construction, encoding, parsing and brands are unchanged. Their campaign field remains explicit legacy/import source provenance and does not require an already-established canonical campaign mapping. The `CompatibilitySource.version` public contract now states that it denotes the immutable source revision/import scope, not merely a mutable file's schema version.

The remediation changes only `identity.ts`, its identity tests, the package index export, the compiler fixture, and this handoff. Existing staged Slice 1–2 work was preserved. No app/server production implementation or existing ID generation changed. Slice 3 remains unstarted.

Calling `createStableId` declares a caller-owned identity key; it does not establish that a legacy entity has been identified correctly, accept a narrative draft, or grant authority. Callers must allocate keys from trustworthy explicit identity inputs. Names, array positions, mutable content, and inferred matches are not identity keys supplied by these helpers. There is no ambient allocator, RNG, clock, hashing, lookup, mapping, or automatic promotion.

`CompatibilityReference<K>` uses a different brand and the `sid:1:r:` prefix. It encodes `[kind, campaign, namespace, family, version, mode, snapshot, locator]`. Its source family, namespace, version, campaign, and scope must be explicit. `version` should identify an immutable source revision/import scope, not merely a mutable file's schema version. Snapshot mode additionally requires a nonempty snapshot identity; compatibility mode carries an empty snapshot slot. Both modes are noncanonical references, and neither parses or assigns as a canonical stable ID.

`createCompatibilityReferences` takes the complete locator set for the declared source scope. It rejects duplicate, empty, missing/sparse, and malformed locators instead of silently merging them or allocating index-based disambiguators. Reordering unique inputs preserves each reference. The helper cannot detect omitted records or dishonestly declared source provenance; the caller must supply the complete scope. Parsing a reference validates its shape, not locator uniqueness in an unavailable source collection.

A deterministic reference is not proof of canonical entity identity. Rename, rewind, deletion/reuse, duplicate legacy keys, and historical index allocation may have destroyed identity information. These contracts cannot recover that information or establish continuity across snapshots. Ambiguous records require later explicit adapter/review decisions; they must not be silently merged. No references are written back into persisted records, and existing `uid()`/message/NPC/location/archive/timeline/module generation remains unchanged.

## 4. Authority and trust contract

Authority classes:

- `tracked-state`
- `canonical-evidence`
- `derived-interpretation`
- `working-data`
- `reference-input`
- `operational-metadata`
- `presentation-cache`

Trust classes, following architecture 002 section 4:

- `trusted-application-story-instruction`
- `current-user-action`
- `active-trusted-ooc-meta-direction`
- `trusted-characterization-directive`
- `tracked-state`
- `reference-lore`
- `canonical-narrative-evidence`
- `imported-untrusted-content`
- `derived-interpretation`

`RecordClassification` requires authority, trust, and separate `legacyStatus` fields. `LegacyStatus` is `transitional-legacy | target`; it describes migration status, not an authority owner/transition or persistence contract. Each vocabulary has an unknown-input parser returning its exact member or `undefined`.

There is no helper that infers authority from trust, persistence, or legacy status. Canonical evidence has fictional authority without active instructional trust; trusted meta direction can have instructional trust without fictional authority. Persisted legacy extracted facts remain derived interpretations. A derived interpretation is not upgraded to tracked state by parsing or classification. These labels describe records; they do not enforce future mutation policy or validate content provenance.

## 5. Domain contract

`DomainId` is a branded string with the same lowercase dotted/hyphenated identifier grammar. `parseDomainId` validates syntax only. Slice 2 needs no actual registered domain members, so none are declared. Future registries can accept validated IDs and separately enforce registration/ownership. Provisional roadmap examples such as inventory, epistemics, presence, or narrator direction are not frozen as a closed enum or storage schema here.

## 6. Validation

| Gate | Result |
| --- | --- |
| Pre-change `npm.cmd run eval` | All five MATCH, baseline VALID, 30 PASS, same two reviewed violations |
| Pre-change focused existing guardrails | 4 files, 69 tests passed |
| Pre-change engine purity/package build | Passed |
| Pre-change engine tests | 4 suites failed at setup, zero executed; inherited configuration issue described above |
| Final engine tests, `npm.cmd test --prefix packages/engine` | 6 files, 157 tests passed: 62 identity, 39 classification/domain, 56 existing engine tests |
| `npm.cmd run typecheck:contracts --prefix packages/engine` | Passed, including 14 required compile-error assertions |
| `npm.cmd run build --prefix packages/engine` | Passed |
| Engine boundary/purity gate | Passed through package `pretest` |
| Existing eval harness/launcher/host-facade/queue/base-app guardrails | 5 files, 72 tests passed, including 3 base-app replay tests |
| Final `npm.cmd run eval` | All five MATCH, baseline VALID, 30 PASS, same two reviewed violations |
| `npm.cmd run eval:determinism` | Five BYTE_STABLE PASS results, including independent workers and repeated in-worker runs; baseline MATCH |
| `npm.cmd run build` | Passed; existing Vite warnings only |
| Changed-file ESLint | Passed for contract source/tests, engine index, compiler fixture and Vitest config |
| Graph refresh | Unavailable: missing pre-existing script |

The original seven negative compiler cases prove distinct ID kinds, compatibility-to-canonical rejection, raw-string ID rejection, legacy-status/authority separation, authority/trust separation, derived/tracked separation, and explicit domain validation. Seven further cases prove root-only campaign bootstrap, rejection of a campaign-scoped campaign, canonical campaign scope for children, rejection of the root for children, rejection of compatibility campaign references and other canonical kinds as child scopes, and preservation of the distinction in union input types. Positive fixtures construct the root campaign and its canonical child. The dedicated fixture is included in `tsconfig.contracts.json` despite ordinary builds excluding test directories.

Fifteen added runtime tests cover the exact nonrecursive root campaign tuple and round-trip, invalid campaign bootstrap scopes, valid child scope/round-trip, separation of identical child keys across campaigns, raw/other-kind/malformed/noncanonical child scope rejection in both construction and parsing, and unchanged legacy-reference construction without a canonical campaign mapping. Existing deterministic, Unicode, clock/RNG, and compatibility guarantees continue to pass.

The existing engine package index is consumed by runtime code used in deterministic replay, so determinism was run even though the new helpers have no runtime callers. No real-model smoke was necessary: inference/transport implementation and model calls were untouched. Full unrelated application suites and Playwright were not needed for these additive contracts.

## 7. Evaluation preservation

All five scenarios remain MATCH: canonical commit, stale holder supersession, scoped secret/cast change, manual correction retention, and Pro call ledger. The exact reviewed failures remain:

- `visibility.cast-scoped.nonknower-excluded`
- `visibility.hidden-absent`

No deterministic behavioral result or pinned baseline artifact changed. No `eval:record` or repinning was performed. Ignored run manifests/reports record the new working-tree provenance as expected; those are operational outputs, not modified behavioral baselines.

## 8. Runtime and performance impact

No model calls, normal-turn scans, persistence, migrations, production ID changes, authority routing, writer inventory, mutation envelopes, authority metadata, extension enforcement, or inference classification were added. Helpers operate on explicitly supplied tuples/locator lists only and have no app-runtime dependency. The compatibility collection check is linear in its caller-supplied collection and is not connected to a normal turn or campaign scan. Existing runtime behavior remains authoritative.

## 9. Deviations

- No separate approved Phase 1 repository-inspection/implementation-plan document was found among repository plans or other discoverable tracked files. Implementation follows the user's attached Slices 1–2 request and the Phase 1 section of the existing roadmap, checked against current source and architecture 002. No missing plan requirements are invented.
- No existing Phase 1 handoff note was present. This file follows the existing `docs/eval/phase-0-status.md` convention without duplicating Phase 0 implementation documentation.
- A package-local Vitest config was necessary to make the explicitly required engine tests executable. No root application test configuration changed.
- Graph refresh could not run because its script is absent, consistent with the Phase 0 handoff.

## 10. Recommendation before Slice 3

Slices 1–2 are ready for independent review. Slice 3 should inventory actual writer/domain boundaries before selecting domain registry members, and should preserve the distinction between legacy scoped references and canonical identity. No discovery requires expanding or beginning Slice 3 in this pass. All later Phase 1 services, enforcement, metadata persistence, model-call classification and extension work remain deferred.

## 11. Slice 3 — Writer inventory and extension dependency freeze

### Starting point

Branch: `phase/1-architecture-contracts`. Starting commit and independently reviewed Slice 1–2 checkpoint: `03fb192bf551bb3a8fce961fe81a661d3c1e64ef` (`feat(engine): add Phase 1 identity and classification contracts`). The working tree was clean. Pre-change `npm.cmd run eval` reported baseline VALID, all five scenarios MATCH, 30 ordinary PASS checks, and the same two reviewed known target violations. The identity/campaign-root, compatibility-reference, authority, trust, legacy-status, and domain contracts are unchanged by Slice 3.

### Inventory and source of truth

[writer-inventory.json](../architecture/writer-inventory.json) is the authoritative static registry. It contains **157 writer entries: 134 semantic producers and 23 sinks**, **24 domain identifiers**, and **7 explicitly referenced legacy competition groups**. Entries group related source symbols at meaningful mutation boundaries; they do not count each forwarding call as another authority. There are also five explicitly classified forwarding groups and eight non-writer groups for recognizable syntax such as read-only POST searches and model transport.

[writer-inventory.md](../architecture/writer-inventory.md) is a deterministic human-readable projection, checked for staleness by the gate. It is generated from the registry; it must not be edited independently. Detailed fields, triggers, operation types, source symbols, storage targets, and ambiguity notes remain in the JSON source. The static boundary coverage currently accounts for **863 distinct recognized source/symbol/call signatures**, including forwarding and non-writer decisions. That is a syntactic coverage count, not a count of independent authorities.

Verified families include campaign metadata/create/save/import, initialization and hydration repair, store slices, chat/swipes/pending acceptance and recovery, archive append/correction/rename/rollback/delete, deferred server NLP, divergence/facts/timeline and read repair, manual/model/deterministic NPC updates, PC drift, inventory/profile/location bookkeeping, relationship memory, travel and shared location, chapter editorial/seal/summary operations, lore/rules and indexing, backup/restore/transfer, Arc, enemy combat/activation repair, world-map actions/discoveries, native context and worker journals, generic module tables, vectors, media references/assets, and operational UI/settings projections.

Enemy discovery is advertised by `tierEntries.enemyDiscovery`, but the current enemies manifest has no compute registration and there is no registered automatic model discovery path. The inventory includes actual manual suggestion UI, combat/edit actions and activation repair; it does not invent the advertised writer. Ability-compendium modules do have their own existing compute discovery/proposal path and are recorded separately.

### Registry fields and integrity

Each writer declares:

| Field | Purpose |
| --- | --- |
| `writerId` | Stable, unique registry identity, independent of runtime record IDs |
| `source`, `symbols` | Repository-relative module and existing function/action/route symbols for review and source checks |
| `role` | Explicit `producer` or `sink`; forwarding-only groups are separate |
| `domains` | Validated registered `DomainId` values, current `AuthorityClass`, and affected fields/subareas |
| `operations` | Current semantic operations, such as append, patch, replace, derive, repair, restore or delete |
| `trigger`, `lifecycleStage` | Why and when the mutation occurs, including load/recovery/background paths |
| `mutationOrigin`, `modelInvolvement` | Current provenance and model participation; descriptive inventory metadata, not inference-purpose policy or a command envelope |
| `storageTargets` | Current file/table/callback family reached by the boundary |
| `legacyStatus` | Existing `LegacyStatus` classification, separate from information authority |
| `targetAuthoritativeOwner` | Static ownership claim for integrity testing; false for every current entry, with no runtime permission granted |
| `migrationDebt`, `competitionGroups` | Explicit legacy ambiguity and references to groups whose members are valid writer IDs |
| `feedsInto` | References to shared sinks, distinguishing data flow from competing semantic producers |
| `migration` | Roadmap migration/retirement phase or explicit preservation rationale; mixed families require staged domain review |
| `surfaceCounts` | Exact recognizable symbol/category/call signatures and occurrence counts covered by the entry |

The validator consumes the existing engine `parseDomainId`, `parseAuthorityClass`, and `parseLegacyStatus` helpers. It rejects malformed/unregistered domains, duplicate writer IDs, missing metadata, unknown source/symbol or competition/sink references, invalid roadmap phases, undeclared legacy debt, derived/legacy/sink target-ownership claims, and multiple declared target owners for one domain. It does not enforce routing or change current authority. All current producers are explicitly transitional legacy; persisted extracted facts remain `derived-interpretation`, not certified target tracked authority.

### Domain decisions

These are data-driven inventory identifiers, not a closed engine enum, repository schema, or promise of one future table per label:

| DomainId | Actual current boundary represented |
| --- | --- |
| `campaign-metadata` | Identity/catalog metadata and campaign lifecycle |
| `narrative-evidence` | Accepted archive prose and its corrections/rewind/deletion |
| `draft-messages` | Unaccepted messages, streaming, swipes and pending drafts |
| `identity-control` | PC/NPC identity, aliases, control and legacy PC migration |
| `character-state` | Character profile/stats/health/conditions; enemy health overlap is unresolved |
| `presence-location` | Shared current place/feature, participation, journey and day; coordinates are projections |
| `inventory` | Consequential inventory and ownership/location tags |
| `npc-process` | Ledger, agency, goals, pressure and NPC lifecycle |
| `relationship-records` | Legacy inferred relation/witness/stance memories; not epistemic belief authority |
| `editorial-annotations` | Scene notes, pins and editorial selections |
| `chapter-editorial` | Membership, titles, ranges and sealing lifecycle |
| `derived-recall` | Summaries, index annotations, events, embeddings and rebuild metadata |
| `reference-lore` | Authored/imported lore and world-builder drafts |
| `rules-reference` | Rule source/chunks and rule-index inputs |
| `legacy-assertions` | Mixed divergence, facts, timeline, entities and `knownBy`/witness metadata |
| `module-arc` | Arc ladders, progression and pressure state |
| `module-enemy` | Compendium, instances, encounters, resources and combat resolutions |
| `world-map` | Terrain, routes, exploration, discovery and map encounter state |
| `narrator-direction` | Existing profile/OOC guidance, distinct from fictional authority |
| `recovery-metadata` | Pending/retry/migration/backup/restore bookkeeping |
| `extension-state` | Generic executable-mod rows/proposals of unverified fictional semantics |
| `media` | Asset references, generated images/audio and disposable media caches |
| `presentation` | Ephemeral UI/session projections and status |
| `settings` | Provider/preset/vault/preference operational metadata |

No target epistemic-claim, promoted-assertion, repository, generic state-slot, or other final schema was frozen merely because it appears in roadmap examples. Shared location is one conceptual domain even when world-map code caches coordinates. Enemy-instance health remains a documented overlap with core character state rather than a second certified health authority. Some whole-record writers affect many domains: their listed phase is the first relevant redirection/cutover, and their final retirement needs per-domain review.

### Producer/sink examples and legacy competition

- `npc.model-update` produces model-derived NPC patches through `updateNPCStore`; campaign store/save callbacks and `sink.campaign-routes` ultimately reach `sink.file-store`. The shared JSON sink is not another NPC semantic owner.
- `archive.deferred-extraction` derives witness/event annotations and writes through `sink.archive-repository`. Its output is classified as interpretation even though it is durable.
- `movement.engine-press` produces deterministic transitions/messages; Story movement, header resolution, location scanning, manual travel and world-map actions can also affect shared location. This is recorded as legacy competition rather than resolved by a new router.

The seven groups are shared presence/location (`5D`), NPC writers (`5A`), inventory writers (`5A`), archive append/edit/rollback (`4B2`), mixed extracted/user assertions (`6`), core/enemy health overlap (`5C`), and chapter editing/sealing/load repair (`4B2`). Group records name the actual competing writer IDs, rationale and future phase. Legacy producers can coexist when explicitly recorded as migration debt; the gate does not reject existing gameplay simply because those producers overlap.

### Writer-boundary gate

Run `npm.cmd run check:architecture`. The command builds the existing engine package, validates registry integrity, checks recognized production surfaces, checks the generated projection, and verifies the extension allowlist. Ordinary application tests also execute the real-source checks, so new recognizable sites fail the normal test gate.

The implementation uses the existing TypeScript parser for JS/TS/TSX syntax. It inspects standalone Zustand `set`, property `setState`, known store/save/facade callbacks and API mutators, direct filesystem writes, recognized SQL writes/schema calls, mutating Express routes, literal mutating fetch verbs, generic table/journal writes, and typed post-turn track declarations. Exact source/symbol/call signatures and occurrence counts mean a new source/function or an extra recognized call inside an existing function requires classification. Missing, renamed or stale entries fail with source, line and likely boundary information. Explicit forwarding/non-writer decisions prevent read-only POST endpoints and repeated transport adapters from inflating authority counts.

There is no runtime wrapper, event ledger, dispatch bus, generic repository or per-turn inventory lookup. To update the human projection after a reviewed registry edit, run `node scripts/architecture/check-writers.mjs --write-report` after building the engine. This only writes the Markdown projection when all checks pass; it never approves new registry or allowlist entries automatically.

### Extension dependency freeze

[extension-freeze.json](../architecture/extension-freeze.json) enumerates **551 exact dependency signatures in 136 production source/manifest files**, grouped by source with a review rationale and occurrence counts. This is the complete grandfathered site list; no entire mod directory is exempted.

Frozen recognizable capabilities include native mod context/host facade writes, generic mod tables, model/provider access through extension APIs, sandbox host/journal and generated worker bindings, role leases/providers, prompt interceptors, fact publishers, executable lifecycle/events/macros/mounts, panel/screen APIs, and executable/table/UI declarations in mod manifests. Relative imports are resolved before checking, including adjacent and nested module imports. Exact member access/call sites, added occurrence counts and changed executable manifest declarations fail. The worker prelude is generated string code, so its LF-normalized whole-source hash is grandfathered rather than pretending the host AST walk inspects embedded code.

Grandfathered sites include shipped and repository-local Arc/ability/example modules, enemies/worldmap, host bindings under `src/services/mods`, role infrastructure, existing model/context consumers, turn tracks, payload contributions, UI panel/screen hosts, and campaign table hydration. The JSON lists every file and signature; the human report does not maintain a second independent list. No existing extension behavior or working dependency was removed/refactored.

The gate explicitly prints `UNVERIFIED` for `src/services/mods/native/nativeLoader.ts` → `defaultImport` → runtime `import(nonliteral)`. External native modules can execute import-time side effects and access the page's browser APIs; arbitrary third-party/native code, computed aliases and dynamically served screen/compute code cannot be certified by this static inventory. Existing arbitrary journal-name dispatch is represented by the sandbox sink, not promoted to target authority.

### Validation results

| Check | Result |
| --- | --- |
| New registry/ownership tests | 29 passed |
| New writer-boundary tests | 14 passed |
| New extension-freeze tests | 17 passed |
| New tests total | 60 passed across 3 files |
| Full ordinary application suite | 398 files; 5,430 tests passed, zero failed; one expected opt-in replay entry skipped |
| Existing store suites within the full run | 14 files; 96 tests passed |
| Existing client module suites within the full run | 86 files; 1,012 tests passed |
| Eval harness/launcher/queue/host-facade/base-app guardrails within the full run | 72 tests passed |
| Additional representative server gates within the full run | Legacy adoption: 16 passed; module table routes: 5 passed |
| Existing engine contracts/package tests | 6 files; 157 passed |
| Explicit contract typecheck | Passed, including 14 negative compiler assertions |
| Engine purity/boundary gate | Passed |
| `npm.cmd run check:architecture` | Passed; 157 writers, 24 domains, 7 competition groups; native import explicitly UNVERIFIED |
| Package and application builds | Passed; existing Vite chunk/import warnings only |
| Changed-file lint | Passed for architecture Node scripts and new TypeScript tests |
| `npm.cmd run eval` | All five MATCH; pinned baseline VALID; same 30 ordinary PASS checks and two reviewed violations |
| `npm.cmd run eval:determinism` | Passed: all five BYTE_STABLE and MATCH, including independent workers and repeated in-worker runs |
| Graph refresh | Attempted; still unavailable because `scripts/patch-graph-imports.mjs` is absent |

Negative tests cover unclassified store/direct/file/route/table/track writes, extra calls in a covered function, stale source references, unknown domains, duplicate IDs/target owners, missing metadata/debt, invalid ownership claims, newly imported/accessed extension capabilities, extra existing-site calls, executable manifest changes and generated worker boundaries. Fixtures remain synthetic and do not mutate production source during tests. Full-suite Vitest changed only the existing golden file's checkout line endings; normalized content was verified against HEAD and checkout formatting restored, leaving no golden diff. The final operation-label refinement changed registry metadata only and was rechecked by the focused gate/tests.

### Files, runtime impact and limits

| Files | Classification |
| --- | --- |
| `docs/architecture/writer-inventory.json`, `extension-freeze.json` | Registry/dependency data |
| `scripts/architecture/surfaces.mjs`, `inventory.mjs`, `check-writers.mjs`, `eslint.config.mjs` | Static enforcement/tooling and scoped lint configuration |
| `src/architecture/__tests__/fixtures.ts`, `writerRegistry.test.ts`, `writerBoundary.test.ts`, `extensionFreeze.test.ts` | Test fixtures and tests |
| `docs/architecture/writer-inventory.md`, `docs/eval/phase-1-status.md` | Generated inventory and handoff documentation |
| `package.json` | Tooling entry points: `check:architecture` and `test:architecture`; no dependencies or lockfile changes |

No behavioral production runtime file changed. Existing engine contracts, app/server writers, prompts, providers, production IDs, persistence formats and baseline artifacts remain unchanged. No model calls, writer rerouting, new campaign persistence, per-turn scan, runtime registry import or authority change was added. Tracked JSON/Markdown inventory artifacts are development metadata, not campaign authority metadata.

This focused parser is not a general static analyzer. It cannot prove absence of all dynamic writes, follow arbitrary aliases, infer mutation from every in-place assignment or new wrapper name, inspect ignored/local/external installations, or validate third-party native/import-time effects. Changing arguments/fields at an existing syntactic call may change semantics without adding a dependency site; source review and behavior tests remain necessary. Generated worker code and runtime native import are explicitly bounded/opaque. Multi-file legacy operations are not made transactional by being listed. Current known-by/witness behavior is not certified as target epistemic correctness.

### Evaluation preservation, deviations and Slice 4 recommendation

The unchanged reviewed violations remain `visibility.cast-scoped.nonknower-excluded` and `visibility.hidden-absent`. No deterministic behavioral artifact or pinned baseline was edited, recorded or repinned. No real-model smoke was necessary because inference behavior is unchanged.

No separate approved Phase 1 repository-inspection/implementation plan was found under repository planning conventions; the attached Slice 3 scope, current runtime source and existing architecture/roadmap were used. The registry lives under architecture docs and the static tooling under `scripts/architecture` to keep it out of runtime. Pure engine contract validators are consumed from their existing built distribution rather than adding runtime services or new engine contracts. The missing graph-refresh script remains a pre-existing tooling limitation. No analyzer framework, generator that approves new dependency sites, or runtime instrumentation was introduced.

Slice 3 is ready for independent review. Final determinism verification passed all five scenarios. Slice 4 should use producer/sink links, shared location/health ambiguity, source-dependent import/recovery paths and mixed-domain whole-record writes when designing envelopes; registry entries must not be mistaken for a settled ownership map. No discovery justifies skipping review or implementing routing now. Slice 4, mutation/provenance/version envelopes, authority routers, transition persistence, `.authority.json`, inference-purpose classification, local-policy diagnostics and Phase 1L behavior remain unstarted.

## 12. Independent Slice 3 review — targeted remediation

The review found three blockers: missing literal dynamic-import/public role-barrel coverage, enforcement of the unused `promptContributions` manifest field instead of runtime `contributions`, and omission of manual relationship-memory production together with inaccurate persistence/projection links. These three findings are remediated within the existing inventory/gate design. Work remains on `phase/1-architecture-contracts` at HEAD `03fb192bf551bb3a8fce961fe81a661d3c1e64ef`; the previously staged Slice 3 work and the existing untracked `Slice3.txt` were preserved. No Slice 4 implementation was begun.

### Import and manifest coverage

Literal `import('...')` and no-substitution template imports use the same repository-relative resolution and frozen-module policy as static imports. Their signatures contain the literal module path, not an enclosing callback body. Nonliteral imports remain explicitly opaque/UNVERIFIED. There are currently no production literal dynamic imports of the selected frozen modules, so none needed additional real-source allowlist entries; synthetic tests prove both rejection and explicit grandfathering.

The actual public role barrel is `src/services/roles/index.ts`. Imports through `services/roles`, `services/roles/index`, and the explicit JS/TS index forms now detect acquisition of `serviceRoles`, registry construction, lease/configuration helpers and role enablement APIs. Named import aliases are recognized syntactically; namespace imports/re-exports expose the capability surface and are frozen. Census/diagnostic exports such as `ROLE_IDS` and `formatRoleFaultReason`, and type-only imports, remain allowed through the barrel when they do not acquire frozen capabilities. This adds no alias/data-flow analyzer. Seven existing public-barrel capability imports are explicitly grandfathered.

`server/lib/modLoader.js` validates and consumes `raw.contributions` (including text, order, budget, conditions and suppressions). It does not consume `promptContributions`. The manifest scanner now hashes `contributions`, and no longer treats the obsolete name as a runtime capability. Eight existing declarations were added to the allowlist: ability-compendium, anno-mark, example-facts-consumer-mod, example-grimdark-tone, example-tavern-mood, skill-tree, template-mod, and bundled example-bundled-tone. Changed/expanded declarations fail; unrelated top-level name/version/description changes do not. Ignoring the obsolete scanner field does not imply that the runtime accepts unknown manifest keys.

The freeze update adds only these eight existing declarations and seven existing role imports. All prior 551 dependency signatures remain intact; no unrelated dependency was re-grandfathered or removed.

### Corrected relationship-memory producer/sink map

`relationships.manual-editor` records `RelationshipMemoryEditor`, `saveDraft` and `persist` in `src/components/character/RelationshipMemoryEditor.tsx` as an explicit **user semantic producer**. It validates event/outcome bounds, constructs or edits records with `source: 'user'`, and selects the NPC-to-MC or NPC-to-NPC collection. Its operations are create/edit/validate/provenance; its domain is the existing `relationship-records`, its authority remains `derived-interpretation`, its status remains `transitional-legacy`, and it claims no target ownership. Migration remains Phase 6; user provenance is not certification of future epistemic authority.

Only focused mutation recognition was added: `setRelationshipMemories`, `addRelationshipMemoryFault`, and `saveRelationshipMemories`. These expose the current editor and model save path, and an equivalent new unclassified caller of these boundaries fails the writer gate. No generic React-component inference was introduced.

The current paths are:

```text
manual editor (source:user)
  -> store.campaign.relationships: Zustand collection/fault actions only
  -> sink.relationship-save: saveRelationshipMemories, if a campaign is active

model relationship-memory post-turn producer (source:recorded)
  -> sink.relationship-save: saves merged collections first
  -> relationships.state: projects successful collections/faults via setState

sink.relationship-save
  -> sink.relationship-route: PUT /api/campaigns/:id/relationship-memory
  -> sink.file-store: writeJson
  -> <id>.relationship-memory.npc-to-mc.json
     <id>.relationship-memory.npc-to-npc.json
```

The manual editor updates its projection before awaiting persistence; the model track persists before projecting successful collections, with its existing campaign guards. The metadata describes that behavior without changing it. `relationshipMemoryFaults` is in-memory and is not part of the dedicated HTTP payload or either relationship file.

`store.campaign.relationships` is corrected from a semantic producer to a projection sink. It and `relationships.state` have no persistence `feedsInto` edge: neither setter saves campaign files. The existing client sink `sink.relationship-save` now links to `sink.relationship-route`, a metadata entry for the actual existing server handler. That handler's source symbols/signatures were moved out of the general campaign-route entry without double counting. The general campaign DELETE still removes relationship files as part of campaign deletion; its metadata retains that lifecycle role only.

The manual and model producers link to the appropriate projection sink and the dedicated client save sink. Unsupported links to `store.campaign.saves` / `sink.archive-repository` were removed from this relationship flow. No endpoint, repository, runtime sink or persistence format was created. The new `relationship-memory-writers` competition group names both producers and records their shared legacy full-collection replacement/provenance debt. Projection and persistence sinks are not competing semantic authorities; neither producer becomes a target epistemic owner.

### Before/after inventory and freeze counts

| Measure | Reviewed initial Slice 3 | After remediation |
| --- | ---: | ---: |
| Writer entries | 157 | 159 |
| Semantic producers | 134 | 134 |
| Sinks | 23 | 25 |
| Domains | 24 | 24 |
| Legacy competition groups | 7 | 8 |
| Frozen dependency signatures | 551 | 566 |
| Files with grandfathered dependencies | 136 | 142 |

The producer total is unchanged because the newly recorded editor replaces the store setter's incorrect producer classification. The two added entries are the editor and the source-backed dedicated HTTP sink; reclassifying the existing setter accounts for the other additional sink. No new domain or final domain schema was introduced.

### Tests and validation

| Check | Result |
| --- | --- |
| Extension-freeze tests | 32 passed, including 15 additional import/barrel/contribution cases |
| Writer-boundary tests | 14 passed |
| Registry integrity/ownership tests | 29 passed |
| New relationship inventory/boundary tests | 10 passed |
| All architecture tests | 85 passed in 4 files; 25 added tests total |
| `npm.cmd run check:architecture` | Passed with the counts above; native nonliteral import remains explicitly UNVERIFIED |
| Full ordinary application suite | 399 files, 5,455 tests passed, zero failures; one expected opt-in replay entry skipped |
| Relevant relationship/store/server suites within that run | Memory extraction/merge: 9; compaction: 8; reading: 11; stance: 17; payload identity: 1; campaign state round-trip: 5; server fixture round-trip: 3 — all 54 passed |
| Existing engine tests and purity gate | 157 passed in 6 files; boundary gate passed |
| Explicit contract typecheck | Passed, including the existing 14 negative compiler assertions |
| Package/application builds | Passed; existing Vite import/chunk warnings only |
| Changed-file lint | Passed for Node architecture tooling and architecture TypeScript tests |
| `npm.cmd run eval` | Five MATCH results; baseline VALID; 30 ordinary PASS checks; same two reviewed violations |
| `npm.cmd run eval:determinism` | Passed: all five BYTE_STABLE and MATCH; baseline VALID and reviewed violations unchanged |

The new tests prove literal-import rejection and explicit grandfathering, shared static/dynamic resolution, public role capability imports/aliases/namespace/re-exports, allowed census/diagnostic/type imports and ordinary literal imports, continued nonliteral opacity, actual/current/modified contribution enforcement, manual user provenance and producer classification, recognizable manual write boundaries, separate model provenance, dedicated persistence links, fault/projection separation, source-backed route coverage, integrity and deterministic Markdown output.

`writer-inventory.md` was regenerated through `node scripts/architecture/check-writers.mjs --write-report` from the authoritative JSON. It was not manually edited. No pinned baseline was changed or repinned; the two reviewed violations remain `visibility.cast-scoped.nonknower-excluded` and `visibility.hidden-absent`. No live-model smoke was required because inference/transport behavior is unchanged.

### Files, maintenance debt and stop gate

This remediation changes exactly these files relative to the reviewed staged Slice 3 checkpoint:

- Static scanner: `scripts/architecture/surfaces.mjs`.
- Static metadata: `docs/architecture/extension-freeze.json`, `docs/architecture/writer-inventory.json`.
- Tests: `src/architecture/__tests__/extensionFreeze.test.ts`, new `src/architecture/__tests__/relationshipInventory.test.ts`.
- Documentation/projection: `docs/eval/phase-1-status.md`, generated `docs/architecture/writer-inventory.md`.

Production relationship-memory, extension, prompt, role-service and persistence behavior is unchanged. No model calls, current authority, engine contracts, writer routing, runtime scans, storage formats or campaign records changed. Existing staging and unrelated user files remain intact.

Oversized signature brittleness remains **nonblocking maintenance debt**. The six pre-existing signatures longer than 1 KB, caused by outer callback/catch expression capture, retain exactly the same source/key/count. No new oversized signature was added. New dynamic-import signatures use a short literal capability boundary. A broad normalization/refreeze was deliberately deferred; this gate still does not claim general data-flow or external-code analysis.

All three independent-review blockers are resolved with focused implementation, passing regression coverage and successful final determinism verification. The remediation is ready for review. Slice 4, mutation envelopes, authority routing/transition persistence, inference classification and Phase 1L behavior remain unstarted.
