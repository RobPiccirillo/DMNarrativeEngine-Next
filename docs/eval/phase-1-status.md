# Phase 1 implementation handoff — Slices 1–6

Current status: Slices 1–5 are complete and independently reviewed. Slice 6 classification and observability is implemented for validation and independent review; see section 17. Earlier sections preserve preceding handoffs and historical stop gates. No gameplay authority has moved. Slice 7 and Phase 1L remain unstarted. This is not completion of Phase 1 as a whole.

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

## 13. Slice 4 — mutation envelopes and authority-router seam

### Starting point and scope

Branch: `phase/1-architecture-contracts`. Starting HEAD: `23f1abda87aac2a47f75820aeb9e40bb1327dc65` (`feat(architecture): inventory writers and freeze extension dependencies`). The working tree was clean. Slices 1–3 were independently reviewed; the Slice 3 checkpoint has 159 writer entries (134 producers, 25 sinks), 24 domains, eight competition groups, 566 frozen signatures in 142 files, and no target-authoritative legacy writer. Pre-change eval: baseline VALID, five MATCH scenarios, 30 ordinary PASS checks and the same two reviewed target violations.

This implements Slice 4 only. No existing writer, gameplay path, persistence sink or runtime authority changed. Slice 5 remains unstarted.

### Changed files

| File | Classification | Purpose |
| --- | --- | --- |
| `packages/engine/src/contracts/mutationVocabulary.ts` | Pure contract | Validated kind, owner, writer, epoch, content-version and caller-key brands; version/idempotency unions |
| `packages/engine/src/contracts/mutation.ts` | Pure contract | Generic envelope, structured provenance/references and explicit runtime guards |
| `packages/engine/src/contracts/authorityRouter.ts` | Pure contract | Lookup/router interfaces, result unions and pure owner/epoch/version checks |
| `packages/engine/src/contracts/identity.ts` | Pure contract | Read-only validated child campaign-scope accessor using the existing identity decoder |
| `packages/engine/src/index.ts` | Pure contract/public exports | Export the new types and helpers |
| `packages/engine/src/contracts/__tests__/mutation.test.ts` | Test | Vocabulary, envelope, provenance, precondition and test-only router proof |
| `packages/engine/typechecks/contracts.ts` | Test | Extend compiler assertions through the public package entry point |
| `docs/eval/phase-1-status.md` | Documentation | Slice 4 completion report and stop gate |

No build configuration, dependencies, application/server behavioral runtime files, writer inventory, extension freeze or pinned baseline changed. Generated build/test output is ignored.

### Exact command contract

`MutationCommand<K extends CommandKind, P>` preserves both the kind and caller-defined payload type. Required fields:

- `commandId: StableId<'command'>` and `campaignId: StableId<'campaign'>`;
- `domainId: DomainId` and `kind: K`;
- `provenance: MutationProvenance`;
- `expectedOwner: AuthorityOwnerId` and `expectedFormatEpoch: FormatEpoch`;
- `expectedVersion: VersionPrecondition` and `idempotency: Idempotency`;
- `payload: P`.

Optional fields are `sources: readonly SourceReference[]` and `evidence: readonly SourceReference<'evidence'>[]`. Every request explicitly states ownership, format, version and replay expectations; optional descriptive references do not require unrelated data. There is no final command catalog or domain schema.

`isMutationCommand(value, kind, isPayload)` validates unknown data using the caller's kind-specific payload type guard. It validates existing ID serialization/kinds and verifies that the command ID belongs to the envelope's canonical campaign. `getStableIdCampaign` reads this scope through the existing identity decoder without introducing an ID format or allocating IDs. Optional fields, when present, must validate; sparse reference lists reject. Payload semantics remain the capability's responsibility. Guards do not sanitize input or strip extension fields, and caller guards must themselves be pure if used in a pure context.

### Provenance and references

Origins: `current-user-action`, `trusted-meta-direction`, `deterministic-engine`, `model-derived`, `import`, `recovery-repair`, `migration`, `extension-mod`, and `background-processing`. Each retains its own discriminator; none grants trust or authority automatically.

Optional provenance fields: `actor`, `source`, `writerId`, `turn`, `message`, `modelCall`, `importSource`, `correction`, `timestamp`. Turn/message/model-call fields require the corresponding reference kind. The timestamp, if supplied, must be a valid canonical UTC instant (`YYYY-MM-DDTHH:mm:ss.sssZ`); it is validated from the supplied value only. No timestamp, ID or key is synthesized and no ambient clock/RNG is read.

`SourceReference<K>` is a discriminated union of `{ type: 'canonical', kind: K, id: StableId<K> }` and `{ type: 'compatibility', kind: K, id: CompatibilityReference<K> }`. Existing parsers validate both forms. Compatibility sources remain noncanonical. Evidence uses kind `evidence`; general source kinds remain extensible. Source metadata may refer to foreign/imported material; it does not establish ownership of the target campaign. This is command metadata, not an audit/event log or a classification implementation.

### Versions, format and ownership

`VersionPrecondition` has exactly three modes: `{ mode: 'none' }`, `{ mode: 'exact', version: ContentVersion }`, and `{ mode: 'create-if-absent' }`. `ContentVersion` is a nonblank, well-formed, opaque owner-defined string equality token, preserved without normalization. `null` actual version means absent. None permits either state, exact requires an existing equal token, and create-if-absent permits only absence. Missing/malformed exact versions, unknown modes and version values on the other modes reject. Conflicts return the actual version or `null`; no force flag, lock or transaction exists here.

`FormatEpoch` is a validated nonnegative safe integer (negative zero rejects), serializes as a JSON number and compares numerically. It is independent of content versions. New applications require equality with the active authority view; a mismatch returns `invalid-transition`, never a silent upgrade or downgrade. Historical exact retries recover their original outcome before this check. No migration or epoch increment is implemented.

`AuthorityOwnerId` identifies the permitted writing subsystem, separately branded from `AuthorityClass` (the authority category of an information record), `DomainId`, `CommandKind` and `WriterId`. Owner/kind/writer IDs use the existing lowercase dot/hyphen identifier syntax, with no fixed catalog. Writer provenance never grants ownership.

### Idempotency and router seam

