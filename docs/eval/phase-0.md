# Phase 0 evaluation harness v0

The harness observes the current legacy runtime. It runs the real frontend `runTurn()` → provider request formatting and stream parser → pending draft → `commitPendingTurn()` → core post-turn tracks. Fetch supplies a small, stateful, synthetic campaign API. No app backend, model, vault, user settings, or campaign directory is read in offline mode.

**The deterministic baseline is pinned and valid.** All five scenarios still MATCH it, with two reviewed legacy narrator exposures reported as known target violations rather than PASS or approved architecture. The first actual seven-turn smoke exposed empty visible responses through Ollama's OpenAI-compatible endpoint. Native Ollama support and stricter live acceptance address that transport issue; final Phase 0 review remains required before Phase 1. See `phase-0-status.md` for current live evidence.

## Commands

Install the lockfile with `npm ci`. In PowerShell environments that disable `npm.ps1`, use `npm.cmd` for these commands.

| Command | Behavior |
| --- | --- |
| `npm run eval` | Fresh worker per scenario, normative assertions, categorized comparison against the reviewed baseline. Fails for normative violations, invalid/incomplete artifacts, or an unpinned baseline. |
| `npm run eval:record` | Writes candidates under `.eval-output/current/`; never writes `eval/baselines/`. Ordinary failures remain fatal; exactly matched reviewed violations remain prominently visible. |
| `npm run eval:determinism` | Two independent worker sets; each worker also repeats its scenario and disposition-aware assertions. Checks exact result bytes and hashes. Fails for ordinary assertions, changed/missing violations, incomplete runs or instability. |
| `npm run eval:live -- --config .eval-output/live/config.json` | Explicit seven-turn inference run using an ignored local configuration. |
| `npm run test:run -- src/eval/__tests__/harness.test.ts` | Harness correctness, privacy, stream parsing, timing, cleanup, focused comparison, and controlled-provider smoke tests. |

The existing `test`, `test:run`, `test:base-app-gate`, and `test:coverage` scripts are preserved. Ordinary tests skip the replay command entry when no `EVAL_SCENARIO` is selected. The `.smoke.ts` entry is outside ordinary test matching. Both opt-in configs retain the existing jsdom environment, setup file and application-version definition; they override the test include list instead of concatenating it.

## Scenarios and assertions

| Scenario / version | Turns | Normative coverage |
| --- | --- | --- |
| `canonical-commit` / 1 | 1 | Fixed-seed DC changes; no archive append at generation; commit anchor and retired working markers; final user input plus dice outcomes; Story dispatch accounting. |
| `stale-holder-supersession` / 1 | 1 | Real lifecycle merge retains superseded holder; active successor reaches established facts; replay does not reactivate the old entry. |
| `scoped-secret-cast-change` / 1 | 2 | Actual Story wire visibility; ordinary knower inclusion and public-cache checks; separately reported nonknower and fully hidden target violations. |
| `manual-correction-retention` / 1 | 2 | Real manual edit and dedicated divergence PUT; synthetic persistence read/rehydration; correction retained in next prompt and after commit. |
| `call-ledger-pro` / 1 | 2 | Director and Story use real nonstreaming/streaming parsers; every HTTP attempt is associated with its logical invocation; Story once per turn. |

All use synthetic base-app factories, zero mods, seed 12345, and explicit commits. The first four use Lite; the ledger fixture uses current Pro behavior. The extra blocking Director call is behavioral output, not a Phase 0 defect. Bookkeeping increments normally. Utility endpoints, relationship memory, intro generation, deep search and automatic condensation are absent/disabled by fixture state.

`support/types.ts` defines the machine-readable result and manifest types. `support/artifacts.ts` validates result/category field allowlists and rejects unsafe values and fields. `assertions.ts` executes ordinary Vitest assertions with stable IDs. `support/knownTargetViolations.ts` classifies only the two explicitly reviewed failures after those assertions execute. Fatal assertion errors remain in the worker log. Updating a behavioral snapshot cannot clear a normative failure or suppress a target violation.

## Corrected fixture and reviewed legacy violations

Only the scoped eval fixture overrides `rulesBudgetPct` to `0.10`, retaining `contextLimit: 4096`. The inherited shared base-app fixture contains `10`; production interprets this setting as a fraction. That reserved 40,960 tokens and collapsed downstream allocations. The correction admits the 45-token Scoped Knowledge contribution. The shared base-app fixture and golden, production calculation and default rules behavior are unchanged.

