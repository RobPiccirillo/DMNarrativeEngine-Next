# Inference inventory — logical frontend families and server/provider sites

Generated from `inference-inventory.json`; edit that source and run `node scripts/architecture/check-inference.mjs --write-doc`.

Development-only descriptive family catalog. Canonical classifications describe the current orchestration path. Peripheral/boundary entries are inventory, not universal invocation defaults. Never routing/scheduling policy.

| Operation | Purpose | Trigger | Execution | Direct wait boundary | Role | Requirement | Coverage | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| story-generation | story | explicit-user-action | foreground | visible-story | story | required-story-completion | canonical | Canonical turn context; standalone/manual uses require caller context. |
| director-brief | planning | automatic-foreground | foreground | visible-story | auxiliary | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| archive-planner | planning | automatic-foreground | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| context-recommender | planning | automatic-foreground | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| query-expansion | extraction-analysis | automatic-foreground | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| semantic-rerank | extraction-analysis | automatic-foreground | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| npc-stance | relationship-knowledge | automatic-foreground | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| character-intro | npc | automatic-foreground | foreground | visible-story | auxiliary | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| deep-search-chapters | extraction-analysis | explicit-user-action | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| deep-search-scenes | extraction-analysis | explicit-user-action | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| deep-search-summarize | summarization | explicit-user-action | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| deep-search-merge | summarization | explicit-user-action | foreground | visible-story | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| scene-stakes-classify | extraction-analysis | automatic-post-turn | foreground | turn-commit | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| importance-rating | extraction-analysis | automatic-post-turn | foreground | turn-commit | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| npc-validate | extraction-analysis | automatic-post-turn | foreground | turn-commit | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| npc-update | npc | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| npc-drives-backfill | npc | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| profile-scan | extraction-analysis | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| trait-scan | extraction-analysis | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| inventory-scan | extraction-analysis | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| location-scan | extraction-analysis | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| scene-event-extract | extraction-analysis | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| pc-update | extraction-analysis | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| relationship-memory | relationship-knowledge | automatic-post-turn | background | nothing-user-visible | utility | optional | canonical | Canonical turn context; standalone/manual uses require caller context. |
| chapter-seal | summarization | automatic-post-turn | background | nothing-user-visible | story | optional | canonical | Canonical automatic chapter seal uses Story role in a background job; manual seal shares this label and needs caller context. |
| archive-funnel | extraction-analysis | automatic-foreground | foreground | visible-story | utility | optional | canonical | Archive chapter funnel in archiveRecall is awaited during foreground recall. |
| timeskip-narration | npc | automatic-post-turn | background | nothing-user-visible | caller-selected | optional | canonical | Canonical host selects utility when available, otherwise story; legacy direct fallback lacks a label. Observed label alone cannot identify selected role. |
| swipe-generation | story | explicit-user-action | foreground | visible-story | story | optional | peripheral | Canonical turn context; standalone/manual uses require caller context. |
| scene-continue | story | explicit-user-action | foreground | visible-story | story | optional | peripheral | Canonical turn context; standalone/manual uses require caller context. |
| ask-gm-handoff-summary | summarization | manual-utility | foreground | nothing-user-visible | caller-selected | optional | peripheral | Canonical turn context; standalone/manual uses require caller context. |
| fact-dedup | relationship-knowledge | manual-utility | foreground | nothing-user-visible | utility | optional | peripheral | Manual/rebuild helpers; catalog describes known entry context, not all caller contexts. |
| fact-clusterer | relationship-knowledge | manual-utility | foreground | nothing-user-visible | utility | optional | peripheral | Manual/rebuild helpers; catalog describes known entry context, not all caller contexts. |
| npc-review | relationship-knowledge | manual-utility | foreground | nothing-user-visible | utility | optional | peripheral | Manual/rebuild helpers; catalog describes known entry context, not all caller contexts. |
| synopsis-backfill | summarization | manual-utility | foreground | nothing-user-visible | caller-selected | optional | peripheral | Explicit user backfill loop awaits generation; no Story/commit dependency. Endpoint is caller supplied. |
| witness-capture | extraction-analysis | manual-utility | background | nothing-user-visible | caller-selected | optional | peripheral | Canonical turn context; standalone/manual uses require caller context. |
| location-enrich | extraction-analysis | manual-utility | background | nothing-user-visible | caller-selected | optional | peripheral | queueLocationEnrichment returns void and launches a fire-and-forget async IIFE; its caller does not await fetchEnrichment. Trigger is manual utility and nothing directly user-visible waits. Endpoint is caller supplied. |
| guided-creation | utility | manual-utility | foreground | nothing-user-visible | caller-selected | optional | inventory-only | Streaming wrapper uses dynamic Guided-Creation-* tracking labels; no invocation certification. |
| unlabelled-manual-utilities | utility | manual-utility | foreground | nothing-user-visible | caller-selected | optional | inventory-only | NPC profile/propose, arc spawn, troublemaker, lore check/enrichment/import/world builder, rules keywords, chapter summary/header index, divergence merge/review, engine tags and OOC. Unlabelled/dynamic wrappers require explicit caller context before runtime classification. |
| vision-describe | vision-media | manual-utility | foreground | nothing-user-visible | media | optional | boundary | Vision bypasses llmCall/sendMessage; image and speech requests delegate server inference. No canonical ledger integration or provider-attempt claim. |
| scene-images | vision-media | manual-utility | foreground | nothing-user-visible | media | optional | boundary | Media boundary includes direct portrait/landscape generation in npc-generation/portrait.ts through llmFetch, plus server-delegated scene image generation/composition. No canonical logical-ledger/attempt certification. |
| speech | vision-media | manual-utility | foreground | nothing-user-visible | media | optional | boundary | Vision bypasses llmCall/sendMessage; image and speech requests delegate server inference. No canonical ledger integration or provider-attempt claim. |
| semantic-embeddings | embedding | automatic-foreground | foreground | visible-story | embedding | optional | boundary | Frontend awaits semantic-search HTTP result (can report pending); embedding execution/cache/batch/warmup belongs to server and is not a frontend model invocation. Archive writes can also request server embeddings. |
| extension-model-access | extension | extension-action | background | post-turn-completion | caller-selected | optional | boundary | Dynamic compute/native modules can request host roles/labels or supply their own inference. Scheduling, purpose and nested provider traffic are opaque until observed; this descriptive boundary is not an inferred runtime classification. |
| server-witness-extract | extraction-analysis | automatic-post-turn | background | nothing-user-visible | caller-selected | optional | boundary | Deferred archive NLP; gated by utility config and NPC names; no frontend completion wait. |
| server-timeline-extract | extraction-analysis | automatic-post-turn | background | nothing-user-visible | caller-selected | optional | boundary | Deferred archive NLP, up to two raw HTTP attempts; regex fallback is not inference. |
| server-overworld-generate | utility | manual-utility | foreground | nothing-user-visible | caller-selected | optional | boundary | Legacy manual generation route; supplied endpoint/model; two raw HTTP attempts at most. |