`Idempotency` supports `{ mode: 'command-id' }` and `{ mode: 'caller-key', key: IdempotencyKey }`. Caller keys are explicit nonblank, well-formed strings. Missing keys, extraneous keys on command-ID mode and unprotected modes reject. No intentionally non-idempotent escape hatch is needed or supplied.

Future implementations must scope logical replay identity by campaign, domain, idempotency mode, and command ID or caller key. Owner and format epoch are historical execution metadata, never a replay namespace. Basic envelope validity is checked before historical lookup; exact semantic recovery occurs before current domain support, owner/epoch, writability and content-version checks. Duplicate requests return the original typed value/version without dispatch or application, even after cutover, epoch advancement, permitted rollback or later record changes. Routing expectations (`expectedOwner`, `expectedFormatEpoch`) may change on a retry without changing mutation semantics; caller-key retries may also change `commandId`. All other request semantics must match, including payload, provenance, content precondition and source/evidence. Changed semantics under a reused identity reject. Unseen identities still require all current routing/version checks. These are interface obligations proved by a test fixture; there is no production deduplication store or fingerprint format. Section 14 records the independent-review correction.

`DomainAuthorityLookup.inspect(campaignId, domainId)` returns an optional ephemeral `AuthorityView` containing only `owner`, `formatEpoch`, and `writable`. Slice 5 can project transition policy into this view; it is not `AuthorityTransitionState` or a persisted schema. The synchronous lookup describes an already-available view; a future async router can load state before providing it.

`DomainAuthorityRouter<K, P, R>.route(command)` returns `Promise<MutationResult<R>>`. A router capability preserves its input payload and output result types. Future implementations validate envelopes and resolve historical identity/semantics first; only unseen identities inspect current authority, select the permitted owner capability and perform atomic version/application checks. No real handler selection or routing table is implemented. Pure helpers `validateAuthorityExpectation` and `matchesVersion` make the new-application checks reusable without executing writes.

Results: `accepted` and `duplicate` carry typed `value` plus `version`; `version-conflict` carries `actualVersion`; `owner-mismatch` carries `actualOwner`; `unsupported-domain`; `invalid-transition` carries `writes-disabled` or `format-epoch-mismatch` and `actualFormatEpoch`; `malformed-command` distinguishes `invalid-envelope` and `idempotency-key-reused`. Expected conflicts use results rather than exceptions. Helpers alone do not authorize or commit a write.

The only router implementation is a small test-local in-memory fixture with one payload/capability and synthetic domain/owner. Its map and JSON comparison are proof scaffolding, not a runtime router or promised persistence/replay encoding. It demonstrates validation, owner/epoch restrictions, version conflicts, request identity checks and typed replay results without importing inventory metadata.

### Registry relationship and runtime impact

Runtime code does not consume `writer-inventory.json`. The inventory and generated Markdown remain development/migration metadata and are unchanged: 159 writers, 24 open-ended domain identifiers, zero target authority grants. `WriterId` is an optional independently validated provenance identifier, not a runtime allowlist. No real new writer exists, so no inventory update is warranted.

No model calls, writer wrapping/adapters, global command bus, queue, event ledger, registry loading, per-turn scans, persistence lookups or current authority changes were introduced. New helpers run only when explicitly invoked. Normal-turn overhead is effectively zero; existing gameplay paths do not invoke these helpers. No `.authority.json`, persisted transition state, SQLite repositories, inference classification, local-policy diagnostics or Phase 1L behavior was implemented.

### Validation and review recommendation

| Check | Result |
| --- | --- |
| New mutation/vocabulary/router tests | 104 passed in one new file |
| All engine tests | 261 passed in seven files |
| Engine purity/boundary gate | Passed |
| Explicit contract typecheck | Passed; 38 negative compiler assertions, including 24 new checks |
| Slice 3 architecture tests | 85 passed in four files |
| `npm.cmd run check:architecture` and engine build | Passed; unchanged inventory/freeze counts; existing native nonliteral import remains UNVERIFIED |
| Full application suite | 399 files; 5,455 passed, zero failures, one expected opt-in replay skipped |
| Phase 0 guardrails within full suite | 72 passed: harness 48, launcher 6, LLM queue 10, host facade 5, base-app replay 3 |
| Application build | Passed; existing Vite mixed-import and chunk-size warnings only |
| Changed-file ESLint | Passed |
| `npm.cmd run eval` | Five MATCH; baseline VALID; 30 ordinary PASS checks; two unchanged reviewed violations |
| `npm.cmd run eval:determinism` | Five BYTE_STABLE PASS and five MATCH; baseline VALID |

Compiler assertions cover command/campaign/entity separation, owner/authority/domain/writer separation, kind/domain separation, validated tokens/epoch, compatibility/canonical references, envelope IDs, contradictory version/idempotency states, and generic payload/router input/result preservation. Runtime tests cover every origin, caller-only timestamps, malformed envelopes/IDs/references, campaign scope, all version modes, epoch ordering and rejection, both protected idempotency modes, owner mismatch, unsupported domain/campaign, invalid transitions, exact/absence conflicts, replay before obsolete version checks, and identity reuse with changed payload/provenance/precondition. Test counts describe parameterized Vitest cases, not just test declarations.

The reviewed violations remain `visibility.cast-scoped.nonknower-excluded` and `visibility.hidden-absent`, disposition v1 `760d87bd17748689666d6e35650e1a61bce1b79e8ebe357d3adb7279d9422dd7`. No behavioral artifact changed; no baseline was repinned. No live-model smoke was required.

No departure from the approved Slice 4 scope. The small read-only identity accessor is necessary for command/campaign scope validation. The graph refresh command was attempted after import changes but still fails because `scripts/patch-graph-imports.mjs` is absent; no replacement graph tooling was introduced. PowerShell execution-policy limitations continue to require `npm.cmd`/`npx.cmd`.

The full suite rewrote only checkout line endings in `turnContextGolden.test.ts.snap`; its normalized content was verified against HEAD before restoring the original CRLF checkout. No golden content changed. An initial build invocation redirected through PowerShell reported a warning-stream error despite completing; a direct `npm.cmd run build` rerun exited 0.

Slice 4 is ready for independent review. No discovery requires changing Slice 5 planning: Slice 5 should supply its policy projection through the lookup/view and address atomic replay/version/ownership checks when real routing is introduced. **Stop here: do not begin Slice 5 or implement persisted transition policy/cutover mechanics.**

