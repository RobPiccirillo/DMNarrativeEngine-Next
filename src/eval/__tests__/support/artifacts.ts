import { createHash } from 'node:crypto';
import { categories, scenarioIds } from './types';
import type { Category, Difference, EvalResult, Json } from './types';

export function canonical(value: unknown): string {
    const seen = new Set<object>();
    const visit = (v: unknown, depth = 0, path = '$'): string => {
        if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
        if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
        if (typeof v !== 'object' || !v || seen.has(v)) throw new Error(`Unsupported artifact value at ${path}`);
        if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) throw new Error('Non-plain artifact value');
        seen.add(v);
        const array = Array.isArray(v);
        const rows = array ? v.map((x, i) => visit(x, depth + 1, `${path}.${i}`)) : Object.keys(v).sort().map(k => `${JSON.stringify(k)}: ${visit((v as Record<string, unknown>)[k], depth + 1, `${path}.${k}`)}`);
        seen.delete(v);
        const [open, close] = array ? ['[', ']'] : ['{', '}'];
        return rows.length ? `${open}\n${rows.map(row => '  '.repeat(depth + 1) + row).join(',\n')}\n${'  '.repeat(depth)}${close}` : open + close;
    };
    return visit(value) + '\n';
}

export function hash(value: string | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex');
}

export function pick(value: unknown, keys: readonly string[]): Json {
    const obj = value as Record<string, unknown> | null | undefined;
    return Object.fromEntries(keys.filter(k => obj?.[k] !== undefined).map(k => [k, obj![k]])) as Json;
}

export function entries(value: unknown): Json {
    return (value as unknown[]).map(e => pick(e, ['id', 'text', 'chapterId', 'category', 'sceneRef', 'npcIds', 'pinned', 'enabled', 'source', 'status', 'supersededBy', 'stateKey', 'knownBy', 'sourceMessageId']));
}

export function messages(value: unknown): Json {
    return (value as Record<string, unknown>[]).map(m => ({
        ...pick(m, ['id', 'role', 'content', 'displayContent', 'name', 'tool_calls', 'tool_call_id', 'reasoning_content', 'sceneId', 'pendingCommit', 'commitFailed', 'retryable', 'swipeActiveIndex']) as object,
        ...(m.swipeSet ? { swipeSet: (m.swipeSet as unknown[]).map(s => pick(s, ['id', 'text', 'reasoningContent', 'sceneStakes', 'tagPresent', 'streaming'])) } : {}),
    }));
}

export function engine(value: unknown): Json {
    return pick(value, ['surpriseDC', 'encounterDC', 'worldEventDC']);
}

export function request(value: Record<string, unknown>): Json {
    return { ...pick(value, ['stream', 'messages', 'temperature', 'top_p', 'top_k', 'min_p', 'max_tokens', 'max_completion_tokens', 'tools', 'tool_choice', 'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'reasoning_effort']) as object, model: 'story-model' } as Json;
}

export function aliasGeneratedIds(value: Json): Json {
    const aliases = new Map<string, string>();
    const inspect = (v: Json): void => {
        if (Array.isArray(v)) v.forEach(inspect);
        else if (v && typeof v === 'object') {
            if (typeof v.id === 'string' && /^(?:loyw3[0-9a-z]+|loc_\d{13}_[0-9a-f]+)$/.test(v.id) && !aliases.has(v.id)) aliases.set(v.id, `generated-${aliases.size + 1}`);
            Object.values(v).forEach(inspect);
        }
    };
    inspect(value);
    const replace = (v: Json): Json => {
        if (typeof v === 'string') return aliases.get(v) ?? v;
        if (Array.isArray(v)) return v.map(replace);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
        return v;
    };
    return replace(value);
}

export function validateArtifact(value: unknown): asserts value is EvalResult {
    canonical(value);
    const root = value as EvalResult;
    if (root.schemaVersion !== 0 || root.kind !== 'behavioral' || root.scenarioVersion !== 1 || !scenarioIds.includes(root.scenario) || !Array.isArray(root.turns) || !root.turns.length) throw new Error('Invalid result schema');
    const rootKeys = new Set(['schemaVersion', 'kind', 'scenario', 'scenarioVersion', 'turns']);
    if (Object.keys(root).some(k => !rootKeys.has(k))) throw new Error('Unexpected result field');
    const allow: Record<Category, readonly string[]> = {
        prompt: ['messages', 'trace'], retrieval: ['semanticArchiveIds', 'semanticLoreIds', 'recalled', 'loreIds', 'ruleIds', 'elevatedIds', 'slotted'],
        'effects-and-writes': ['callbacks', 'writes', 'jobs', 'tracks', 'storeChanges', 'apiTraffic'],
        'calls-and-tokens': ['calls', 'tokenizer', 'requestTextEstimate'], messages: ['pending', 'committed'],
        state: ['engine', 'inventory', 'location', 'registerBefore', 'entries', 'castAtDraft', 'castAfterCommit', 'archiveBefore', 'archiveAtDraft', 'archiveAfterCommit', 'appendSceneId'],
        diagnostics: ['violations', 'warnings', 'idle', 'pendingSaves'],
    };
    for (const [i, turn] of root.turns.entries()) {
        if (Object.keys(turn).some(k => k !== 'ordinal' && !categories.includes(k as Category)) || categories.some(k => !(k in turn))) throw new Error('Invalid turn categories');
        if (turn.ordinal !== i + 1) throw new Error('Invalid turn ordinal');
        for (const category of categories) {
            const data = turn[category];
            if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).some(k => !allow[category].includes(k))) throw new Error(`Unexpected ${category} field`);
        }
    }
    const walk = (v: unknown): void => {
        if (typeof v === 'string') {
            if (/(?:https?:\/\/|[A-Za-z]:[\\/]|\\\\|(?:^|\s)\/(?:home|Users|tmp|var)\/|\bat .+\(.+:\d+:\d+\)|\d{4}-\d\d-\d\dT\d\d:|Bearer\s|sk-[A-Za-z0-9]{8})/i.test(v)) throw new Error('Unsafe artifact text');
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
            if (/api.?key|authorization|headers?|password|credential|timestamp|startedAt|lastUpdatedAt|durationMs|stack|endpointUrl/i.test(k)) throw new Error(`Unsafe artifact field: ${k}`);
            walk(x);
        }
    };
    walk(value);
}

export function compare(old: EvalResult, next: EvalResult): { status: 'MATCH' | 'REVIEW_REQUIRED'; differences: Difference[] } {
    validateArtifact(old); validateArtifact(next);
    if (old.scenario !== next.scenario) throw new Error('Cannot compare different scenarios');
    const differences: Difference[] = [];
    const visit = (a: Json | undefined, b: Json | undefined, path: string, category: Category) => {
        if (a === undefined || b === undefined) {
            if (a !== b) differences.push({ category, path, old: a === undefined ? { missing: true } : a, new: b === undefined ? { missing: true } : b });
            return;
        }
        if (canonical(a) === canonical(b)) return;
        if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
            for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) visit((a as Record<string, Json>)[k], (b as Record<string, Json>)[k], `${path}.${k}`, category);
        } else differences.push({ category, path, old: a ?? null, new: b ?? null });
    };
    for (let i = 0; i < Math.max(old.turns.length, next.turns.length); i++) for (const category of categories) visit(old.turns[i]?.[category], next.turns[i]?.[category], `turns.${i}.${category}`, category);
    return { status: differences.length ? 'REVIEW_REQUIRED' : 'MATCH', differences };
}
