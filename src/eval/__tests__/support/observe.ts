import { AsyncLocalStorage } from 'node:async_hooks';
import { vi } from 'vitest';
import * as story from '../../../services/llm/llmService';
import * as utility from '../../../utils/llmCall';
import * as cacheTelemetry from '../../../services/llm/cacheTelemetry';
import { pick } from './artifacts';
import { LLMRequestQueue } from '../../../services/llm/llmRequestQueue';
import { backgroundQueue } from '../../../services/infrastructure/backgroundQueue';
import { postTurnTracks } from '../../../services/turn/tracks';
import { postCommitTracks } from '../../../services/turn/tracks/postCommit';
import { prologueTracks } from '../../../services/turn/tracks/prologue';
import { sequentialTracks } from '../../../services/turn/tracks/sequential';
import type { PostTurnTrack } from '../../../services/turn/tracks/types';
import type { ModelCall } from './types';

export type CallTiming = { invocation: number; queueRequested: number | null; granted: number | null; dispatch: number | null; firstNarrative: number | null; firstReasoning: number | null; completed: number | null; terminal: number | null };

export function measurements(t: CallTiming) {
    const delta = (end: number | null, start: number | null) => end === null || start === null ? null : Math.max(0, end - start);
    return { queueWaitMs: delta(t.granted, t.queueRequested), ttftMs: delta(t.firstNarrative, t.dispatch), reasoningFirstTokenMs: delta(t.firstReasoning, t.dispatch), generationMs: delta(t.completed, t.dispatch), logicalCallMs: delta(t.terminal, t.invocation) };
}