## 14. Slice 4 independent-review remediation — transition-safe replay identity

### Blocker and invariant

The reviewer approved the Slice 4 contracts except for replay semantics: the original fixture and documentation included owner/epoch in the replay namespace and checked current routing before history. That could make an already-applied logical mutation executable again after authority cutover or format advancement, or prevent lost-response recovery using the old prepared request.

**Authority cutover, format-epoch advancement, and permitted rollback must never make an already-applied logical mutation eligible for application again.** This remediation changes only router TSDoc, its test-local fixture/regressions and this handoff. It starts at HEAD `23f1abda87aac2a47f75820aeb9e40bb1327dc65` on `phase/1-architecture-contracts`, with the prior eight Slice 4 files already staged. Existing staging and the unrelated untracked `Slice4diff.txt` are preserved.

### Corrected identity, semantics and execution metadata

Logical identity is `(campaignId, domainId, idempotency mode, commandId-or-caller-key)`. Current/expected owner and current/expected format epoch are excluded. No new public helper or ID format is necessary.

The chosen rule is **historical duplicate recovery when only routing expectations are rebound**. `expectedOwner` and `expectedFormatEpoch` describe a prepared request's new-application expectations; neither is mutation semantics or a new identity namespace. Caller-key retries may additionally use a different command ID. All remaining request data, including kind, payload, provenance, expected content version, source and evidence references, must match the originally applied semantic request. Reused identities with changed semantics return `malformed-command` / `idempotency-key-reused`; they never execute again.

A future historical replay outcome must retain logical identity, the exact semantic request/fingerprint, the owner that actually applied it, its applied format epoch, and its original result/resulting content version. The fixture carries these fields in a test-local map, with assertions that routing rebinding neither overwrites the historical A/1 metadata nor creates another record. Its JSON comparison remains fixture-only; no serialized fingerprint, production store or persistence schema is specified.

### Ordering and stale-routing protection

After basic envelope validation, look up logical history and verify request semantics **before** current supported-domain, owner, epoch, writability and content-version checks. Basic validation must not impose the current owner's schema on historical requests: recovery compares originally recorded semantics and never reinterprets or executes an old payload against a new owner/schema. Exact retries return `duplicate` with the original result/version without dispatching to the current owner. Recovery remains valid when the policy view changes, writes are currently disabled or another command advanced the record.

Only previously unseen identities proceed through supported-domain, expected owner, expected epoch, writability and content-version checks before application. `expectedOwner` is retained as the authority owner this prepared request expects for a new application; `expectedFormatEpoch` similarly protects against a changed schema/transition epoch. The intended future producer → adapter/capability supplying current expectations → router → transition-policy view flow remains intact. Ordinary UI/domain producers need not interpret migration state.

### Regression proof

Both `command-id` and `caller-key` modes cover:

- Owner-only A/1 → B/1 cutover, epoch-only A/1 → A/2 advancement, and combined A/1 → B/2 cutover: historical duplicate and one application.
- Current writes disabled: historical outcome recovery still succeeds without application.
- Routing-expectation rebinding to B/2: historical duplicate, one application, original applied-owner/epoch metadata preserved.
- Permitted A/1 → B/2 → A/1 view projection: original and rebound retries never reapply. This models policy input only, without rollback mechanics.
- A applies at V1/result A; distinct B applies at V2/result B; retry A returns its original result A/V1 and application count remains two.
- Changed payload, provenance, version precondition, source or evidence: reused-identity rejection with both old and rebound routing expectations after cutover; application count remains one.
- Unseen identities with stale owner or epoch reject, a correctly rebound unseen command applies once, and the old command still recovers its original result afterward.

Before the fixture correction, the new/strengthened regressions produced 16 expected failures against the old behavior. After correction, all focused cases pass. The focused suite increases from 104 to 119 cases (15 net additions), and all engine tests increase from 261 to 276. No public signatures, compiler assertions, authority projection fields or application code changed.

### Validation

| Check | Result |
| --- | --- |
| Focused mutation/router suite | 119 passed |
| All engine tests and purity gate | 276 passed in seven files; boundary gate passed |
| Explicit contract typecheck | Passed, including all 38 existing negative compiler assertions |
| Slice 3 architecture tests | 85 passed in four files |
| Architecture gate / package build | Passed; unchanged 159 writers, 24 domains and 566 frozen signatures; existing native nonliteral import remains UNVERIFIED |
| Full application suite | 399 files; 5,455 passed, zero failures, one expected opt-in replay skipped |
| Phase 0 guardrails within full suite | 72 passed: harness 48, launcher 6, LLM queue 10, host facade 5, base-app replay 3 |
| Application build | Passed; existing Vite mixed-import and chunk-size warnings only |
| Changed-file lint | Passed |
| `npm.cmd run eval` | Five MATCH; baseline VALID; 30 ordinary PASS checks and the same two reviewed target violations |
| `npm.cmd run eval:determinism` | Five BYTE_STABLE PASS and five MATCH; baseline VALID; reviewed violations unchanged |

Changed-file ESLint and `git diff --check` pass. The full suite again rewrote checkout line endings in the turn-context golden; normalized content was verified against HEAD before restoring its original CRLF checkout. No golden or baseline content changed or was repinned. The two reviewed violations remain `visibility.cast-scoped.nonknower-excluded` and `visibility.hidden-absent`.

No imports or file/build configuration changed, so this pass does not require another dependency-graph refresh. The graph script remains absent as previously recorded. Architecture 002/003 and the Slice 3 inventory are untouched. No production routing, replay persistence, command outcomes, writer migration, model calls, authority state or current persistence behavior changed.

The independent-review blocker is fully resolved in the contract and regression fixture, with all required validation passing. The remediation is ready for independent review. **Slice 5 remains unstarted. Stop after this remediation: no `AuthorityTransitionState`, `.authority.json`, rollback/cutover mechanics or real router handlers are introduced.**

## 15. Slice 5 — authority transition control plane

### Starting point and scope

Branch `phase/1-architecture-contracts`, clean starting HEAD `048b041cded3abc48c397a79a4676a5d48dbca51`. Slices 1–4 were complete and independently reviewed. Pre-change eval: baseline VALID, all five scenarios MATCH, 30 ordinary PASS checks and the same two reviewed visibility violations.

