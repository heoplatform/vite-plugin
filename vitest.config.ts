import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true, // Automatically clear mock history and implementations before each test
    mockReset: true, // Automatically reset mock implementations to their initial state before each test
  },
}); 