import type { Plugin } from "vite";
import { resolveOptions, runCheck, type EnvParityOptions, type RunKind } from "@acus9345/env-parity";

export type { EnvParityOptions } from "@acus9345/env-parity";

const NAME = "vite-plugin-env-parity";
const DOCS = "https://github.com/acus9345/vite-plugin-env-parity#options";

/**
 * Vite plugin that checks your env against `.env.example`.
 *
 * Every variable listed in `.env.example` must be set, either in the .env
 * files Vite loads for the current mode or as an environment variable.
 * By default a mismatch fails `vite build` and stops `vite dev` from
 * starting, and is a warning in `vite preview` and Vitest.
 *
 * @example
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import envParity from "vite-plugin-env-parity";
 *
 * export default defineConfig({ plugins: [envParity()] });
 *
 * @throws {EnvParityError} immediately if the options are invalid.
 */
export function envParity(options: EnvParityOptions = {}): Plugin {
  const opts = resolveOptions(options, { name: NAME, call: "envParity", docs: DOCS });
  let isPreview = false;

  return {
    name: NAME,
    config(_config, env) {
      isPreview = env.isPreview === true;
    },
    configResolved(config) {
      // A failed check on a dev-server restart (e.g. after editing .env) is logged by Vite, which keeps the old server running.
      // Vitest resolves the config in "test" mode; tests only warn, like Next.js's test phase.
      const run: RunKind =
        config.command === "build" ? "build" : isPreview || config.mode === "test" ? "other" : "dev";
      const { error } = runCheck(opts, {
        name: NAME,
        root: config.root,
        mode: config.mode,
        run,
        // `envDir` is `string` in Vite 6 and `string | false` from Vite 7.
        envDir: (config.envDir as string | false | undefined) ?? config.root,
        hint: (option) => `envParity({ ${option} })`,
        warn: (message) => config.logger.warn(message, { timestamp: true }),
      });
      if (error) throw error;
    },
  };
}
