import { applyD1Migrations, env } from "cloudflare:test";

// Setup files run before each test file; applyD1Migrations skips already-applied migrations.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
