export interface RecordedTurnInputs {
    format: 'legacy-turn-preparation-input-v1'; now: number; seed: string; ids: string[];
}

// Private host bookkeeping. The seed, clock and generated IDs are persisted
// with intent before any required writer runs; renewed preparation starts the
// same stream. Durable effect recovery never constructs this stream.
export function recordedTurnInputs(inputs: RecordedTurnInputs) {
    if (inputs.format !== 'legacy-turn-preparation-input-v1' || !Number.isFinite(inputs.now) || !inputs.seed || !Array.isArray(inputs.ids)) throw new Error('missing-recorded-turn-inputs');
    const indices = { agency: 0, location: 1 };
    const streams = new Map<string, () => number>();
    const randomFor = (writer: 'agency' | 'repression') => {
        if (!streams.has(writer)) {
            let seed = 2166136261;
            for (const char of inputs.seed + '|' + writer) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
            if (!seed) seed = 1;
            streams.set(writer, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; });
        }
        return streams.get(writer)!;
    };
    return {
        now: inputs.now,
        randomFor,
        newId: (writer: 'agency' | 'location' = 'agency') => { const id = inputs.ids[indices[writer]]; indices[writer] += 2; if (!id) throw new Error('recorded-turn-ids-exhausted'); return id; },
    };
}