export function observe(now: () => number = () => performance.now()) {
    const context = new AsyncLocalStorage<ModelCall>();
    const calls: ModelCall[] = [];
    const timings = new Map<ModelCall, CallTiming[]>();
    const jobs: { label: string; status: string }[] = [];
    const tasks = new Set<Promise<unknown>>();
    const violations: string[] = [];
    const tracks: { id: string; status: string }[] = [];
    const trackSpies: { mockRestore: () => void }[] = [];
    const watchTrack = <Ctx>(track: PostTurnTrack<Ctx>) => {
        const run = track.run;
        trackSpies.push(vi.spyOn(track, 'run').mockImplementation(ctx => {
            const entry = { id: track.id, status: 'running' }; tracks.push(entry);
            try {
                const promise = run.call(track, ctx);
                tasks.add(promise);
                void promise.then(() => { entry.status = 'success'; tasks.delete(promise); }, () => { entry.status = 'error'; tasks.delete(promise); });
                return promise;
            } catch (e) { entry.status = 'error'; throw e; }
        }));
    };
    postTurnTracks.list().forEach(watchTrack); postCommitTracks.list().forEach(watchTrack);
    prologueTracks.list().forEach(watchTrack); sequentialTracks.list().forEach(watchTrack);
    const warnings: string[] = [];
    const warn = console.warn, error = console.error;
    const recordDiagnostic = (args: unknown[]) => { warnings.push(typeof args[0] === 'string' ? (args[0].match(/^\[([A-Za-z-]+)\]/)?.[1] ?? 'runtime-warning') : 'runtime-warning'); };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => { recordDiagnostic(args); warn(...args); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => { recordDiagnostic(args); error(...args); });
    let turn = 0, phase = 'setup', slots = 0;
    const timing = (c: ModelCall) => timings.get(c)!.at(-1)!;
    const recordUsage = cacheTelemetry.recordCacheUsage;
    const usageSpy = vi.spyOn(cacheTelemetry, 'recordCacheUsage').mockImplementation((...args) => {
        const c = context.getStore();
        if (c?.attempts.length && args[1]) c.attempts.at(-1)!.usage = pick(args[1], ['prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens', 'total_tokens']);
        return recordUsage(...args);
    });
    const newCall = (purpose: string) => {
        const c: ModelCall = { ordinal: calls.length + 1, purpose, endpoint: 'story-local', turn, phase, status: 'running', attempts: [] };
        calls.push(c);
        timings.set(c, [{ invocation: now(), queueRequested: null, granted: null, dispatch: null, firstNarrative: null, firstReasoning: null, completed: null, terminal: null }]);
        return c;
    };
    const send = story.sendMessage;
    const sendSpy = vi.spyOn(story, 'sendMessage').mockImplementation(async (...args) => {
        const c = newCall(args[9] ?? 'story-generation');
        const chunk = args[2], done = args[3], error = args[4], reasoning = args[10];
        args[2] = text => { if (text.trim() && timing(c).firstNarrative === null) timing(c).firstNarrative = now(); chunk(text); };
        args[3] = (...a) => { c.status = 'success'; timing(c).completed = now(); done(...a); };
        args[4] = text => { c.status = 'error'; error(text); };
        args[10] = text => { if (text.trim() && timing(c).firstReasoning === null) timing(c).firstReasoning = now(); reasoning?.(text); };
        try { await context.run(c, () => send(...args)); }
        catch (e) { c.status = 'error'; throw e; }
        finally { if (c.status === 'running') c.status = 'incomplete'; timing(c).terminal = now(); }
    });
    const call = utility.llmCall;
    const callSpy = vi.spyOn(utility, 'llmCall').mockImplementation(async (...args) => {
        const c = newCall(args[2]?.trackingLabel ?? 'unclassified');
        try { const text = await context.run(c, () => call(...args)); c.status = 'success'; timing(c).completed = now(); return text; }
        catch (e) { c.status = 'error'; throw e; }
        finally { timing(c).terminal = now(); }
    });
    const acquire = LLMRequestQueue.prototype.acquireSlot, release = LLMRequestQueue.prototype.releaseSlot;
    const acquireSpy = vi.spyOn(LLMRequestQueue.prototype, 'acquireSlot').mockImplementation(async function (this: LLMRequestQueue, ...args) {
        const c = context.getStore();
        if (c) {
            if (timing(c).queueRequested !== null) timings.get(c)!.push({ ...timing(c), queueRequested: null, granted: null, dispatch: null, firstNarrative: null, firstReasoning: null, completed: null, terminal: null });
            timing(c).queueRequested = now();
        }
        await acquire.apply(this, args); slots++;
        if (c) timing(c).granted = now();
    });
    const releaseSpy = vi.spyOn(LLMRequestQueue.prototype, 'releaseSlot').mockImplementation(function (this: LLMRequestQueue) { slots--; release.call(this); });
    const push = backgroundQueue.push.bind(backgroundQueue);
    const pushSpy = vi.spyOn(backgroundQueue, 'push').mockImplementation((label, execute) => {
        const job = { label, status: 'pending' }; jobs.push(job);
        const promise = push(label, async () => { job.status = 'running'; try { const r = await execute(); job.status = 'success'; return r; } catch (e) { job.status = 'error'; throw e; } });
        tasks.add(promise); void promise.then(() => tasks.delete(promise), () => tasks.delete(promise));
        return promise;
    });
    return {
        calls, timings, jobs, tracks, warnings, violations, current: () => context.getStore(),
        dispatch() { const c = context.getStore(); if (!c) { violations.push('unobserved-provider-attempt'); return; } timing(c).dispatch = now(); },
        completeAttempt() { const c = context.getStore(); if (c) timing(c).completed = now(); },
        setTurn(n: number) { turn = n; }, setPhase(p: string) { phase = p; },
        idle: () => tasks.size === 0 && slots === 0 && !backgroundQueue.active && !backgroundQueue.pending && !calls.some(c => c.status === 'running'),
        restore() { warnSpy.mockRestore(); errorSpy.mockRestore(); trackSpies.forEach(s => s.mockRestore()); usageSpy.mockRestore(); pushSpy.mockRestore(); releaseSpy.mockRestore(); acquireSpy.mockRestore(); callSpy.mockRestore(); sendSpy.mockRestore(); context.disable(); },
    };
}
export type Observation = ReturnType<typeof observe>;
