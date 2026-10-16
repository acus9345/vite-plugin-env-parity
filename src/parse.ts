/** Parsed `.env` contents: variable name → value. */
export type EnvMap = Record<string, string>;

/** A line that could not be understood. Parsing continues past it. */
export interface ParseIssue {
  /** 1-based line number. */
  line: number;
  /** What is wrong with the line and how to fix it. */
  message: string;
}

/** Result of {@link parseEnvDetailed}. */
export interface ParseResult {
  /** Parsed variables. Later duplicates overwrite earlier ones, like dotenv. */
  values: EnvMap;
  /** Lines that were skipped because they are not valid `KEY=value` lines. */
  issues: ParseIssue[];
}

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=[ \t]*(.*)$/;
const QUOTES = new Set(["'", '"', "`"]);
const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

/**
 * Parse the text of a `.env` file into a plain object.
 *
 * Supports comments, blank lines, `export KEY=value`, single/double/backtick
 * quotes (including multi-line values), inline `# comments` after unquoted
 * values, CRLF line endings and a leading byte-order mark.
 *
 * @example
 * parseEnv("PORT=3000\nNAME='my app'") // { PORT: "3000", NAME: "my app" }
 */
export function parseEnv(text: string): EnvMap {
  return parseEnvDetailed(text).values;
}

/**
 * Like {@link parseEnv}, but also reports lines that were skipped because
 * they are not valid `KEY=value` lines.
 */
export function parseEnvDetailed(text: string): ParseResult {
  if (typeof text !== "string") {
    throw new TypeError(
      `parseEnv expected the file contents as a string but got ${describe(text)}. ` +
        `Read the file first, e.g. fs.readFileSync(".env", "utf8").`,
    );
  }

  const values: EnvMap = Object.create(null) as EnvMap;
  const issues: ParseIssue[] = [];
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = (lines[i] ?? "").trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = LINE.exec(line);
    if (!match) {
      issues.push({ line: lineNo, message: explainBadLine(line) });
      continue;
    }

    const key = match[1] as string;
    const rest = match[2] ?? "";
    const quote = rest[0];

    if (quote !== undefined && QUOTES.has(quote)) {
      // Search for the closing quote, possibly on a later line.
      let body = rest.slice(1);
      let end = findClosingQuote(body, quote);
      let j = i;
      while (end === -1 && j + 1 < lines.length) {
        j++;
        body += "\n" + (lines[j] ?? "");
        end = findClosingQuote(body, quote);
      }
      if (end === -1) {
        issues.push({
          line: lineNo,
          message: `${key} starts with ${quote} but the closing ${quote} is missing. Add the closing quote or remove the opening one.`,
        });
        values[key] = rest.slice(1).trim();
        continue;
      }
      i = j;
      const raw = body.slice(0, end);
      values[key] = quote === '"' ? unescapeDouble(raw) : raw;
    } else {
      values[key] = rest.replace(/\s+#.*$/, "").trim();
    }
  }

  return { values, issues };
}

function findClosingQuote(body: string, quote: string): number {
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === "\\" && quote === '"') {
      k++;
      continue;
    }
    if (ch === quote) return k;
  }
  return -1;
}

function unescapeDouble(raw: string): string {
  return raw.replace(/\\(.)/g, (_, ch: string) => ESCAPES[ch] ?? ch);
}

function explainBadLine(line: string): string {
  const preview = line.length > 40 ? `${line.slice(0, 40)}...` : line;
  if (!line.includes("=")) {
    return `expected KEY=value but found "${preview}". Add "=" after the name, or start the line with # to make it a comment.`;
  }
  return `"${preview}" does not start with a valid name. Names must start with a letter or _ and contain only letters, digits, _, . or -.`;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return "a Buffer";
  return typeof value;
}
