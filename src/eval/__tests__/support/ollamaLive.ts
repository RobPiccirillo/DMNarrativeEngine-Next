import type { EndpointConfig, SamplingConfig } from '../../../types';
import type { Json } from './types';

export type SmokeProvider = EndpointConfig & { think?: false };

export function ollamaLiveBody(payload: Record<string, unknown>, provider: SmokeProvider, sampling: SamplingConfig) {
    const mapping: Record<string, string> = { temperature: 'temperature', top_p: 'top_p', top_k: 'top_k', min_p: 'min_p', repetition_penalty: 'repeat_penalty', max_tokens: 'num_predict' };
    const options: Record<string, number> = {};
    for (const [key, value] of Object.entries(sampling)) {
        if (!(key in mapping)) throw new Error(`Unsupported native Ollama smoke sampling setting: ${key}`);
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid native Ollama sampling value');
        options[mapping[key]] = value;
    }
    if (!(options.num_predict > 0)) throw new Error('Native Ollama smoke requires an explicit output limit');
    return { model: provider.modelName, messages: payload.messages as Json, stream: true, options, ...(provider.think === false ? { think: false } : {}) };
}

export function observeOllamaStream(response: Response, onRecord: (record: Record<string, unknown>) => void, onError: (error: unknown) => void): Response {
    if (!response.body) throw new Error('Native Ollama response has no stream');
    const reader = response.body.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
    let buffer = '', terminal = false;
    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                while (true) {
                    const next = await reader.read();
                    buffer += decoder.decode(next.value, { stream: !next.done });
                    const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
                    if (next.done && buffer.trim()) { lines.push(buffer); buffer = ''; }
                    const output: string[] = [];
                    for (const line of lines.filter(s => s.trim())) {
                        const record = JSON.parse(line) as Record<string, unknown>;
                        if (record.error) throw new Error(`Native Ollama stream error: ${String(record.error)}`);
                        onRecord(record);
                        if (record.done === true) terminal = true;
                        output.push(JSON.stringify(record) + '\n');
                    }
                    if (next.done && !terminal) throw new Error('Native Ollama stream ended without a done record');
                    if (output.length) controller.enqueue(encoder.encode(output.join('')));
                    if (next.done) { reader.releaseLock(); controller.close(); return; }
                    if (output.length) return;
                }
            } catch (e) { onError(e); await reader.cancel(e).catch(() => {}); controller.error(e); }
        },
        async cancel(reason) { await reader.cancel(reason); },
    }, { highWaterMark: 0 });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: { 'Content-Type': 'application/x-ndjson' } });
}
