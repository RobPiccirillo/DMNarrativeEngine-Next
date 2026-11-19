import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCanonicalTurn } from './runCanonicalTurn';
import { FIXTURE_CAMPAIGN_ID as id, fixtureArchiveIndex, fixtureChapters, fixtureProvider } from './fixture';
import { useAppStore } from '../../../../store/useAppStore';
import { draftRuntimeCallbacks } from '../../drafts/runtime';
import { cancelPendingSaves } from '../../../../store/slices/campaignSlice';
import { rememberStateSaveToken } from '../../../../store/campaignStateTransport';
import { createDraftLifecycleService } from '../../../../../server/services/draftLifecycleService.js';
import { createAcceptanceCoordinator } from '../../../../../server/services/acceptanceCoordinator.js';
import { managedStateToken, verifyManagedStateSave } from '../../../../../server/services/managedStateSave.js';

const roots: string[] = [];
afterEach(() => { cancelPendingSaves(); rememberStateSaveToken(id, null); useAppStore.setState({ draftLifecycle: undefined }); for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('phase3-gate-')) throw new Error('unsafe-test-cleanup');
    fs.rmSync(root, { recursive: true, force: true });
} });

it.each(['current', 'constrained-local-v1'] as const)('records actual %s acceptance through the canonical runner and real file coordinator', async profile => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-gate-')); roots.push(root);
    const directory = path.join(root, 'campaigns'); fs.mkdirSync(directory);
    const write = (suffix: string, value: unknown) => fs.writeFileSync(path.join(directory, id + suffix), typeof value === 'string' ? value : JSON.stringify(value));
    const read = (suffix: string) => JSON.parse(fs.readFileSync(path.join(directory, id + suffix), 'utf8'));
    const options = { directory, authorityDirectory: path.join(root, 'authority') };
    const lifecycle = createDraftLifecycleService(options), acceptance = createAcceptanceCoordinator(options);
    const result = await runCanonicalTurn({ drafts: draftRuntimeCallbacks, settings: { inferenceProfileId: profile }, utilityProvider: profile === 'constrained-local-v1' ? fixtureProvider() : undefined,
        onHydrated: async () => {
            useAppStore.setState({ draftLifecycle: undefined }); rememberStateSaveToken(id, null);
            const store = useAppStore.getState(); write('.json', { id, name: 'Synthetic canonical gate' });
            write('.state.json', { context: store.context, messages: store.messages, condenser: store.condenser });
            write('.archive.md', '## SCENE 000\n*date*\n\n**[USER]**\nI enter the tavern.\n\n**[GM]**\nThe tavern keeper eyes you warily.\n\n---\n');
            write('.archive.index.json', fixtureArchiveIndex()); write('.archive.chapters.json', fixtureChapters());
        },
        routes: [{ match: url => url.startsWith(`/api/campaigns/${id}/`) && /\/(state|lifecycle|acceptance\/[^/]+)$/.test(url),
            respond: async (url, init) => {
                const body = init?.body ? JSON.parse(String(init.body)) : {}, action = url.split('/').at(-1);
                let value: unknown;
                if (action === 'state') {
                    if (init?.method === 'PUT') { verifyManagedStateSave(directory, id, new Headers(init.headers).get('X-Phase3-State-Token'), body); write('.state.json', body); }
                    value = read('.state.json');
                } else if (action === 'lifecycle') value = init?.method === 'POST' ? await lifecycle.transition(id, body) : await lifecycle.inspect(id);
                else if (action === 'prepare') value = await acceptance.preflight(id, body.candidate, body.storageToken);
                else if (action === 'commit') value = await acceptance.commit(id, body);
                else if (action === 'publication') value = await acceptance.publication(id, body.logicalKey);
                else if (action === 'acknowledge') value = await acceptance.acknowledge(id, body.logicalKey, body.head);
                else throw new Error('unexpected-managed-gate-route');
                const token = managedStateToken(directory, id);
                return Response.json(value, { headers: token ? { 'X-Phase3-State-Token': encodeURIComponent(JSON.stringify(token)) } : {} });
            } }],
        observeAcceptance: async recorder => {
            const journal = read('.acceptance.json'), command = journal.commands[0];
            expect(journal.commands).toHaveLength(1); expect(command).toMatchObject({ status: 'completed', acknowledged: true });
            expect(command.steps.every((step: { status: string }) => step.status === 'applied')).toBe(true);
            recorder.recordLifecycle('acceptance.storage', { command: 'command-1', revision: 'revision-1', status: command.status,
                acknowledged: command.acknowledged, steps: command.steps.map((step: { id: string; status: string }) => ({ id: step.id, status: step.status })) });
        },
    });
    const baseline = JSON.parse(fs.readFileSync(path.resolve('src/services/turn/__tests__/baseAppGate/baseline.json'), 'utf8'));
    if (profile === 'current') expect(result.trace.payload).toEqual(baseline.payload);
    // Current retains the fixture's existing optional calls. Constrained
    // permits only the required Story invocation through acceptance/quiescence.
    expect(result.fetchLog.filter(call => /\/llm\/proxy$/.test(call.url))).toHaveLength(profile === 'constrained-local-v1' ? 1 : 3);
    expect(result.trace.effects.some(effect => effect.name === 'acceptance.storage')).toBe(true);
    expect(read('.state.json').messages.at(-1)).toMatchObject({ sceneId: '001', draftStatus: 'accepted' });
});
