# Phase 1L quality and local smoke review

Status: **live collection blocked; human quality review not completed**.

The implementation keeps `current` as the default and adds the opt-in `constrained-local-v1` profile. Deterministic replay establishes request counts, prompt contents and acceptance behavior. It does not establish narrative quality or a latency improvement.

## Observed local prerequisite

On November 9, 2026, the local Ollama service answered `/api/version` with **0.40.15**, and `/api/ps` reported no loaded models. `/api/tags` timed out at 5 seconds and again at 20 seconds. A direct `/api/show` lookup of the required `hf.co/mradermacher/gemma-4-26B-A4B-it-heretic-GGUF:Q4_K_M` model also timed out at 20 seconds. These observations establish unavailable model discovery/access, not proof that the model is absent.

Read-only hardware inspection identified a Ryzen 7 9800X3D and Radeon RX 9070 XT, plus integrated Radeon graphics. Windows reported 33,439,997,952 bytes of physical memory. Current model quantization, effective context, GPU layer offload, usable VRAM and warm state could not be reconfirmed. The WMI AdapterRAM field is not used to certify VRAM capacity or offload.

**Plan Section K5 applies.** The exact prerequisite is a responsive lookup and usable installation of the named reference model, with its actual context/output/offload settings verified. No model was substituted, downloaded or benchmarked. No new live inference was dispatched. Hardware inspection required sandbox escalation after Windows denied the initial read.

The seven-turn primary run and the paired six-turn populated current/constrained run remain outstanding. Their latency, usage, occupancy, finish reasons, failures and truncation are **not measured**. No speedup or quality acceptance is claimed. The Phase 0 approximate figures remain historical context only; no recovered or newly observed values are inferred from them.

## Prepared collection paths

Use the existing runner, `npm run eval:live -- --config <ignored-config>`.

- Primary: `inferenceProfileId: "constrained-local-v1"`, `runKind: "primary"`; retain the seven original inputs, context 8192, output 512, temperature 0.7, native Ollama and `think: false`. Output goes to `.eval-output/phase-1l-live/`.
- Focused comparison: `runKind: "populated"`, once with `inferenceProfileId: "current"` and once with `"constrained-local-v1"`. Explicitly declare utility and auxiliary roles as `"local-story"` on the same provider. Output goes to `.eval-output/phase-1l-quality-current/` and `.eval-output/phase-1l-quality-constrained-local-v1/`. The current run permits classified auxiliary execution; constrained retains its one-call contract.
- Private configuration must contain actual reconfirmed environment values and bounded per-call/total ceilings. Do not copy old offload/warm-state observations as present facts. Do not overwrite the Phase 0 private live artifacts.

Collection retains invocation/attempt correlation, actual request bodies, usage when returned, native stream metadata and timing windows. Added turn timestamps distinguish gather, completed draft, commit start/end and quiescence. `commitOnlyMs` is independent of the old cumulative `commitMs`; the latter retains its previous meaning. Missing measurements remain unknown. Provider stream completion does not certify GPU idle time.

The primary and focused paths use the synthetic campaign API. The separate disposable backend integration test proves append durability and constrained NLP suppression with provider functions stubbed. Neither substitutes for full-stack live quality evidence.

## Review rubric

| Focus | Deterministic evidence | Human live judgment |
| --- | --- | --- |
| NPC identity and boundaries | Two established NPCs, later reappearance, hard boundary on actual Story wire | not_reviewed |
| Existing carried memory | Carried anchor retained without forced-deep inference or cache reuse from the model-enabled profile | not_reviewed |
| Character and inventory | Existing Echo Sight ability and Moon Key retained under smart bookkeeping | not_reviewed |
| Lore | Lexical selection retained; no semantic HTTP prerequisite | not_reviewed |
| Manual correction | Closed north bridge survives the correction/reload path and subsequent prompt | not_reviewed |
| Relationships | Existing memory retained; automatic new extraction suppressed | not_reviewed |
| Scene transitions and travel | Existing deterministic transitions remain; timeskip uses the existing deterministic narration seam | not_reviewed |
| Chapter boundary | Scene-25 structural seal retained; empty new summaries remain visibly absent/title fallback | not_reviewed |
| History authority | Escaped evidence envelopes survive OpenAI/Ollama/Claude/Gemini wire transforms; current direction stays active | not_reviewed |
| Fairness, playable openings, voice, repetition and coherence | Canned replay cannot assess these | not_reviewed |

For live critical facts record supported/contradicted/not evidenced. For voice, agency, relationship response and coherence record preserved/regressed/not reviewed. No LLM judge is used. New relational events depend on accepted prose/history and existing deterministic recall; structured relationship memory is intentionally not refreshed. Missing derived records are not recreated on opt-out.

The known Phase 0 context-boundary truncation remains deferred to Phase 9A. Keep the primary context unchanged; label any larger-context diagnostic separately. Severe attributable continuity or authority failures require focused remediation or the applicable Section K stop, regardless of latency.

Independent human review and constrained baseline pinning remain pending under Section K6 after the K5 prerequisite is resolved. Candidate hashes are review material, never an authorization to pin them.
