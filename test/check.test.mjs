import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEnvParity, formatProblems } from "../dist/check.js";
import { compareEnv } from "../dist/compare.js";

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "vpe-check-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

function check(root, overrides = {}) {
  return checkEnvParity({
    root,
    envDir: root,
    mode: "production",
    example: undefined,
    allowEmpty: false,
    reportExtra: false,
    ignore: [],
    processEnv: {},
    ...overrides,
  });
}

const OPTS = { allowEmpty: false, ignore: [] };

test("compareEnv: missing, empty and extra", () => {
  const r = compareEnv({ A: "", C: "3" }, ["A", "C"], { A: "", B: "" }, OPTS);
  assert.deepEqual(r, { missing: ["B"], empty: ["A"], extra: ["C"] });
});

test("compareEnv: whitespace-only counts as empty; allowEmpty accepts it", () => {
  assert.deepEqual(compareEnv({ A: "  " }, [], { A: "" }, OPTS).empty, ["A"]);
  assert.deepEqual(compareEnv({ A: "" }, [], { A: "" }, { ...OPTS, allowEmpty: true }).empty, []);
});

test("compareEnv: ignore with exact names and wildcards", () => {
  const r = compareEnv({}, ["X"], { DEBUG: "", SENTRY_DSN: "", SENTRY_ORG: "" }, {
    ...OPTS,
    ignore: ["DEBUG", "SENTRY_*", "X"],
  });
  assert.deepEqual(r, { missing: [], empty: [], extra: [] });
});

test("compareEnv: wildcard treats regex characters literally", () => {
  assert.deepEqual(compareEnv({}, [], { "A.B": "", AXB: "" }, { ...OPTS, ignore: ["A.*"] }).missing, ["AXB"]);
});

test("compareEnv: inherited properties are not treated as set", () => {
  assert.deepEqual(compareEnv({}, [], { toString: "", constructor: "" }, OPTS).missing, ["toString", "constructor"]);
});

test("compareEnv: empty inputs", () => {
  assert.deepEqual(compareEnv({}, [], {}, OPTS), { missing: [], empty: [], extra: [] });
});

test("everything set in .env passes", () => {
  const root = fixture({ ".env": "A=1\nB=2\n", ".env.example": "A=\nB=\n" });
  assert.equal(check(root).ok, true);
});

test("reports missing and empty keys", () => {
  const root = fixture({ ".env": "A=\n", ".env.example": "A=\nB=\n" });
  const r = check(root);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["B"]);
  assert.deepEqual(r.empty, ["A"]);
});

test("merges Vite's mode files with the right priority", () => {
  const root = fixture({
    ".env": "A=\nB=base\n",
    ".env.local": "B=\n",
    ".env.production": "A=prod\n",
    ".env.production.local": "B=local\n",
    ".env.development": "C=dev-only\n",
    ".env.example": "A=\nB=\nC=\n",
  });
  const r = check(root);
  assert.deepEqual(r.missing, ["C"]);
  assert.deepEqual(r.empty, []);
  assert.equal(check(root, { mode: "development" }).empty.join(), "A,B");
});

test("environment variables count and override files", () => {
  const root = fixture({ ".env": "B=\n", ".env.example": "A=\nB=\n" });
  assert.equal(check(root, { processEnv: { A: "1", B: "2" } }).ok, true);
  assert.deepEqual(check(root, { processEnv: { A: "" } }).empty, ["A", "B"]);
});

test("works with no env files at all (CI)", () => {
  const root = fixture({ ".env.example": "A=\n" });
  assert.equal(check(root, { processEnv: { A: "x" } }).ok, true);
  assert.deepEqual(check(root).missing, ["A"]);
});

test("reportExtra lists undocumented keys from files only", () => {
  const root = fixture({ ".env": "A=1\nEXTRA=1\n", ".env.example": "A=\n" });
  assert.deepEqual(check(root).extra, []);
  const r = check(root, { reportExtra: true, processEnv: { PATH: "x" } });
  assert.deepEqual(r.extra, ["EXTRA"]);
  assert.equal(r.ok, false);
});

