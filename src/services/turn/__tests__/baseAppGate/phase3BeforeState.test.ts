import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runCanonicalTurn } from './runCanonicalTurn';

it.skipIf(process.env.PHASE3_CAPTURE_BEFORE !== '1')('captures the complete pre-change normal generation and acceptance trace', async () => {
    const result = await runCanonicalTurn();
    expect(result.trace.finalMessages.some(message => message.sceneId)).toBe(true);
    const root = 'docs/eval/phase-3/before'; mkdirSync(root, { recursive: true });
    writeFileSync(`${root}/normal-send.json`, JSON.stringify(result, null, 2));
});