This slice introduces pure transition policy and an explicit, dormant filesystem control API. No existing campaign/domain writer consults the sidecar. No live cutover, SQLite, writer adapter, production router, replay-outcome store, model-call classification or Phase 1L behavior is implemented.

### Files and boundaries

| File | Classification | Purpose |
| --- | --- | --- |
| `packages/engine/src/contracts/authorityTransition.ts` | Contract | Exact roadmap stages, strict guards, pure transition results and projection |
| `packages/engine/src/contracts/authorityControl.ts` | Contract | Versioned control document, strict validation and deterministic serialization |
| `packages/engine/src/contracts/mutation.ts` | Contract/import configuration | Three runtime imports gain `.js` extensions so Node can follow the new persistence contract dependency chain; no behavioral logic changes |
| `packages/engine/src/index.ts` | Contract exports | Public transition/control types and helpers |
| `packages/engine/package.json` | Build/package config | Two contract subpath exports for native Node ESM, avoiding the broad engine entry point |
| `server/lib/authorityControlStore.js` | Production persistence/control-plane module | Explicit load/initialize/apply API; no gameplay imports or routes |
| `packages/engine/src/contracts/__tests__/authorityTransition.test.ts` | Test | Transition matrix, parsing, invariants, serialization and lookup projection |
| `packages/engine/src/contracts/__tests__/mutation.test.ts` | Test | Both idempotency modes through actual policy projections |
| `packages/engine/typechecks/contracts.ts` | Test | Seven additional negative compiler assertions |
| `server/__tests__/authorityControlStore.test.js` | Test | Isolated temporary-directory persistence/recovery/failure tests |
| `docs/architecture/writer-inventory.json` and generated `.md` | Static development metadata | Register the real new control-plane sink without modifying legacy boundaries |
| `docs/eval/phase-1-status.md` | Documentation | Slice 5 handoff |

The sole new server module is production-capable infrastructure but is not imported by current gameplay. Existing app/server implementations, campaign file lists, backup/transfer behavior, GameContext, archive state, module tables and derived indexes are unchanged. Native Node import of the new store succeeds after the package build. No dependency or lockfile changed.

### Exact transition state and projection

All states contain `domainId: DomainId`, `legacyOwner: AuthorityOwnerId`, `formatEpoch: FormatEpoch`, `stage`, and `firstNewOwnerWrite`. The stage union uses the roadmap's exact vocabulary:

| Stage | Additional fields / constraints | Projected owner | Writable |
| --- | --- | --- | --- |
| `legacy` | Latch must be `false`; no candidate/verification fields | `legacyOwner` | Yes |
| `shadow` | Distinct `newOwner`; latch `false`; `verification: SourceReference \| null`; `cutoverPrepared: boolean`; prepared requires verification | `legacyOwner` | Until prepared; prepared is locked |
| `sqlite` | Distinct `newOwner`; required verification reference; boolean latch | `newOwner` | Yes |
| `retired` | Distinct `newOwner`; required verification reference; latch must be `true` | `newOwner` | Yes |

`sqlite` names the future authority stage; no database exists in this slice. `retired` means legacy retirement, not retirement of the new writing owner. Verification and the cutover lock are shadow-stage metadata rather than invented stages. There is one derived active owner, never two independently writable authority flags. Unknown fields, same legacy/new owner, contradictory latch/readiness states, malformed references/IDs/epochs and unknown stages fail validation. `projectAuthorityView(unknown)` returns `undefined` on invalid input and otherwise returns exactly the existing `{ owner, formatEpoch, writable }` seam; no breaking change was needed.

### Transition API, latch and epochs

`transitionAuthority(current, domainId, operation)` returns either `{ status: 'transitioned', state }` or `{ status: 'rejected', reason }`. It does not mutate inputs or perform IO. Initialization is explicit and duplicate initialization rejects. Every subsequent operation requires `expectedOwner` and `expectedFormatEpoch` matching the current projection.

| Operation | Allowed state and effect |
| --- | --- |
| `initialize` | Missing entry → legacy, with explicit legacy owner and initial epoch |
| `begin-shadow` | Legacy → shadow, with distinct explicit candidate owner |
| `verify` | Unlocked shadow → record caller-supplied verification source reference |
| `prepare-cutover` | Verified shadow → locked shadow; legacy remains sole owner but writes disabled |
| `commit-cutover` | Locked verified shadow → sqlite; caller must supply a strictly higher epoch |
| `mark-new-owner-write` | Sqlite → latch `true`; repeating it is monotonic/idempotent |
| `abort` | Any shadow readiness state → legacy, unchanged epoch; no new-owner application has occurred |
| `rollback` | Sqlite with latch `false` → legacy at an explicitly higher epoch |
| `retire` | Sqlite with latch `true` → retired, same owner/epoch/latch |

Typed rejection reasons: `malformed-state`, `malformed-operation`, `duplicate-initialization`, `uninitialized-domain`, `wrong-stage`, `owner-mismatch`, `epoch-mismatch`, `illegal-epoch`, `verification-required`, `rollback-prohibited`.

Only explicit cutover/rollback operations advance epochs; they never decrease them. A rollback restores legacy authority under a fresh compatibility/control generation rather than reusing the old epoch. Other operations and load/save never advance format epochs. The document revision is a separate optimistic concurrency counter and is not a content version or format epoch.

The latch starts false and cannot be cleared by any API operation after it becomes true. True authority rollback after the first successful new-owner authoritative write rejects, including from retired state. Recovery then means fix-forward or separately verified snapshot restoration with loss-of-later-work disclosure, not reactivation of stale legacy writers. This slice does not implement snapshot restoration or real writes. Future domain adoption must durably coordinate the latch with its first successful authoritative application, enforce quiescence/final snapshot verification, and validate the referenced verification/recovery artifacts; a reference here is a caller assertion, not execution of those gates. Retirement conservatively requires a successful new-owner write before retiring the legacy path.

### Sidecar persistence and missing-file semantics

