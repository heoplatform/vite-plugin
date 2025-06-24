import { describe, it, expect, vi } from 'vitest';
import { getDeps } from '../src/preload';

describe('Simple Test', () => {
    it('should import getDeps and run a simple test', () => {
        const result = getDeps([], undefined);
        expect(result).toEqual([]);
    });
}); 