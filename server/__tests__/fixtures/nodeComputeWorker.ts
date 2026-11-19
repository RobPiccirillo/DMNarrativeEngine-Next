import vm from 'node:vm';
import type { SandboxHostMessage, SandboxWorkerLike, SandboxWorkerMessage } from '../../../src/services/mods/sandbox/sandboxTypes';

// Browser Worker transport substitute only. It executes the shipped worker
// prelude and shipped compute source, including RPC and on-return journal.
export class NodeComputeWorker implements SandboxWorkerLike {
    onmessage: SandboxWorkerLike['onmessage'] = null;
    onerror: SandboxWorkerLike['onerror'] = null;
    terminated = false;
    private scope: vm.Context;
    constructor(source: string) {
        this.scope = vm.createContext({ AbortController, structuredClone, setTimeout, clearTimeout, TextEncoder, TextDecoder, console });
        this.scope.self = this.scope;
        this.scope.postMessage = (message: SandboxWorkerMessage) => {
            if (!this.terminated) this.onmessage?.({ data: structuredClone(message) } as MessageEvent<SandboxWorkerMessage>);
        };
        vm.runInContext(source, this.scope, { timeout: 1000 });
    }
    postMessage(message: SandboxHostMessage): void {
        if (!this.terminated) this.scope.onmessage({ data: structuredClone(message) });
    }
    terminate(): void { this.terminated = true; }
}