Default path: `${DATA_DIR}/authority/<storageId>.authority.json`. `storageId` is the existing filesystem-safe legacy campaign key (validated by `validateCampaignId`); the canonical `StableId<'campaign'>` is explicitly supplied and stored/checked inside the document. Stable ID serialization contains Windows-unsafe path characters, so it is not used as a filename. The dedicated `authority/` directory isolates sidecars from broad `campaigns/` save/replacement/import/delete paths. This location follows the existing configurable DATA_DIR convention without changing current campaign file enumeration.

Schema: `{ schemaVersion: 1, campaignId, revision, domains: AuthorityTransitionState[] }`. Entries are sparse and per validated, open-ended DomainId; no current 24-domain catalog is materialized. Duplicate domains reject. Unknown control fields reject; no fictional values, writer inventory, command history, replay outcomes, prompt history or cached decisions are stored. Serialization sorts domain entries and object keys and ends with one newline, so caller insertion order does not affect output.

`createAuthorityControlStore(directory?)` exposes:

- `load(storageId, campaignId)`: validated read, never creates/repairs state or advances an epoch.
- `initialize(storageId, campaignId)`: explicit creation of an empty revision-zero sidecar only if absent; never resets an existing sidecar.
- `apply(storageId, campaignId, expectedRevision, domainId, operation)`: reload/validate under lock, reject stale revision, run the pure transition, and atomically save only a successful new state. There is no arbitrary whole-document save/reset API that could clear the latch.

Missing file returns `missing`; missing domain means unadopted legacy/default policy. Both preserve current legacy behavior and grant no candidate authority. No sidecars are created when existing campaigns are normally loaded. Future callers must supply their known legacy owner/epoch policy for absent entries rather than guessing a target owner; unsupported domain policy is not inferred from the writer registry. Transition entries and sidecar creation require explicit initialization actions.

Load validates JSON, schema, canonical campaign identity, revision and every state before returning `loaded`. Corruption returns `malformed`; identity mismatch returns `campaign-mismatch`; an invalid supplied canonical campaign returns `invalid-campaign`. IO failures return `io-error`; no load error silently becomes a legacy fallback. Invalid filesystem storage IDs reject via the existing validation exception before accessing a path. Missing and malformed are intentionally different outcomes.

Cooperating writes take an exclusive `.lock`, compare document revision, exclusively create a sibling `.tmp`, write deterministic text, fsync the file, close and atomically rename/replace. Failed rename preserves the old sidecar. Temp cleanup removes only the file owned by the current attempt. Pre-existing lock/temp artifacts return `busy` and remain untouched for inspection; no automatic recovery guesses. Other results include `saved`, `already-initialized`, `revision-conflict`, `invalid-revision`, `revision-exhausted` and the typed transition rejection. Lock cleanup/IO failure can report `io-error` after replacement; callers must reload before retrying. This is local cooperating-writer serialization and atomic single-file replacement, not a cross-store transaction or a guarantee against every filesystem/power-loss failure.

### Slice 4 compatibility, inventory and future recovery work

Logical command identity remains campaign/domain/mode/command-ID-or-caller-key, independent of owner/epoch. Historical replay semantics and ordering are unchanged. The new tests project actual initialized/shadow/locked/sqlite/rolled-back states into the existing test router and recover the original result in both modes without reapplication, including rebound routing expectations. New unseen requests retain owner/epoch/writability checks.

Durable replay-outcome storage belongs with later real transactional routing; `.authority.json` is not that store. Before any live adoption, later migration work must also integrate control-plane metadata with coherent backup/export/restore/delete and handle a lost sidecar for a known-migrated campaign as recovery failure rather than guessing legacy authority. Current generic lifecycle operations intentionally do not rewrite or adopt these sidecars. No real campaign has target authority from this slice.

Static inventory now has 160 entries: all previous 159 unchanged plus `sink.authority-control`, an operational-metadata sink under the existing `recovery-metadata` domain. Counts: 134 producers, 26 sinks, 24 domains, eight competition groups, zero target-authoritative gameplay owner grants; freeze remains 566 signatures in 142 files. The generated inventory Markdown was regenerated through the gate. No runtime code reads that inventory. No concrete domain schema is inferred from it.

### Validation and stop gate

| Check | Result |
| --- | --- |
| New transition/control/projection tests | 63 passed |
| Existing mutation/router suite with two new projection/replay cases | 121 passed |
| All engine tests and purity gate | 341 passed in eight files; boundary gate passed |
| Sidecar persistence tests | 20 passed in isolated temporary directories |
| Explicit contract typecheck | Passed; 45 negative assertions (seven added) |
| Slice 3 architecture tests / gate | 85 passed in four files; gate PASS with counts above |
| Native Node module import | Passed |
| Package/application build | Passed; existing Vite mixed-import/chunk warnings only |
| Changed-file lint | Passed for TypeScript and explicit Node ESLint rules for server JS |
| Full application suite | 400 files; 5,475 passed, zero failures, one expected opt-in replay skipped |
| Existing filesystem regressions within full suite | 35 passed: archive atomic write 5, backup 12, legacy transfer 10, location transfer 1, mod-table transfer 7 |
| Phase 0 guardrails within full suite | 72 passed: harness 48, launcher 6, queue 10, host facade 5, base-app replay 3 |
| `npm.cmd run eval` | Five MATCH; baseline VALID; 30 ordinary PASS checks; two unchanged reviewed violations |
| `npm.cmd run eval:determinism` | Five BYTE_STABLE PASS and five MATCH; baseline VALID; reviewed violations unchanged |

Tests cover the complete stage/operation matrix, every projection, strict malformed parsing and single-owner rules, immutable transition behavior, rollback before/after the latch, explicit epoch movement, serialization, sparse domains, duplicate entries, missing files, corrupt JSON/schema/state, identity mismatch, stale revisions, restart-persistent latch protection, failed atomic replacement and lock/temp recovery evidence. Relevant backup/transfer/archive atomic-write and Phase 0 suites run in the full application suite. Existing tests remain unchanged except the two additive real-projection replay cases.

The initial persistence test invocation used a Node environment incompatible with the root DOM setup and failed before tests; using the established root test environment resolved that configuration mismatch without changing global setup. The full suite rewrote only checkout line endings in the turn-context golden; normalized contents were checked against HEAD before restoring CRLF. No golden changed. The required graph-refresh command was attempted after import/config changes but still fails because `scripts/patch-graph-imports.mjs` is absent. No replacement graph system was added.