All provider-wide visibility checks read the actual captured streaming Story request in `calls-and-tokens.calls[].attempts[].request.messages`. Cached assembled payloads remain separate behavioral evidence. A unit test mutates the cache without affecting wire visibility, then mutates the wire and proves knower inclusion fails.

- `visibility.cast-scoped.knower-included` is an ordinary required PASS. Mira receives the token fact through the admitted scoped block.
- `visibility.cast-scoped.nonknower-excluded` executes normally and reports `KNOWN_TARGET_VIOLATION`. Aldric receives the token fact only through legacy `UNKNOWN FACTS`, with no scoped-block copy.
- `visibility.hidden-absent` executes normally and reports `KNOWN_TARGET_VIOLATION`. The royal-seal secret appears only in legacy `UNKNOWN FACTS`: one occurrence on turn one, two on turn two because active NPC context contains both NPC entries. These are runtime boundary copies, not fixture/history/lore duplicates.
- `visibility.fixture-isolated` and `visibility.public-cache` are ordinary PASS requirements. Fixtures and replay responses do not duplicate the secret facts into history or lore.

These are **reviewed legacy violations preserved to establish before/after migration evidence**. They are not accepted target behavior and must later turn green through explicit review. Phase 6 replaces the legacy per-NPC boundary with sparse epistemic views. Phase 9A owns final provider-wide need-to-know enforcement. Phase 8C must ensure retrieval does not reintroduce hidden claims, but is not the primary owner of these current failures.

The minimal disposition is `fixtures/known-target-violations.json`, version 1. Each of its two entries records the assertion ID, rationale, responsible phases and exact reviewed failure condition. A reviewed hash covers the version and entries. Matching requires the failed absence requirement, turn/cast identities, exact total wire occurrences, exact legacy UNKNOWN FACTS occurrences and absence from scoped blocks. An unlisted failure, missing/duplicated assertion, unexpected PASS, changed failed subcondition or edited disposition hash is fatal/requires explicit review. A future fix cannot silently erase the violation.

The complete list/version/hash is included in candidate and pinned-baseline provenance and top-level reports. Existing baseline comparison rejects a missing or different disposition even if behavioral JSON matches. Editing an entry requires disposition review and corresponding baseline review; behavioral snapshot acceptance alone cannot alter it. No waiver dates, owners, expiry or issue-tracker policy are introduced.

## Deferred 4K prompt-budget limitation

The default rules contribute roughly 4,666 `cl100k_base` tokens, the stable preamble roughly 4,697, and legacy recorded requests can exceed 5.3K input tokens against a nominal 4096 context before reserving output. These estimates describe the existing runtime, not target-model tokenizer measurements. This is a separate deferred target-architecture issue, **not the cause of the scoped-block omission after correcting the fraction**.

Phase 9A owns output-first packing, 4K/8K/16K profiles, compaction, protected-content prioritization, and explicit degradation/failure when protected context cannot fit. No new Phase 0 fatal assertion or production prompt change is introduced for this limitation. The actual local smoke can later supply useful measurements.

## Artifact and comparison contract

Each scenario produces separate files:

```text
.eval-output/current/<scenario>.json
.eval-output/current/<scenario>.assertions.json
.eval-output/current/<scenario>.comparison.json
.eval-output/current/<scenario>.worker.log
.eval-output/current/manifest.json
.eval-output/report.json
.eval-output/report.md
```

The behavioral JSON contains seven categories: `prompt`, `retrieval`, `effects-and-writes`, `calls-and-tokens`, `messages`, `state`, `diagnostics`. It captures ordered provider messages and trace decisions, selected source IDs/content, callback effects, selected store changes, write order, API traffic, started track/job outcomes, call attempts, token estimates, pending/committed messages and selected legacy state. Request bodies are projected without auth/proxy envelopes; the provider/model are synthetic aliases. Source IDs stay intact. Generated message, swipe and location IDs receive consistent result-local aliases.

Serialization recursively orders object keys, preserves every meaningful array order, uses UTF-8, two-space indentation, LF and one trailing newline. It rejects cycles, unsupported classes/values and nonfinite numbers. Performance timestamps and durations never enter deterministic results. The existing `cl100k_base` tokenizer is an estimate; provider-reported usage is stored separately and is `null` when unavailable.