test("custom envDir and example path", () => {
  const root = fixture({ "env/.env": "A=1\n", "env/.env.example": "A=\n", "config/req.env": "A=\nB=\n" });
  assert.equal(check(root, { envDir: join(root, "env") }).ok, true);
  assert.deepEqual(check(root, { envDir: join(root, "env"), example: "config/req.env" }).missing, ["B"]);
});

test("envDir false only uses environment variables", () => {
  const root = fixture({ ".env": "A=1\n", ".env.example": "A=\n" });
  const r = check(root, { envDir: false });
  assert.deepEqual(r.missing, ["A"]);
  assert.match(formatProblems(r, { root, mode: "production" }), /env files are disabled/);
});

test("missing example file gives a helpful error", () => {
  const root = fixture({ ".env": "A=1\n" });
  assert.throws(
    () => check(root),
    (e) => e.code === "EXAMPLE_NOT_FOUND" && /Could not find \.env\.example\. Create it/.test(e.message),
  );
});

test("a folder in place of a file gives a helpful error", () => {
  const root = fixture({ ".env.example": "A=\n" });
  mkdirSync(join(root, ".env"));
  assert.throws(() => check(root), (e) => e.code === "FILE_UNREADABLE" && /is a folder/.test(e.message));
});

const utf16le = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);

test("example file may be UTF-16 or have a BOM (only this plugin reads it)", () => {
  const be = Buffer.from("B=\n", "utf16le");
  be.swap16();
  assert.equal(check(fixture({ ".env": "A=1\nB=1\n", ".env.example": utf16le("A=\r\nB=\r\n") })).ok, true);
  assert.equal(check(fixture({ ".env": "B=1\n", ".env.example": Buffer.concat([Buffer.from([0xfe, 0xff]), be]) })).ok, true);
  assert.equal(check(fixture({ ".env": "A=1\n", ".env.example": "﻿A=\n" })).ok, true);
});

test("UTF-16 env files fail, because Vite cannot read them", () => {
  const root = fixture({ ".env": utf16le("A=1\r\n"), ".env.example": "A=\n" });
  const r = check(root);
  assert.equal(r.ok, false);
  assert.deepEqual(r.badEncoding, [".env (UTF-16 LE)"]);
  assert.deepEqual(r.missing, ["A"]);
  const text = formatProblems(r, { root, mode: "production" });
  assert.match(text, /Wrong encoding: \.env \(UTF-16 LE\)/);
  assert.match(text, /\[IO\.File\]::WriteAllLines\("\$PWD\\\.env", \(Get-Content \.env\)\)/);
});

test("UTF-8 BOM env files fail with an explanation", () => {
  const root = fixture({ ".env.local": "﻿A=1\n", ".env.example": "A=\n" });
  const r = check(root);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.badEncoding, [".env.local (UTF-8 with BOM)"]);
  assert.match(formatProblems(r, { root, mode: "production" }), /^Vite cannot read some of your env files/);
});

test("unparseable lines become warnings with file and line", () => {
  const root = fixture({ ".env": "A=1\noops\n", ".env.example": "A=\n" });
  const r = check(root);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.length, 1);
  assert.match(r.warnings[0], /^\.env:2: expected KEY=value/);
});

test("formatProblems explains each problem and the fix", () => {
  const root = fixture({ ".env": "A=\nZ=1\n", ".env.example": "A=\nB=\n" });
  const r = check(root, { reportExtra: true });
  const text = formatProblems(r, { root, mode: "production" });
  assert.match(text, /^2 variables from \.env\.example are not set \(mode "production"\)/);
  assert.match(text, /Missing: +B/);
  assert.match(text, /Empty: +A/);
  assert.match(text, /Undocumented: +Z/);
  assert.match(text, /\.env\.production\.local/);
  assert.match(text, /allowEmpty: true/);
});

test("large files", () => {
  const keys = Array.from({ length: 20_000 }, (_, i) => `K${i}`);
  const root = fixture({
    ".env": keys.map((k) => `${k}=v`).join("\n"),
    ".env.example": keys.map((k) => `${k}=`).join("\n") + "\nLAST=",
  });
  assert.deepEqual(check(root).missing, ["LAST"]);
});
