import { fixtureArchiveIndex, fixtureChapters, fixtureTimeline, FIXTURE_CAMPAIGN_ID } from '../../../services/turn/__tests__/baseAppGate/fixture';
import { entries, engine, messages, pick, request } from './artifacts';
import type { Json, RecordedStoryResponse } from './types';
import type { Observation } from './observe';
import { observeOllamaStream, ollamaLiveBody } from './ollamaLive';
import type { SmokeProvider } from './ollamaLive';
import type { SamplingConfig } from '../../../types';

export function streamResponse(record: RecordedStoryResponse, splitBytes = true): Response {
    const text = [
        ...(record.reasoning ?? []).map(content => ({ choices: [{ delta: { reasoning_content: content } }] })),
        ...record.deltas.map(content => ({ choices: [{ delta: { content } }] })),
        ...(record.usage ? [{ choices: [], usage: record.usage }] : []),
    ].map(v => `data: ${JSON.stringify(v)}\n\n`).join('') + 'data: [DONE]\n\n';
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
            await Promise.resolve();
            if (offset === bytes.length) { controller.close(); return; }
            const end = Math.min(bytes.length, offset + (splitBytes ? 17 : bytes.length));
            controller.enqueue(bytes.slice(offset, end)); offset = end;
        },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
}

export function syntheticIO(observer: Observation, live?: { fetch: typeof fetch; endpoint: string; perCallMs: number; provider: SmokeProvider; sampling: SamplingConfig; now: () => number }) {
    const originalFetch = globalThis.fetch;
    const violations: string[] = [];
    const traffic: { method: string; route: string }[] = [];
    const writes: { method: string; route: string; value: Json }[] = [];
    const index = fixtureArchiveIndex();
    const chapters = fixtureChapters();
    const sources = new Map<string, string>([['000', 'I enter the tavern.\nThe tavern keeper eyes you warily.']]);
    const persisted = new Map<string, unknown>();
    let active = 0, response: RecordedStoryResponse | undefined, expected: string[] = [];
    const seenCalls = new Set<number>();
    const root = `/api/campaigns/${FIXTURE_CAMPAIGN_ID}/`;
    const invalid = (code: string) => { violations.push(code); return Response.json({ error: code }, { status: 500 }); };
    const focusedWrite = (route: string, body: Record<string, unknown>): Json => {
        switch (route) {
            case 'state': return { engine: engine(body.context), messages: messages(body.messages ?? []), inventory: (body.context as Record<string, Json>)?.inventory ?? null };
            case 'divergence': return { entries: entries(body.entries ?? []) };
            case 'archive': return pick(body, ['userContent', 'assistantContent', 'sceneId', 'importance', 'events', 'witnesses', 'keywords', 'npcsMentioned']);
            case 'npcs': case 'locations': return (body as unknown as unknown[]).map(x => pick(x, ['id', 'name', 'archived', 'tier', 'pressure', 'lastSeenSceneId']));
            case 'archive/events': case 'archive/witnesses': return {
                patches: (body.patches as unknown[] ?? []).map(p => pick(p, ['sceneId', 'events', 'witnesses', 'witnessSource'])),
            };
            default: throw new Error('Undeclared write projection');
        }
    };
    globalThis.fetch = async (input, init) => {
        active++;
        try {
            const raw = String(input), url = new URL(raw, 'http://eval.invalid');
            const method = (init?.method ?? 'GET').toUpperCase();
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            if (url.origin !== 'http://eval.invalid' || (url.search && !url.pathname.endsWith('/archive/scenes'))) return invalid('undeclared-request-origin-or-query');
            if (url.pathname === '/api/llm/proxy' && method === 'POST') {
                const call = observer.current();
                const payload = JSON.parse(body.body);
                observer.dispatch();
                if (!call) return invalid('unclassified-provider-request');
                const attempt = { ordinal: call.attempts.length + 1, stream: Boolean(payload.stream), status: null as number | null, error: null as string | null, request: request(payload), usage: null as Json };
                call.attempts.push(attempt);
                const purpose = seenCalls.has(call.ordinal) ? call.purpose : expected.shift();
                seenCalls.add(call.ordinal);
                if (purpose !== call.purpose || Boolean(payload.stream) !== (purpose === 'story-generation')) { attempt.status = 500; attempt.error = 'unexpected-provider-request'; return invalid('unexpected-provider-request'); }
                if (live) {
                    if (call.purpose !== 'story-generation' || body.target !== live.endpoint) return invalid('undeclared-live-provider');
                    const signal = AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(live.perCallMs)]);
                    try {
                        const native = live.provider.apiFormat === 'ollama';
                        const nativeBody = native ? ollamaLiveBody(payload, live.provider, live.sampling) : null;
                        if (nativeBody) attempt.request = { ...request(nativeBody) as object, options: nativeBody.options, ...(nativeBody.think === false ? { think: false } : {}) };
                        const res = await live.fetch(body.target, { method: body.method, headers: body.headers, body: nativeBody ? JSON.stringify(nativeBody) : body.body, signal });
                        attempt.status = res.status;
                        if (!res.ok) observer.completeAttempt();
                        if (native && res.ok) {
                            const diagnostics: { thinking: string; metadata: Json; error: string | null } = { thinking: '', metadata: null, error: null };
                            Object.assign(attempt, { ollama: diagnostics });
                            return observeOllamaStream(res, record => {
                                const message = record.message as { thinking?: string } | undefined;
                                if (message?.thinking) {
                                    diagnostics.thinking += message.thinking;
                                    const timing = observer.timings.get(call)!.at(-1)!;
                                    if (message.thinking.trim() && timing.firstReasoning === null) timing.firstReasoning = live.now();
                                }
                                if (record.done === true) {
                                    diagnostics.metadata = pick(record, ['done_reason', 'prompt_eval_count', 'eval_count', 'total_duration', 'load_duration', 'prompt_eval_duration', 'eval_duration']);
                                    if (typeof record.prompt_eval_count === 'number' || typeof record.eval_count === 'number') attempt.usage = {
                                        prompt_tokens: typeof record.prompt_eval_count === 'number' ? record.prompt_eval_count : null,
                                        completion_tokens: typeof record.eval_count === 'number' ? record.eval_count : null,
                                    };
                                }
                            }, e => { attempt.error = 'native-stream-error'; diagnostics.error = e instanceof Error ? e.message : 'Invalid native stream'; });
                        }
                        return res;
                    } catch (e) { attempt.error = 'fetch-failed-or-aborted'; observer.completeAttempt(); throw e; }
                }
                attempt.status = 200;
                const replayStatus = response?.attemptStatuses?.[attempt.ordinal - 1] ?? 200;
                if (replayStatus !== 200) { attempt.status = replayStatus; attempt.error = 'recorded-provider-error'; observer.completeAttempt(); return new Response('Recorded provider error', { status: replayStatus, headers: { 'Retry-After': '0' } }); }
                if (call.purpose === 'director-brief') return Response.json({ choices: [{ message: { content: 'WRITER BRIEF\nRender the stated action and preserve the established location.' } }] });
                if (!response) return invalid('missing-story-response');
                attempt.usage = response.usage ?? null;
                return streamResponse(response);
            }
            if (!url.pathname.startsWith(root)) return invalid('undeclared-route');
            const route = url.pathname.slice(root.length);
            traffic.push({ method, route });
            if (method === 'POST' && route === 'archive') {
                const sceneId = String(index.length).padStart(3, '0');
                sources.set(sceneId, `${body.userContent}\n${body.assistantContent}`);
                index.push({ sceneId, timestamp: 0, keywords: [], npcsMentioned: [], witnesses: [], userSnippet: body.userContent });
                writes.push({ method, route, value: focusedWrite(route, body) });
                return Response.json({ sceneNumber: index.length - 1, sceneId });
            }
            if (method === 'GET') {
                if (route === 'archive/index') return Response.json(index);
                if (route === 'archive/chapters') return Response.json(chapters);
                if (route === 'timeline') return Response.json(fixtureTimeline());
                if (route === 'npcs' || route === 'locations') return Response.json(persisted.get(route) ?? []);
                if (route === 'divergence' || route === 'state') return persisted.has(route) ? Response.json(persisted.get(route)) : invalid('uninitialized-source');
                if (route === 'archive/scenes' && [...url.searchParams.keys()].every(k => k === 'ids')) {
                    const ids = (url.searchParams.get('ids') ?? '').split(',');
                    if (ids.some(id => !sources.has(id))) return invalid('undeclared-scene');
                    return Response.json(ids.map(sceneId => ({ sceneId, content: sources.get(sceneId) })));
                }
            }
            if (method === 'PUT' && ['state', 'divergence', 'npcs', 'locations'].includes(route)) {
                persisted.set(route, structuredClone(body)); writes.push({ method, route, value: focusedWrite(route, body) });
                return Response.json({ ok: true });
            }
            if (method === 'PATCH' && ['archive/events', 'archive/witnesses'].includes(route)) {
                writes.push({ method, route, value: focusedWrite(route, body) }); return Response.json({ ok: true });
            }
            if (method === 'POST' && ['archive/semantic-candidates', 'lore/semantic-candidates'].includes(route)) return Response.json({ pending: true });
            if (method === 'POST' && route === 'rules/search') return Response.json({ ruleIds: [] });
            return invalid('undeclared-route');
        } finally { active--; }
    };
    return {
        violations, traffic, writes, index, chapters, sources, persisted,
        begin(record: RecordedStoryResponse, pro: boolean) { response = record; expected = pro ? ['director-brief', 'story-generation'] : ['story-generation']; seenCalls.clear(); },
        assertComplete() { if (expected.length) violations.push('missing-provider-request'); if (violations.length) throw new Error(`Replay I/O violations: ${violations.join(', ')}`); },
        idle: () => active === 0,
        restore() { globalThis.fetch = originalFetch; },
    };
}
