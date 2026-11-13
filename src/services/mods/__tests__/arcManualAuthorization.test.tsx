import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { buildHostFacade } from '../../turn/hostFacade';
import type { TurnState, TurnCallbacks } from '../../turn/turnOrchestrator';
import { buildModContext, runExplicitArcAction, type ModContext } from '../modContext';
import { readRegion, clearAllModEntries } from '../mounts/mountRegistry';
import { renderComposerModEntry } from '../mounts/chromeRenderers';
import { fixtureContext, fixtureSettings, fixtureHistory, fixtureArchiveIndex, fixtureProvider } from '../../turn/__tests__/baseAppGate/fixture';
import * as arc from '../../../../mods/arc/index.js';

function setup(profile: 'current' | 'constrained-local-v1', modId = 'arc') {
    let rows: unknown = [];
    const dispatch = vi.fn(async () => ({ content: JSON.stringify({ title: 'Harbour squeeze', type: 'economic', seed: 'The harbour levy is rising.',
        ladder: Array.from({ length: 5 }, (_, i) => ({ label: `rung ${i}`, surface: i < 2 ? 'ambient' : i < 4 ? 'rumor' : 'direct' })),
    }) }));
    const state = { context: fixtureContext(), settings: { ...fixtureSettings(), inferenceProfileId: profile }, messages: fixtureHistory(),
        archiveIndex: fixtureArchiveIndex(), npcLedger: [], chapters: [], activeCampaignId: 'arc-manual-test', input: '', provider: fixtureProvider(),
    } as unknown as TurnState;
    const facade = buildHostFacade(state, {} as TurnCallbacks, { modelCall: dispatch,
        table: { read: async () => rows, write: async (_name, next) => { rows = next; } },
    });
    const ctx = buildModContext({ mod: { id: modId, name: modId, version: '1.0.0' }, facade });
    return { ctx, dispatch, rows: () => rows };
}

afterEach(() => { cleanup(); arc.onDisable(); clearAllModEntries(); });

it.each(['current', 'constrained-local-v1'] as const)('real Arc activation and host-rendered manual button reach dispatch under %s', async profile => {
    const { ctx, dispatch, rows } = setup(profile);
    await arc.onActivate(ctx);
    const entry = readRegion('composer.actions').find(e => e.qualifiedId === 'mod.arc.injectArc');
    expect(entry).toBeDefined(); expect(dispatch).not.toHaveBeenCalled();
    render(<>{renderComposerModEntry(entry!, key => key, { current: undefined }, async () => {})}</>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rows()).toEqual([expect.objectContaining({ status: 'active' })]));
});

it('automatic Arc and ordinary mod requests cannot self-declare manual authorization', async () => {
    for (const id of ['arc', 'ordinary']) {
        const { ctx, dispatch } = setup('constrained-local-v1', id);
        const request = { prompt: 'automatic', manual: true, trigger: 'manual', execution: 'manual' };
        await expect(ctx.model.call('story', request)).rejects.toThrow('suppressed automatic model operation');
        await expect(ctx.model.callJson('story', request)).rejects.toThrow('suppressed automatic model operation');
        expect(dispatch).not.toHaveBeenCalled();
    }
});

it('scoped Arc authorization is revoked and does not authorize original, refreshed or unrelated contexts', async () => {
    const { ctx, dispatch } = setup('constrained-local-v1');
    let retained: ModContext | undefined;
    await runExplicitArcAction(ctx, async value => {
        retained = value as ModContext;
        await retained.model.call('story', { prompt: 'explicit' });
        await expect(ctx.model.call('story', { prompt: 'automatic while manual action runs' })).rejects.toThrow('suppressed');
        await expect((await retained.refresh()).model.call('story', { prompt: 'refreshed' })).rejects.toThrow('suppressed');
    });
    await expect(retained!.model.call('story', { prompt: 'late' })).rejects.toThrow('suppressed');
    const ordinary = setup('constrained-local-v1', 'ordinary');
    await runExplicitArcAction(ordinary.ctx, async value => {
        await expect((value as ModContext).model.call('story', { prompt: 'not Arc' })).rejects.toThrow('suppressed');
    });
    expect(dispatch).toHaveBeenCalledTimes(1); expect(ordinary.dispatch).not.toHaveBeenCalled();
});

it('current profile ordinary mod dispatch remains available', async () => {
    const { ctx, dispatch } = setup('current');
    await ctx.model.call('story', { prompt: 'existing current behavior' });
    expect(dispatch).toHaveBeenCalledTimes(1);
});

it('calling the real Arc callback outside the host UI boundary remains automatic and suppressed', async () => {
    const { ctx, dispatch, rows } = setup('constrained-local-v1');
    await arc.onActivate(ctx);
    const entry = readRegion('composer.actions').find(e => e.qualifiedId === 'mod.arc.injectArc');
    await entry!.entry.onSelect(await ctx.refresh());
    expect(dispatch).not.toHaveBeenCalled(); expect(rows()).toEqual([]);
});

it('throwing manual actions revoke retained authorization', async () => {
    const { ctx, dispatch } = setup('constrained-local-v1');
    let retained: ModContext | undefined;
    await expect(runExplicitArcAction(ctx, async value => {
        retained = value as ModContext;
        throw new Error('action failed');
    })).rejects.toThrow('action failed');
    await expect(retained!.model.call('story', { prompt: 'late after failure' })).rejects.toThrow('suppressed');
    expect(dispatch).not.toHaveBeenCalled();
});
