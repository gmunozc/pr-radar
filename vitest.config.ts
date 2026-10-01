import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Calendar rules (quiet hours, snooze, digest) use local time: pin it so results match on CI.
    env: { TZ: 'UTC' }
  }
})
