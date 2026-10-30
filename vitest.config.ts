import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://fm:fm@localhost:5432/fortune_muse_test',
      ADMIN_EMAILS: 'admin@test.dev,admin2@test.dev',
      SUPER_EMAILS: 'super@test.dev,super2@test.dev',
      ANTHROPIC_API_KEY: '',
      STRIPE_SECRET_KEY: '',
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
