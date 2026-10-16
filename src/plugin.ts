import type { Plugin } from "vite";
import { checkEnvParity, formatProblems } from "./check.js";
import { EnvParityError } from "./errors.js";

const NAME = "vite-plugin-env-parity";

/** Options for {@link envParity}. Every option is optional. */
export interface EnvParityOptions {
  /**
   * Path to the file that lists the required variables. Relative paths are
   * resolved from the Vite `root`.
   * @default ".env.example" in your `envDir` (the project root unless you changed it)
   */
  example?: string;
  /**
   * When a mismatch should stop Vite:
   * - `"build"`: fail `vite build`, only warn during `vite dev` / `vite preview`
   * - `"always"`: fail every command
   * - `"never"`: only warn
   * @default "build"
   */
  failOn?: "build" | "always" | "never";
  /**
   * Accept variables that are set but empty (`KEY=`).
   * @default false
   */
  allowEmpty?: boolean;
  /**
   * Also report variables defined in your .env files that the example does
   * not list, so the example stays up to date.
   * @default false
   */
  reportExtra?: boolean;
  /**
   * Variables to skip. `*` is a wildcard, e.g. `["SENTRY_*"]`.
   * @default []
   */
  ignore?: readonly string[];
}

/**
 * Vite plugin that checks your env against `.env.example`.
 *
 * Every variable listed in `.env.example` must be set, either in the .env
 * files Vite loads for the current mode or as an environment variable.
 * By default a mismatch fails `vite build` and is a warning in `vite dev`.
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
  const opts = validateOptions(options);

  return {
    name: NAME,
    configResolved(config) {
      const fail = opts.failOn === "always" || (opts.failOn === "build" && config.command === "build");
      // `envDir` is `string` in Vite 6 and `string | false` from Vite 7.
      const envDir = (config.envDir as string | false | undefined) ?? config.root;
      const input = {
        root: config.root,
        envDir,
        mode: config.mode,
        example: opts.example,
        allowEmpty: opts.allowEmpty,
        reportExtra: opts.reportExtra,
        ignore: opts.ignore,
        processEnv: process.env,
      };

      let result;
      try {
        result = checkEnvParity(input);
      } catch (err) {
        if (err instanceof EnvParityError && !fail) {
          config.logger.warn(`[${NAME}] ${err.message}`, { timestamp: true });
          return;
        }
        throw err;
      }

      for (const warning of result.warnings) {
        config.logger.warn(`[${NAME}] warning: ${warning}`, { timestamp: true });
      }
      if (result.ok) return;

      const message = formatProblems(result, input);
      if (fail) throw new EnvParityError("ENV_MISMATCH", `[${NAME}] ${message}`);
      config.logger.warn(`[${NAME}] ${message}`, { timestamp: true });
    },
  };
}

function validateOptions(options: unknown): Required<Omit<EnvParityOptions, "example">> & {
  example: string | undefined;
} {
  const bad = (message: string) =>
    new EnvParityError("INVALID_OPTIONS", `[${NAME}] ${message} See https://github.com/acus9345/vite-plugin-env-parity#options`);

  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw bad(`envParity() expects an options object, e.g. envParity({ failOn: "always" }), but got ${kind(options)}.`);
  }
  const o = options as Record<string, unknown>;
  const known = ["example", "failOn", "allowEmpty", "reportExtra", "ignore"];
  for (const key of Object.keys(o)) {
    if (!known.includes(key)) {
      throw bad(`Unknown option "${key}". Valid options are: ${known.join(", ")}.`);
    }
  }
  if (o.example !== undefined && (typeof o.example !== "string" || o.example.trim() === "")) {
    throw bad(`"example" must be a file path such as ".env.example", but got ${kind(o.example)}.`);
  }
  const failOn = o.failOn ?? "build";
  if (failOn !== "build" && failOn !== "always" && failOn !== "never") {
    throw bad(`"failOn" must be "build", "always" or "never", but got ${kind(failOn)}.`);
  }
  for (const flag of ["allowEmpty", "reportExtra"] as const) {
    if (o[flag] !== undefined && typeof o[flag] !== "boolean") {
      throw bad(`"${flag}" must be true or false, but got ${kind(o[flag])}.`);
    }
  }
  const ignore = o.ignore ?? [];
  if (!Array.isArray(ignore) || ignore.some((k) => typeof k !== "string")) {
    throw bad(`"ignore" must be an array of variable names, e.g. ["DEBUG", "SENTRY_*"], but got ${kind(ignore)}.`);
  }

  return {
    example: o.example as string | undefined,
    failOn,
    allowEmpty: (o.allowEmpty as boolean | undefined) ?? false,
    reportExtra: (o.reportExtra as boolean | undefined) ?? false,
    ignore: ignore as string[],
  };
}

function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value === "object" ? "an object" : `${typeof value} ${String(value)}`;
}