No roadmap-driven departure: the exact stages and irreversible first-write rule are preserved. Verification/lock flags are stage readiness, and the isolated directory, explicit storage-key/canonical-ID binding and Node-compatible subpath exports are implementation details. No live writer or router behavior changed; no model calls or normal-turn persistence lookups were added. No baseline was repinned and no live-model smoke was needed.

Slice 5 is ready for independent review with all required validation passing. Later adoption must account for the documented latch/transaction and backup/replay dependencies; no discovery requires expanding the next Phase 1 slice. **Stop after Slice 5: no later Phase 1 slice, real domain cutover, SQLite, live router insertion, writer adapter, model-call classification, local-policy diagnostics or Phase 1L work is started.**

## 16. Slice 5 independent-review remediation — closed verification references

### Blocker and correction

The reviewer approved the transition/persistence model except for one nested-schema leak: general Slice 4 `isSourceReference` accepts extra properties, so a verification reference could smuggle fictional state, approval flags or arbitrary metadata into the authority sidecar. State/operation validation previously delegated directly to that permissive guard.

The local, unexported `isVerificationReference` helper in `authorityTransition.ts` now requires exactly three enumerable own fields: **`type`, `kind`, `id`**. Additional own keys, including nonenumerable or symbol keys, reject. Existing `isSourceReference` still validates the reference form, kind and canonical/compatibility ID semantics; no new identity type or format is introduced. The helper is used for shadow/sqlite/retired verification and verify-operation inputs. `AuthorityControlDocument` validation and serialization inherit this check through state validation, and real load/apply use those same guards.

**Authority sidecar schema v1 is closed recursively for Slice 5-owned JSON structures.** Nested verification objects permit only `type`, `kind`, `id`; unknown nested fields fail closed rather than being stripped or saved. This statement does not apply to general SourceReference objects elsewhere: the Slice 4 parser and command metadata behavior are unchanged, with explicit regression assertions proving it remains permissive.

Verification is still only a caller-supplied reference to evidence/recovery material; it does not prove that verification ran. Richer results, hashes, approval flags or metadata require an explicit future versioned schema, not extra properties on this reference.

### Regression proof and files

Both canonical and compatibility forms now cover:

- Exact references accepted through pure transition → deterministic serialization/parse and real store transition/save/load.
- `fictionalState`, `cutoverApproved`, arbitrary nested metadata and scalar extra properties rejected by verify operations as `malformed-operation`.
- Every verification-bearing state/readiness variant rejects extended references, cannot project a permissive AuthorityView and fails document validation/serialization.
- Real store verify rejection leaves the original file bytes and revision unchanged.
- Extended references manually placed in otherwise-valid shadow/sqlite/retired documents fail validation and return `malformed` on real load. Initialize and apply return `malformed` and leave the corrupt file untouched, without repair or replacement.

Eight new parameterized cases failed against the old guard before the correction. All new cases pass afterward: ten added engine cases and sixteen added store cases.

This remediation starts on `phase/1-architecture-contracts`, HEAD `048b041cded3abc48c397a79a4676a5d48dbca51`, with the prior Slice 5 checkpoint already staged. Existing staging is preserved. Exactly four files change relative to that staged checkpoint:

| File | Classification |
| --- | --- |
| `packages/engine/src/contracts/authorityTransition.ts` | Pure contract guard and TSDoc |
| `packages/engine/src/contracts/__tests__/authorityTransition.test.ts` | Pure transition/document/reference tests |
| `server/__tests__/authorityControlStore.test.js` | Real-store roundtrip/rejection/no-write tests |
| `docs/eval/phase-1-status.md` | Review remediation handoff |

No transition stage/matrix, latch, rollback rule, epoch, path, schema version, revision, projection policy, replay identity, lifecycle integration or persistence field changed. The general SourceReference implementation, server persistence module and writer inventory are untouched in this remediation. No gameplay behavior or live routing changed, and no new model calls or persistence activity were introduced into gameplay.

### Validation and stop gate

| Check | Result |
| --- | --- |
| Focused transition/control tests | 73 passed (ten added) |
| Real authority-control-store tests | 36 passed (sixteen added) |
| All engine tests / purity gate | 351 passed in eight files; boundary gate passed |
| Explicit contract typecheck | Passed; existing 45 negative compiler assertions |
| Architecture tests / gate and package build | 85 passed in four files; gate PASS with unchanged 160 writers, 24 domains, 566 frozen signatures |
| Changed-file lint | Passed for TypeScript and explicit Node ESLint rules for server JS |
| Application build | Passed; existing Vite mixed-import/chunk-size warnings only |
| Full application suite | 400 files; 5,491 passed, zero failures, one expected opt-in replay skipped |
| Existing filesystem regressions within full suite | 35 passed: archive atomic write 5, backup 12, legacy transfer 10, location transfer 1, mod-table transfer 7 |
| Phase 0 guardrails within full suite | 72 passed: harness 48, launcher 6, queue 10, host facade 5, base-app replay 3 |
| `npm.cmd run eval` | Five MATCH; baseline VALID; 30 ordinary PASS checks; the same two reviewed target violations |
| `npm.cmd run eval:determinism` | Five BYTE_STABLE PASS and five MATCH; baseline VALID; reviewed violations unchanged |

Changed-file lint and `git diff --check` pass. The full suite again changed only the turn-context golden's checkout line endings; normalized contents were verified against HEAD before restoring CRLF. No golden content or baseline changed or was repinned. The known violations remain `visibility.cast-scoped.nonknower-excluded` and `visibility.hidden-absent`.

The required graph-refresh command was attempted after test import changes and still fails because `scripts/patch-graph-imports.mjs` is absent. The architecture gate retains the known native nonliteral import marked UNVERIFIED. These are existing limitations, not new blockers.

The independent-review blocker is fully resolved with all required validation passing; the remediation is ready for independent review. No broader Slice 4 behavior changed. **Stop after this remediation: the next Phase 1 slice remains unstarted.**

## 17. Slice 6 — frontend inference classification and observability

Starting point: branch `phase/1-architecture-contracts`, clean HEAD `e1fea6d8809924591803d6ce089a77adbb1b1d4d`. Roadmap 003 Phase 1 supplies the `ModelCallPurpose` contract, ledger classification and unchanged-call acceptance criteria; architecture 002 sections 21/23 describe later local-profile policy, not behavior to implement here. No separate approved Phase 1 plan is present in this checkout; the existing roadmap, status and Slice 6 brief determine this bounded slice.

