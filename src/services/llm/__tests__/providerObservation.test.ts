import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { reportProviderModel, setProviderResponseObserver } from '../providerObservation';
import { llmCall } from '../../../utils/llmCall';
import { fixtureProvider } from '../../turn/__tests__/baseAppGate/fixture';

const restorers: (() => void)[] = [];
afterEach(() => { restorers.splice(0).reverse().forEach(restore => restore()); vi.restoreAllMocks(); });
const flushRejections = () => new Promise(resolve => setTimeout(resolve, 0));

describe('thenable-safe frontend observer isolation', () => {
    it('consumes ordinary Promise rejection without awaiting the observer', async () => {
        const observer = vi.fn(() => Promise.reject(Error('observer rejected')));
        restorers.push(setProviderResponseObserver(observer));
        expect(reportProviderModel('vendor/model')).toBeUndefined();
        await flushRejections(); // Vitest also fails the test for any escaped unhandled rejection.
        expect(observer).toHaveBeenCalledExactlyOnceWith('vendor/model');
    });
    it('consumes rejection from a cross-realm Promise', async () => {
        const foreign = runInNewContext('Promise.reject(new Error("foreign observer rejected"))') as Promise<unknown>;
        expect(foreign instanceof Promise).toBe(false);
        restorers.push(setProviderResponseObserver(() => foreign));
        expect(reportProviderModel('org/model@revision')).toBeUndefined();
        await flushRejections();
    });
    it('assimilates a custom rejecting thenable', async () => {
        const then = vi.fn((_resolve: unknown, reject: (reason: Error) => void) => reject(Error('thenable rejected')));
        restorers.push(setProviderResponseObserver(() => ({ then })));
        reportProviderModel('qwen3.6:27b-q4_K_M');
        await flushRejections();
        expect(then).toHaveBeenCalledOnce();
    });
    it('isolates synchronous throws and throwing then accessors', () => {
        for (const observer of [
            () => { throw Error('synchronous observer failure'); },
            () => ({ get then() { throw Error('then accessor failure'); } }),
        ]) {
            restorers.push(setProviderResponseObserver(observer));
            expect(() => reportProviderModel('vendor/model')).not.toThrow();
        }
    });
    it('preserves successful observer returns and the absent-observer path', () => {
        const observer = vi.fn(() => 7);
        restorers.push(setProviderResponseObserver(observer));
        expect(reportProviderModel('model.v1')).toBeUndefined();
        expect(observer).toHaveBeenCalledOnce();
        restorers.push(setProviderResponseObserver(undefined));
        expect(reportProviderModel('model.v1')).toBeUndefined();
        expect(observer).toHaveBeenCalledOnce();
    });
    it('does not expose rejected model text to the observer', () => {
        const observer = vi.fn();
        restorers.push(setProviderResponseObserver(observer));
        for (const model of ['//user:secret@host/v1', 'data:text/plain,private', '{"private":"campaign"}']) reportProviderModel(model);
        expect(observer).not.toHaveBeenCalled();
    });
    it('does not wait for a pending thenable or alter a real llmCall result/request', async () => {
        const then = vi.fn(() => {}); // Intentionally never settles.
        restorers.push(setProviderResponseObserver(() => ({ then })));
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ model: 'vendor/model', choices: [{ message: { content: 'unchanged result' } }] }));
        const provider = fixtureProvider();
        expect(await llmCall(provider, 'synthetic request')).toBe('unchanged result');
        expect(fetch).toHaveBeenCalledOnce();
        const envelope = JSON.parse(String(fetch.mock.calls[0][1]?.body));
        const payload = JSON.parse(envelope.body);
        expect(payload.model).toBe(provider.modelName);
        expect(payload.messages).toEqual([{ role: 'user', content: 'synthetic request' }]);
        expect(then).toHaveBeenCalledOnce();
    });
});