Changed snapshots produce `REVIEW_REQUIRED` with category, structural path and old/new values. With a valid pinned baseline, behavioral differences alone exit successfully. Ordinary PASS assertions and matched `KNOWN_TARGET_VIOLATION` results allow recording/review; the latter never count as PASS. Missing/unreviewed/invalid baselines and incomplete runs fail comparison. Candidate recording cannot accept or overwrite a baseline. Focused-diff tests mutate prompt text, retrieval identity/order, call attempts and state/effects without changing production.

Privacy uses narrow projections, category allowlists and rejection of credential/header fields, absolute paths, endpoint URLs, operational timestamps and stacks. Only synthetic factory data can enter the run. Output directories and local live configuration are ignored. Do not copy worker logs, live text or performance files into committed artifacts.

## Determinism and quiescence

The launcher sets UTC and `en_US.UTF-8`, uses the locked dependencies and starts a new Vitest process for each scenario. The same worker's two turns intentionally share state. The determinism command also repeats scenarios in-worker to detect contamination.

Replay fixes the application clock and seeded engine RNG. Controlled fake timers progress zero-delay work and small one-millisecond scheduler steps, bounded to 2000 steps per awaited operation; they do not run all future request deadlines. Small host event-loop yields let lazy Vite imports complete. Explicit save flushing settles debounces. Runtime clocks/RNG and production APIs are unchanged. The test-only observer consumes no RNG.

Observers pass through `sendMessage`, `llmCall`, endpoint queue acquisition/release, usage reporting, registered core tracks and background execution. Async-local context correlates provider attempts with logical purposes even across asynchronous work. The adapter records undeclared routes independently of swallowed production errors. Idle requires no active call, queue slot, track/job, fetch or pending save. Cleanup aborts the run, settles work within bounds, cancels saves, clears pending/cache/history state, restores the original store/registries/globals and removes observers in `finally`.

The synthetic API covers only declared archive/index/chapter/timeline reads, declared source scenes, state/divergence/NPC/location writes, and the fixture's search responses. It retains append/source/persistence images. It does not simulate SQLite, server NLP, vector retrieval, correction history, immutable revisions or real disk durability. Selected/fetched IDs and actual prompt inclusion remain separate observations.

## Pinning a baseline

The command emits source commit, a content hash identifying the uncommitted harness, schema/suite versions, scenario versions, fixture hash (including the reused base fixture), lockfile hash, named tool versions, seed and result hashes. There is no self-referential future commit hash or creation timestamp.

The reviewed baseline was pinned in `ed5c639` against the preceding tested implementation. The two legacy violations retain their explicit reviewed disposition. Live transport remediation does not edit the pinned results or manifest. Future baseline changes require human review and authorization; recording candidates never pins them automatically. Complete the actual seven-turn local smoke and final Phase 0 review before starting Phase 1.

## Live smoke

The command rejects absent endpoint/model/quantization/hardware identity before making a provider request. Controlled-provider tests exercise both supported transports and the seven-turn commit path; they are separate from actual inference evidence.

Create an ignored config using this shape, replacing every placeholder. OpenAI-compatible mode remains supported unchanged: the endpoint is a **base URL**, such as a local server's `/v1`, because the real provider helper appends `/chat/completions`. Credentials, if needed locally, stay only in this ignored file.

```json
{
  "provider": {
    "endpoint": "<local inference base URL>",
    "apiKey": "",
    "modelName": "<exact model identifier>",
    "apiFormat": "openai"
  },
  "environment": {
    "modelId": "<same exact model identifier>",
    "quantization": "<exact quantization>",
    "inferenceServer": "<server name>",
    "serverVersion": "<exact version>",
    "contextWindow": 8192,
    "outputLimit": 512,
    "sampling": { "temperature": 0.7, "max_tokens": 512 },
    "cpu": "<CPU model>",
    "ramGiB": 32,
    "gpu": null,
    "vramGiB": null,
    "offload": { "mode": "cpu-only", "layers": 0 },
    "threads": null,
    "batch": null,
    "modelStatus": "warm",
    "endpointRoles": { "story": "local-story", "auxiliary": null, "utility": null, "summariser": null }
  },
  "ceilings": { "perCallMs": 120000, "totalMs": 1200000 }
}
```