### Contract and single inventory source

`packages/engine/src/contracts/inference.ts` defines the platform-pure `ModelCallPurpose`, `InferenceRole` and `InferenceClassification` contracts, exported through the existing engine entry point. The guard rejects missing/unknown dimensions, malformed operation names and extra own fields. These are descriptive dimensions, not a scheduler, provider adapter or capability profile:

- Purpose: `story`, `planning`, `extraction-analysis`, `summarization`, `npc`, `relationship-knowledge`, `embedding`, `vision-media`, `extension`, `utility`.
- Operation: a validated lowercase dotted/hyphenated family name; open-ended rather than a frozen provider catalog.
- Trigger: `explicit-user-action`, `mandatory-foreground-turn`, `automatic-foreground`, `automatic-post-turn`, `manual-utility`, `extension-action`.
- Execution: `foreground`, `background`.
- Direct wait boundary: `visible-story`, `turn-commit`, `post-turn-completion`, `nothing-user-visible`.
- Role: existing host `story`, `auxiliary`, `utility`, `summariser`, `raw-auxiliary`, `raw-summariser`, plus inventory boundaries `embedding`, `media`, `caller-selected`.
- Requirement: `required-story-completion`, `optional`. Optional describes successful Story requirements, not whether current enabled orchestration awaits a call.

These dimensions remain independent: an extraction call can use the Story endpoint; an optional auxiliary can block Story; background work can still affect later state. The direct wait boundary is not a transitive latency guarantee: commit-blocking work can delay the next Story, and any background request can occupy a shared endpoint.

The sole family/site source is [`inference-inventory.json`](../architecture/inference-inventory.json); [`inference-inventory.md`](../architecture/inference-inventory.md) is generated from it. It contains 43 descriptive families and 102 recognizable frontend sites. Known direct calls and bound canonical callbacks reference their exact families; shared forwarding/provider transports retain qualified possible-family lists. The family table gives every current value and the per-family qualification without a second manually maintained table here. `npm run check:inference` builds the engine then checks validated unique families, source-site additions/removals, registered family references and generated documentation freshness. Regenerate only the projection with `node scripts/architecture/check-inference.mjs --write-doc`. Site capture deliberately requires review/reassignment before the gate passes; it is not automatic certification.

### Canonical frontend coverage and current waits

The catalog covers Story generation and its tool-continuation invocations; auxiliary Director; utility archive planner/recommender, query expansion, semantic rerank and chapter funnel; relationship stance; auxiliary character-intro location resolution; manually armed deep-search ranking/summarization; commit-time scene-stakes fallback; awaited archive importance and NPC candidate validation; queued NPC update/drive backfill, bookkeeping/profile/trait/inventory/location/PC checks, relationship memory, chapter sealing, event extraction and timeskip narration. Coverage means possible logical frontend calls, not a claim all run on every tier/turn. Gates and existing availability/fallback behavior remain unchanged.

Source details matter: stance is awaited through `contextGatherer` despite its nonblocking prose comment; importance is awaited before archive append; NPC validation belongs to the awaited post-turn track set. These block Story or commit today. Post-commit tracks are launched without awaiting their promises, and queued bookkeeping/chapter seal/timeskip work blocks nothing directly user-visible. Event extraction's legacy provider-only condition can suppress it on the facade path; registering it does not enable it. Timeskip selects utility when available, otherwise Story; its label alone cannot prove that choice, so the catalog explicitly reports `caller-selected`, not an invented fixed role. All original fallback paths remain intact.

### Phase 0 integration and limits

`observe.ts` still creates exactly one canonical `ModelCall` per observed `sendMessage`/`llmCall` invocation. Its additive `inference` field contains the same ordinal as `logicalInvocation` and a validated classification. Provider retries remain existing child `attempts`; classification is attached once before dispatch and survives retries. Existing turn/phase/ordinal fields supply correlation without a new identity or call store. Missing classification adds an observation violation. The unlabeled canonical character-intro helper receives development-only asynchronous scope, preserving its original label and request. No production caller or provider module imports this catalog or observer.

The frozen Phase 0 schema-0 artifact still serializes every original call field through explicit `phase0CallProjection`; classification remains on the very same live/captured call record returned by `runScenario` and its capture hook. This preserves baseline bytes without repinning or silently changing the reviewed artifact schema. There is no second ledger, parallel attempt collection or new persisted telemetry. Existing replay I/O still independently enforces declared traffic; a catalog entry never authorizes a provider request. Director remains optional/behavioral, and Story completion remains required. Existing Story-only/reordered/extra recognized Director comparisons and undeclared/malformed/unaccounted-traffic rejection are unchanged.

The observer/catalog describe canonical orchestration contexts. Reusing a labeled helper manually does not prove its automatic trigger/wait boundary; that caller needs explicit context before broader runtime certification. Peripheral label coverage includes swipe/continue, Ask-GM handoff summary, relationship/fact utilities, synopsis/witness and location tools. Guided creation, NPC profile/propose, imports, OOC, lore/world-builder/rules tools, manual chapter summary/header-index, arc/troublemaker and divergence/tag tools are explicitly inventoried as unlabelled/dynamic manual utility debt; no false per-invocation certification is claimed.

Vision uses its own queued fetch path. Scene images, speech and semantic embedding work delegate to server services, including deferred archive NLP/model work; frontend HTTP awaits do not reveal server cache hits, batch cardinality, model identity or provider attempts. The inventory records these boundaries, including embedding work during semantic lookup/archive writes. Dynamic compute/native modules and provider leases can supply labels/roles and bypass named helpers; purpose, scheduling and nested attempts remain opaque until observed. The static gate detects recognized direct named calls and host-model calls, not arbitrary aliases, computed access, raw provider fetches or external module source. These remain explicit review/migration debt rather than supported new unclassified behavior.

### Validation handoff and runtime impact

