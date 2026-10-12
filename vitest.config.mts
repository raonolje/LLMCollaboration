import { defineConfig } from 'vitest/config';

// Archived source snapshots under work/ are evidence, not executable test suites.
export default defineConfig({ test: { include: ['tests/**/*.test.{ts,tsx}'] } });