Numbers above illustrate the schema, not a recommended or observed environment. Record actual values. `null` is permitted only for explicitly unavailable hardware/thread/batch values; named offload modes require a layer count. Qualitative observations default individually to `not_reviewed`, per the implementation instructions' approved override of the plan. They do not block technical completion.

Native Ollama mode is available for local models whose thinking behavior cannot be controlled correctly through `/v1/chat/completions`. For the named rerun, replace only the provider block with:

```json
{
  "endpoint": "http://127.0.0.1:11434",
  "apiKey": "",
  "modelName": "hf.co/mradermacher/gemma-4-26B-A4B-it-heretic-GGUF:Q4_K_M",
  "apiFormat": "ollama",
  "think": false
}
```

The native endpoint must be the server root, without `/v1` or `/api/chat`; the provider helper appends `/api/chat`. The optional `think` field accepts only `false` and only in Ollama mode. It is sent as a top-level native request field alongside `model`, `messages`, `stream: true`, and `options`. Keep the same model, `outputLimit: 512`, and `sampling: { "temperature": 0.7, "max_tokens": 512 }`. For this machine record `offload: { "mode": "gpu", "layers": 31 }`: the supplied server log reported **31/31 layers offloaded**, so the first run's `partial-gpu` label was inaccurate.

The live-only adapter maps sampling into native `options`: `temperature`, `top_p`, `top_k`, and `min_p` retain their names; `repetition_penalty` becomes `repeat_penalty`; `max_tokens` becomes `num_predict`. Unsupported native sampling keys fail validation before dispatch. Temperature and output limits are never silently increased.

Native NDJSON is decoded incrementally across byte and record boundaries, then forwarded to the unchanged production native stream parser. `message.content` supplies visible Story prose. `message.thinking` is captured separately in live attempt diagnostics and never merged into visible content. A terminal `done: true` record is required; malformed, error, or incomplete streams fail. Available `prompt_eval_count` and `eval_count` map to provider prompt/completion usage; native timing metadata and `done_reason` remain diagnostic values. Missing provider counts remain `null`.

Each live turn requires exactly one successful logical Story call and one successful HTTP attempt, with no unexpected model traffic. A reasoning-only or whitespace-only reply fails **before commit**. Nonempty visible output must then pass the normal pending-draft/commit path with an accepted scene anchor and one archive append. HTTP 200 alone cannot pass the smoke.

`fixtures/liveSmoke.ts` pins the seven approved courtyard inputs and applies the north-bridge correction before turn five. Inputs never adapt to output. Every successful response commits. Real timers and monotonic callback observations measure each attempt's queue wait, dispatch-to-first parsed narrative/reasoning delta, generation completion, logical invocation duration, and each turn's draft/commit latency. Provider usage is distinct from tokenizer estimates. Per-call and total ceilings abort work; the script never extends beyond seven turns. Completed and partial/failure reports remain under `.eval-output/live/` with environment and coverage manifests. No buffering precedes the real stream consumer, no automatic latency thresholds or LLM judge are used.

Reasoning-first-token timing and visible Story TTFT are separate observations. Visible TTFT starts at the first nonempty parsed narrative callback; reasoning cannot substitute for it. When no visible callback is measurable it remains `null`. Native observation forwards records incrementally without buffering the complete response. Queue, generation, logical-call, draft and commit timings retain their existing definitions. All live configs, output, reasoning diagnostics and performance reports remain local, ignored and uncommitted.

The live coverage boundary is frontend orchestration plus actual local Story inference against the synthetic API. It excludes real backend disk commits, vector infrastructure and `server/services/nlpPipeline.js`, including utility-model calls outside this fixture.

## Repository compatibility

The frozen architecture documents, production runtime, existing base-app runner/fixture/baseline, prompt goldens and queue implementation are unchanged. All harness TypeScript stays under `src/eval/__tests__/`, already excluded by `tsconfig.app.json`.

`scripts/patch-graph-imports.mjs` is genuinely absent (and listed in `.gitignore`). It was not recreated. A standalone strict typecheck of the new test entry points traverses the reused base-app helpers and reports three existing helper errors: a stale type-only import in `recorder.ts`, an incomplete `GameContext` cast in `fixture.ts`, and an unused `@ts-expect-error` in `deterministicSeams.ts`. The new harness itself has no reported errors in that check. Those preserved helper files are not application-compiled.
