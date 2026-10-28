import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            DISCORD_APPLICATION_ID: "123456789012345678",
            DISCORD_BOT_TOKEN: "test-bot-token",
            GEMINI_API_KEY: "test-gemini-key",
            // DISCORD_PUBLIC_KEY is injected per-test from a generated keypair.
            DISCORD_PUBLIC_KEY: "",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
    },
  };
});
