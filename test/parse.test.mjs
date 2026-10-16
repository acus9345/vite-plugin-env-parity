import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv, parseEnvDetailed } from "../dist/parse.js";

const plain = (obj) => ({ ...obj });

test("parses simple KEY=value lines", () => {
  assert.deepEqual(plain(parseEnv("A=1\nB=two")), { A: "1", B: "two" });
});

test("empty input gives an empty object", () => {
  assert.deepEqual(plain(parseEnv("")), {});
  assert.deepEqual(plain(parseEnv("\n\n   \n")), {});
});

test("skips comments and blank lines", () => {
  assert.deepEqual(plain(parseEnv("# comment\n\n  # indented\nA=1\n")), { A: "1" });
});

test("handles CRLF and CR line endings and a BOM", () => {
  assert.deepEqual(plain(parseEnv("﻿A=1\r\nB=2\rC=3\r\n")), { A: "1", B: "2", C: "3" });
});

test("supports export prefix and spaces around =", () => {
  assert.deepEqual(plain(parseEnv("export A=1\nB = 2\n  C=  3  ")), { A: "1", B: "2", C: "3" });
});

test("strips inline comments from unquoted values only", () => {
  const env = parseEnv('A=1 # note\nB="x # y"\nC=a#b');
  assert.equal(env.A, "1");
  assert.equal(env.B, "x # y");
  assert.equal(env.C, "a#b");
});

test("handles all quote styles", () => {
  const env = parseEnv(`A='single'\nB="double"\nC=\`back\`\nD=""\nE=''`);
  assert.deepEqual(plain(env), { A: "single", B: "double", C: "back", D: "", E: "" });
});

test("expands escapes only in double quotes", () => {
  const env = parseEnv(`A="a\\nb\\t\\"c\\""\nB='a\\nb'`);
  assert.equal(env.A, 'a\nb\t"c"');
  assert.equal(env.B, "a\\nb");
});

test("supports multi-line quoted values", () => {
  const env = parseEnv('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1');
  assert.equal(env.KEY, "-----BEGIN-----\nabc\n-----END-----");
  assert.equal(env.NEXT, "1");
});

test("later duplicates win", () => {
  assert.equal(parseEnv("A=1\nA=2").A, "2");
});

test("values may contain = signs", () => {
  assert.equal(parseEnv("URL=postgres://u:p@h/db?a=b").URL, "postgres://u:p@h/db?a=b");
});

test("reports invalid lines with line numbers and keeps going", () => {
  const { values, issues } = parseEnvDetailed("A=1\nnot a pair\n1BAD=x\nB=2");
  assert.deepEqual(plain(values), { A: "1", B: "2" });
  assert.equal(issues.length, 2);
  assert.equal(issues[0].line, 2);
  assert.match(issues[0].message, /expected KEY=value/);
  assert.equal(issues[1].line, 3);
  assert.match(issues[1].message, /valid name/);
});

test("reports an unterminated quote", () => {
  const { values, issues } = parseEnvDetailed('A="oops\nB=2');
  assert.equal(values.A, "oops");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /closing " is missing/);
});

test("__proto__ is stored as a normal key", () => {
  const env = parseEnv("__proto__=x\nconstructor=y");
  assert.equal(Object.keys(env).length, 2);
  assert.equal(env.__proto__, "x");
});

test("rejects non-string input", () => {
  assert.throws(() => parseEnv(Buffer.from("A=1")), /got a Buffer/);
  assert.throws(() => parseEnv(undefined), /got undefined/);
});

test("handles large input quickly", () => {
  const lines = [];
  for (let i = 0; i < 100_000; i++) lines.push(`KEY_${i}=value_${i}`);
  const start = performance.now();
  const env = parseEnv(lines.join("\n"));
  assert.equal(Object.keys(env).length, 100_000);
  assert.ok(performance.now() - start < 2000);
});
