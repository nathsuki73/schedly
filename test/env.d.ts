import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as SchedlyEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends SchedlyEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
