import { API_BASE } from '../lib/apiBase';

export interface StateSaveToken {
    format: 'legacy-state-save-token-v1'; campaignInstance: string; head: string; draftVersion: string; stateVersion: string; storageToken: string;
}
const tokens = new Map<string, StateSaveToken>();
const pending = new Map<string, Promise<unknown>>();
const failures = new Map<string, unknown>();
const header = 'X-Phase3-State-Token';
const resourceWrites = new Map<string, Set<Promise<unknown>>>();
const resourceFailures = new Map<string, Map<string, unknown>>();
export function hasInFlightCampaignSaves(): boolean {
    return pending.size > 0 || resourceWrites.size > 0 || failures.size > 0 || [...resourceFailures.values()].some(errors => errors.size > 0);
}

export async function campaignResourceRequest(id: string, url: string, init?: RequestInit, captured = captureStateSaveToken(id)): Promise<Response> {
    if (!init?.method || ['GET', 'HEAD'].includes(init.method.toUpperCase())) return init === undefined ? fetch(url) : fetch(url, init);
    const tracked = !/\/backups?(?:\/|$)|semantic-candidates|\/search(?:\?|$)|reindex|\/embeddings/.test(url);
    const key = `${init.method}:${url}`;
    const work = (async () => {
        const headers = captured ? new Headers(init.headers) : init.headers;
        if (captured) (headers as Headers).set(header, encodeURIComponent(JSON.stringify(captured)));
        const response = await fetch(url, { ...init, headers });
        if (!response.ok) {
            const value = await (response.clone?.() ?? response).json?.().catch(() => ({})) ?? {};
            throw new Error(value.code ?? value.error ?? `Campaign write failed: HTTP ${response.status}`);
        }
        readStateSaveToken(id, response);
        if (tracked) resourceFailures.get(id)?.delete(key);
        return response;
    })();
    const writes = resourceWrites.get(id) ?? new Set();
    if (tracked) { resourceWrites.set(id, writes); writes.add(work); }
    try { return await work; }
    catch (error) {
        if (tracked) { const errors = resourceFailures.get(id) ?? new Map(); resourceFailures.set(id, errors); errors.set(key, error); }
        throw error;
    } finally {
        if (tracked) { writes.delete(work); if (!writes.size && resourceWrites.get(id) === writes) resourceWrites.delete(id); }
    }
}

export function rememberStateSaveToken(id: string, token?: StateSaveToken | null): void {
    if (token) tokens.set(id, structuredClone(token)); else tokens.delete(id);
}
export function captureStateSaveToken(id: string): StateSaveToken | undefined {
    const token = tokens.get(id); return token ? structuredClone(token) : undefined;
}
export function readStateSaveToken(id: string, response: Response): void {
    const value = response.headers?.get?.(header);
    if (value) rememberStateSaveToken(id, JSON.parse(decodeURIComponent(value)));
}
export async function drainStateSaves(id: string): Promise<void> {
    await Promise.all([...(resourceWrites.get(id) ?? []), ...(pending.has(id) ? [pending.get(id)!] : [])]);
    if (failures.has(id)) throw failures.get(id);
    const failure = resourceFailures.get(id)?.values().next().value;
    if (failure) throw failure;
}

export function putCampaignState(id: string, state: unknown, captured = captureStateSaveToken(id)): Promise<void> {
    const input = state as { messages?: Record<string, unknown>[] };
    const body = JSON.stringify({ ...input, ...(Array.isArray(input.messages) ? { messages: input.messages.map(message => {
        const next = { ...message }; delete next.debugPayload; delete next.precontext; delete next.retryable; return next;
    }) } : {}) });
    const write = async () => {
        const current = tokens.get(id);
        if (captured && (!current || captured.campaignInstance !== current.campaignInstance || captured.storageToken !== current.storageToken || captured.head !== current.head
            || captured.draftVersion !== current.draftVersion)) throw new Error('managed-state-version-conflict');
        const token = captured ? { ...captured, stateVersion: current!.stateVersion } : undefined;
        const response = await fetch(`${API_BASE}/campaigns/${id}/state`, { method: 'PUT', headers: {
            'Content-Type': 'application/json', ...(token ? { [header]: encodeURIComponent(JSON.stringify(token)) } : {}),
        }, body });
        if (!response.ok) {
            const value = await response.json().catch(() => ({}));
            throw new Error(`Campaign save failed: HTTP ${response.status}${value.code ? ` (${value.code})` : ''}`);
        }
        readStateSaveToken(id, response);
        failures.delete(id);
    };
    const previous = pending.get(id);
    const next = previous ? previous.catch(() => {}).then(write) : write();
    pending.set(id, next);
    const finished = () => { if (pending.get(id) === next) pending.delete(id); };
    void next.then(finished, error => { failures.set(id, error); finished(); });
    return next;
}