Implementation-focused validation after review remediation: 24 new frontend classification tests pass, including real Pro orchestration, real planner/unlabelled intro/importance/event helpers, the existing utility retry path, metadata identity, unchanged order/count, peripheral boundaries and the exact-site/background assertions below. All 12 existing replay-policy tests pass unchanged. The new engine contract suite checks every purpose/role/trigger, invalid/missing dimensions and independent execution/requirement/wait semantics. Broader validation and independent review results follow in the final handoff.

No calls were added or removed; no prompt, provider route, model setting/policy, fallback, retry, stream, tool recursion, context packing or turn ordering changed. Production inference call sites are unchanged. No model-policy diagnostics, scheduling/latency optimizations, Slice 7 or Phase 1L behavior is implemented. Slice 6 supplies descriptive evidence for those later decisions; it does not decide which optional call should move or disappear.

### Independent-review remediation — exact site references and location launch semantics

Review identified two metadata blockers. The initial file-wide family hints were too coarse for known bound callbacks, and location enrichment was incorrectly marked foreground. The correction changes only inventory metadata, its generated projection, development-gate explanatory text, focused tests and this handoff.

Twenty-one site mappings were corrected. `gatherPlannerSceneIds` references only archive planner; `gatherArchiveRecall` and `gatherMemoryRecallViaRole` reference archive funnel. `runCommitPendingTurn` references scene-stakes classification. `runArchiveTrack` distinguishes its importance callback from the shared profile/trait/inventory/location bookkeeping callback. `brokerJsonCall` references NPC update/drive backfill, while `runNPCTrack`'s validator references NPC validation. `runIntroEngineStage`, `runDirectorStage` and `runGenerationStage` now reference only character intro, Director and Story respectively. Native call/callJson and sandbox model bridges reference extension model access. `generateNPCPortrait`'s direct portrait/landscape provider call references the existing media family, whose note now explicitly includes that path. Six shared host/provider transport entries name their broader possible caller families and preserve dynamic-boundary notes; host brokerage is no longer described as extension-only, nor streaming transport as Story-only.

`queueLocationEnrichment(...): void` in `src/services/locationEnrich.ts` starts a fire-and-forget asynchronous IIFE and returns before `fetchEnrichment` completes. The existing location-enrich classification now correctly says background, retaining manual-utility trigger and nothing-user-visible wait boundary. No launch/await/provider code changed.

Sixteen source-symbol-specific mapping cases, one shared-transport case and one location-background/void-signature case were added. Focused verification passes: 24 classification tests plus all 12 existing replay-policy tests (36 total), and the inference gate remains 43 validated families / 102 sites. Generated Markdown was regenerated from the same JSON source. Parent-owned final validation and blocker-only independent re-review determine readiness; no review verdict is inferred from implementation tests alone.

### Broad validation

| Check | Result |
| --- | --- |
| New frontend classification tests, after review remediation | 24 passed |
| Existing Phase 0 replay-policy tests | 12 passed unchanged |
| New engine inference contract tests | 38 passed |
| All engine tests / purity gate | 389 passed in nine files; boundary gate passed |
| Engine build / explicit contract typecheck | Passed |
| Application build | Passed; existing mixed-import/chunk-size warnings only |
| Full application suite, before metadata-only review remediation | 400 files passed; 5,497 tests passed, one expected opt-in replay skipped (401 files total) |
| Existing architecture tests, included in full suite | 85 passed in four files |
| Writer / extension freeze gate | PASS: unchanged 160 writers, 24 domains, 566 signatures |
| Inference inventory gate | PASS: 43 families, 102 recognizable sites; generated documentation current |
| Changed-file lint | Passed for all changed TypeScript and explicit Node ESLint rules for the new script |
| `npm.cmd run eval` | Five MATCH; pinned baseline VALID; 30 ordinary PASS checks |
| `npm.cmd run eval:determinism` | Five BYTE_STABLE PASS and five MATCH; pinned baseline VALID |

The first full-suite run had one failure in the unchanged randomized world-map connection test: the emitted travel target was a generated point instead of `c`. That file passed all 22 tests when rerun, and the subsequent full suite passed without code changes. Both runs are recorded; no unrelated test/runtime repair was made. The turn-context golden's normalized content was verified identical to HEAD before restoring its test-induced checkout line-ending change. No snapshot content or pinned baseline was changed or repinned.

The two reviewed target violations remain exactly `visibility.cast-scoped.nonknower-excluded` and `visibility.hidden-absent`. The required graph-refresh command was attempted and still fails because `scripts/patch-graph-imports.mjs` is absent. The writer gate still reports the existing native nonliteral import as UNVERIFIED. No live-model smoke was needed because inference behavior is unchanged.

### Final independent review and checkpoint recommendation

A fresh GPT-6.1 Sol High reviewer, separate from the GPT-6.1 Sol Medium implementer, initially returned REQUIRES FIXES for the two metadata blockers above. Blocker-only re-review returned **READY WITH NONBLOCKING NOTES**, independently confirming all 36 focused tests, the 43-family/102-site gate, generated-document freshness and diff checks. Both blockers are resolved. The remaining editorial note named the wrong enrichment helper; that wording was corrected to `fetchEnrichment` in the source inventory and this handoff, and the generated projection was refreshed. No further review cycle was requested for that wording correction.

After remediation, both eval commands were repeated successfully: five MATCH, five BYTE_STABLE PASS, baseline VALID and the same two known target violations. Focused final tests pass 36/36; final changed-test/script lint and inventory checks pass. The broader suite/build/engine results above precede metadata-only remediation; production inference code stayed unchanged throughout.

Exact Slice 6 files changed or added:

- `docs/architecture/inference-inventory.json`
- `docs/architecture/inference-inventory.md` (generated)
- `docs/eval/phase-1-status.md`
- `package.json`
- `packages/engine/src/contracts/inference.ts`
- `packages/engine/src/contracts/__tests__/inference.test.ts`
- `packages/engine/src/index.ts`
- `scripts/architecture/check-inference.mjs`
- `src/eval/__tests__/inferenceClassification.test.ts`
- `src/eval/__tests__/support/inferenceClassification.ts`
- `src/eval/__tests__/support/observe.ts`
- `src/eval/__tests__/support/runScenario.ts`
- `src/eval/__tests__/support/types.ts`

**Slice 6 is complete and ready to checkpoint.** Changes remain uncommitted on the existing branch. No merge, Slice 7, local-policy diagnostics or Phase 1L work was performed.
