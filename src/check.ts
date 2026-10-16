import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { compareEnv } from "./compare.js";
import { EnvParityError } from "./errors.js";
import { parseEnvDetailed, type EnvMap } from "./parse.js";

/** Fully-resolved inputs for {@link checkEnvParity}. */
export interface CheckInput {
  /** Vite project root (absolute). */
  root: string;
  /** Folder that holds the .env files, or `false` when env files are disabled. */
  envDir: string | false;
  /** Vite mode, e.g. `"development"` or `"production"`. */
  mode: string;
  /** Example file path; relative paths resolve from `root`. `undefined` = `<envDir>/.env.example`. */
  example: string | undefined;
  allowEmpty: boolean;
  reportExtra: boolean;
  ignore: readonly string[];
  /** Usually `process.env`. */
  processEnv: Readonly<Record<string, string | undefined>>;
}

/** Outcome of a check. */
export interface CheckResult {
  /** `true` when nothing needs fixing. */
  ok: boolean;
  /** Keys in the example that are not set in any env file or environment variable. */
  missing: string[];
  /** Keys in the example that are set to an empty value. */
  empty: string[];
  /** Keys in env files that the example does not list (only when `reportExtra` is on). */
  extra: string[];
  /**
   * Env files saved in an encoding Vite cannot read (UTF-16, or UTF-8 with a
   * byte-order mark), as `"<file> (<encoding>)"`. Values from UTF-16 files are
   * ignored because Vite cannot see them either.
   */
  badEncoding: string[];
  /** Lines that could not be parsed, with file and line number. */
  warnings: string[];
  /** Absolute path of the example file. */
  examplePath: string;
  /** Env file names Vite loads for this mode, in priority order (lowest first). */
  envFileNames: string[];
}

/** Read the example and env files for a mode and compare them. */
export function checkEnvParity(input: CheckInput): CheckResult {
  const baseDir = input.envDir === false ? input.root : resolve(input.root, input.envDir);
  const examplePath =
    input.example === undefined ? resolve(baseDir, ".env.example") : resolve(input.root, input.example);
  const warnings: string[] = [];

  const exampleFile = readText(examplePath, input.root);
  if (exampleFile === undefined) {
    throw new EnvParityError(
      "EXAMPLE_NOT_FOUND",
      `Could not find ${display(examplePath, input.root)}. ` +
        `Create it and list every variable your app needs (one KEY= per line), ` +
        `or point to your example file with envParity({ example: "path/to/.env.example" }).`,
    );
  }
  const example = parseInto(exampleFile.text, examplePath, input.root, warnings);

  // Same files and order as Vite's loadEnv: later files override earlier ones.
  const envFileNames = [".env", ".env.local", `.env.${input.mode}`, `.env.${input.mode}.local`];
  const fromFiles: EnvMap = Object.create(null) as EnvMap;
  const badEncoding: string[] = [];
  if (input.envDir !== false) {
    for (const name of envFileNames) {
      const path = resolve(baseDir, name);
      if (path === examplePath) continue;
      const file = readText(path, input.root);
      if (file === undefined) continue;
      if (file.encoding !== "UTF-8") badEncoding.push(`${display(path, input.root)} (${file.encoding})`);
      // Vite reads UTF-16 files as garbage, so their values never reach the app.
      if (file.encoding.startsWith("UTF-16")) continue;
      Object.assign(fromFiles, parseInto(file.text, path, input.root, warnings));
    }
  }

  // Environment variables win over files, like in Vite.
  const merged: Record<string, string | undefined> = Object.assign(Object.create(null), fromFiles);
  for (const key of Object.keys(example)) {
    const value = input.processEnv[key];
    if (value !== undefined) merged[key] = value;
  }

  const { missing, empty, extra } = compareEnv(
    merged,
    input.reportExtra ? Object.keys(fromFiles) : [],
    example,
    input,
  );
  return {
    ok: missing.length === 0 && empty.length === 0 && extra.length === 0 && badEncoding.length === 0,
    missing,
    empty,
    extra,
    badEncoding,
    warnings,
    examplePath,
    envFileNames: input.envDir === false ? [] : envFileNames,
  };
}

