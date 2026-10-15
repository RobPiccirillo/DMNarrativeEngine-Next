import { defineConfig } from 'vitest/config';
import base from './vitest.config';

export default defineConfig({
    ...base,
    test: {
        ...base.test,
        include: ['src/eval/__tests__/liveSmoke.smoke.ts'],
        fileParallelism: false,
        maxWorkers: 1,
        testTimeout: 3_600_000,
    },
});
