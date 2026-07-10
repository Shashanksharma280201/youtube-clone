import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Modules that construct the OpenAI SDK client at load need a key present.
    // Tests exercise only pure functions, so a placeholder is enough — no calls.
    env: { OPENAI_API_KEY: 'sk-test-placeholder' },
  },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
})
