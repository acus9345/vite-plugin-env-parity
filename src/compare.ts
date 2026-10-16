/** Options that control what counts as a problem. */
export interface CompareOptions {
  /** Report keys that exist but have an empty value. */
  allowEmpty: boolean;
  /** Keys to skip. `*` is a wildcard. */
  ignore: readonly string[];
}

/** What is wrong with an env compared to its example. */
export interface Comparison {
  /** Keys in the example that are not set anywhere. */
  missing: string[];
  /** Keys in the example that are set to an empty value. */
  empty: string[];
  /** Keys set in env files that the example does not list. */
  extra: string[];
}

/**
 * Compare the variables you have against the ones the example requires.
 *
 * @param env - Every variable that is set (env files merged with `process.env`).
 * @param fileKeys - Keys defined in env files, used to find undocumented extras.
 * @param example - Variables listed in the example file.
 */
export function compareEnv(
  env: Readonly<Record<string, string | undefined>>,
  fileKeys: Iterable<string>,
  example: Readonly<Record<string, string>>,
  options: CompareOptions,
): Comparison {
  const isIgnored = makeIgnoreMatcher(options.ignore);
  const missing: string[] = [];
  const empty: string[] = [];
  const extra: string[] = [];

  for (const key of Object.keys(example)) {
    if (isIgnored(key)) continue;
    const value = Object.hasOwn(env, key) ? env[key] : undefined;
    if (value === undefined) missing.push(key);
    else if (!options.allowEmpty && value.trim() === "") empty.push(key);
  }

  for (const key of fileKeys) {
    if (!isIgnored(key) && !Object.hasOwn(example, key)) extra.push(key);
  }

  return { missing, empty, extra };
}

/** Build a matcher for exact key names and `*` wildcard patterns. */
export function makeIgnoreMatcher(ignore: readonly string[]): (key: string) => boolean {
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const p of ignore) {
    if (p.includes("*")) {
      const source = p
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      patterns.push(new RegExp(`^${source}$`));
    } else {
      exact.add(p);
    }
  }
  return (key) => exact.has(key) || patterns.some((re) => re.test(key));
}