/** Explain a failed {@link CheckResult} and how to fix it. */
export function formatProblems(result: CheckResult, input: Pick<CheckInput, "root" | "mode">): string {
  const example = display(result.examplePath, input.root);
  const unset = result.missing.length + result.empty.length;
  const lines: string[] = [];
  lines.push(
    unset > 0
      ? `${unset} ${unset === 1 ? "variable" : "variables"} from ${example} ${unset === 1 ? "is" : "are"} not set (mode "${input.mode}").`
      : result.badEncoding.length > 0
        ? `Vite cannot read some of your env files correctly (mode "${input.mode}").`
        : `Env files define variables that ${example} does not list (mode "${input.mode}").`,
  );
  if (result.missing.length > 0) lines.push(`  Missing:        ${result.missing.join(", ")}`);
  if (result.empty.length > 0) lines.push(`  Empty:          ${result.empty.join(", ")}`);
  if (result.extra.length > 0) lines.push(`  Undocumented:   ${result.extra.join(", ")}`);
  if (result.badEncoding.length > 0) lines.push(`  Wrong encoding: ${result.badEncoding.join(", ")}`);
  lines.push("How to fix:");
  if (result.badEncoding.length > 0) {
    lines.push(
      `  - Re-save these files as UTF-8 without a byte-order mark. Windows PowerShell's ">" creates UTF-16 files. ` +
        `In PowerShell run: [IO.File]::WriteAllLines("$PWD\\.env", (Get-Content .env)) (change .env to each file name), ` +
        `or in VS Code click the encoding in the status bar and choose "Save with Encoding" > "UTF-8".`,
    );
  }
  if (result.missing.length > 0) {
    const where =
      result.envFileNames.length > 0
        ? `in ${result.envFileNames.join(", ")} or as environment variables (e.g. in your CI settings)`
        : `as environment variables (env files are disabled by envDir: false)`;
    lines.push(`  - Set the missing variables ${where}.`);
  }
  if (result.empty.length > 0) {
    lines.push(`  - Give the empty variables a value, or allow empty values with envParity({ allowEmpty: true }).`);
  }
  if (result.extra.length > 0) {
    lines.push(`  - Add the undocumented variables to ${example}, or remove them from your env files.`);
  }
  lines.push(`  - To skip a variable on purpose, use envParity({ ignore: ["NAME"] }).`);
  return lines.join("\n");
}

function parseInto(text: string, path: string, root: string, warnings: string[]): EnvMap {
  const { values, issues } = parseEnvDetailed(text);
  for (const issue of issues) warnings.push(`${display(path, root)}:${issue.line}: ${issue.message}`);
  return values;
}

type Encoding = "UTF-8" | "UTF-8 with BOM" | "UTF-16 LE" | "UTF-16 BE";

/** Read a text file, detecting UTF-8/UTF-16 byte-order marks. Returns `undefined` if it does not exist. */
function readText(path: string, root: string): { text: string; encoding: Encoding } | undefined {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    const why =
      code === "EISDIR"
        ? "it is a folder, not a file"
        : err instanceof Error
          ? err.message
          : String(err);
    throw new EnvParityError(
      "FILE_UNREADABLE",
      `Could not read ${display(path, root)} (${why}). Make sure it is a readable text file.`,
    );
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.subarray(2).toString("utf16le"), encoding: "UTF-16 LE" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return { text: swapped.toString("utf16le"), encoding: "UTF-16 BE" };
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: bytes.subarray(3).toString("utf8"), encoding: "UTF-8 with BOM" };
  }
  return { text: bytes.toString("utf8"), encoding: "UTF-8" };
}

function display(path: string, root: string): string {
  const rel = relative(root, path);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}