The JSON also registers 102 recognizable source sites by file/callee/index. Known direct calls and bound canonical callbacks name their exact families; shared forwarding/provider transports list possible caller families and retain explicit dynamic-boundary notes. These lists do not prove every dynamic invocation or its caller context. The gate detects additions/removals of direct named frontend calls and host model calls; it does not detect arbitrary aliases, computed property access or external module code. Review those boundaries explicitly.

## Server/provider execution census

Execution sites are beneath logical calls, not additional logical operations. Scoped means observable when development tooling supplies the existing logical correlation/classification; it does not certify every production invocation. Artifact transfers, polling and model setup are distinguished from executions. No inventory is loaded at runtime.

| Site | Kind | Observation | Possible logical families | Notes |
| --- | --- | --- | --- | --- |
| server/lib/embedder.js#model:1 | execution | scoped | semantic-embeddings | In-process Transformers CPU execution; warmup or uncached batch; scoped hook only. |
| server/lib/embedder.js#model:2 | execution | scoped | semantic-embeddings | In-process Transformers CPU execution; warmup or uncached batch; scoped hook only. |
| server/lib/embedder.js#pipeline:1 | setup | scoped | semantic-embeddings | Model loading; not a generation attempt. |
| server/lib/tts.js#KokoroTTS.from_pretrained:1 | setup | scoped | speech | Kokoro in-process runtime; cache hits do not execute the model. |
| server/lib/tts.js#model.generate:1 | execution | scoped | speech | Kokoro in-process runtime; cache hits do not execute the model. |
| server/routes/assets.js#fetch:1 | artifact | not-inference | scene-images | Remote asset transfer, not a provider generation. |
| server/routes/llmProxy.js#fetchImpl:1 | relay | scoped | story-generation, director-brief, archive-planner, context-recommender, query-expansion, semantic-rerank, npc-stance, character-intro, deep-search-chapters, deep-search-scenes, deep-search-summarize, deep-search-merge, scene-stakes-classify, importance-rating, npc-validate, npc-update, npc-drives-backfill, profile-scan, trait-scan, inventory-scan, location-scan, scene-event-extract, pc-update, relationship-memory, chapter-seal, archive-funnel, timeskip-narration, swipe-generation, scene-continue, ask-gm-handoff-summary, fact-dedup, fact-clusterer, npc-review, synopsis-backfill, witness-capture, location-enrich, guided-creation, unlabelled-manual-utilities, vision-describe, scene-images, extension-model-access, server-witness-extract, server-timeline-extract, server-overworld-generate | Transparent upstream relay; supplied logical correlation; raw first byte only, no stream parsing. |
| server/services/comfyUiProvider.js#fetchImpl:1 | execution | scoped | scene-images | Workflow submission, history polling and download form one observed workflow execution. |
| server/services/comfyUiProvider.js#fetchImpl:2 | artifact | not-inference | scene-images | History polling or image download; no additional inference attempt. |
| server/services/comfyUiProvider.js#fetchImpl:3 | artifact | not-inference | scene-images | History polling or image download; no additional inference attempt. |
| server/services/imageProvider.js#fetch:1 | execution | scoped | scene-images | OpenAI/OpenRouter image generation; payload/result parsing unchanged. |
| server/services/imageProvider.js#fetch:2 | artifact | not-inference | scene-images | Generated-image download, not another model call. |
| server/services/llmProxy.js#fetch:1 | execution | scoped | server-witness-extract, server-timeline-extract, server-overworld-generate | Raw OpenAI-compatible helper; caller-supplied logical resolver; retry children, no frontend queue. |
| server/services/sceneImageComposerService.js#fetch:1 | execution | scoped | scene-images | Scene image prompt composer using configured Story endpoint; fallback is a deterministic template. |

- dynamic extension/provider leases: UNVERIFIED: arbitrary native/worker modules, aliases/computed fetch and external provider implementations are not fully observable or statically certified.
- frontend vision and raw role helpers: Vision uses its existing per-endpoint queue and llmFetch relay; auxiliary/summariser resolution remains the host broker policy. Supplied caller context is required outside canonical eval.
- server logical context: Callbacks are opt-in and carry the existing logical classification. Deferred NLP, media and cached native operations without supplied logical context remain unverified; the inventory is never runtime authorization.
