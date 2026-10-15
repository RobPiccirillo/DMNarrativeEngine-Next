# Phase 1 implementation handoff — Slices 1–2

Status: implemented, ready for independent review. Slice 3 has not started. This note records the implementation starting point and the additive identity/classification contracts; it does not claim completion of Phase 1 as a whole.

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
