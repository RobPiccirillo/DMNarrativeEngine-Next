import fs from 'node:fs';
import { expect, it } from 'vitest';
import { checkPhase3Lifecycle, phase3RequiredGuards, scanPhase3LifecycleSource } from '../../../scripts/architecture/phase3-lifecycle-boundary.mjs';
import { scanSource } from '../../../scripts/architecture/surfaces.mjs';

it('retains the focused managed lifecycle guards', () => { expect(checkPhase3Lifecycle(process.cwd())).toEqual([]); });
it.each([...phase3RequiredGuards.keys()])('rejects removal of a required guard in %s', file => {
    const source = fs.readFileSync(file, 'utf8');
    for (const guard of phase3RequiredGuards.get(file)!) expect(scanPhase3LifecycleSource(file, source.replaceAll(guard, 'removedGuard'))).not.toEqual([]);
});
it('recognizes the captured writer wrapper and rejects an unrecognized alias', () => {
    expect(scanSource('src/example.ts', "campaignResourceRequest(id, url, { method: 'PUT', body });").writers).toHaveLength(1);
    expect(scanPhase3LifecycleSource('src/example.ts', "import { campaignResourceRequest as innocent } from './transport';")).not.toEqual([]);
});
it.each(['api.archive.append(id, input, story)', 'runPostTurnPipeline(state, callbacks, story, messages)'])('rejects a managed runtime bypass: %s', call => {
    const file = 'src/services/turn/acceptance/runtime.ts';
    expect(scanPhase3LifecycleSource(file, fs.readFileSync(file, 'utf8') + `\n${call};`)).not.toEqual([]);
});
