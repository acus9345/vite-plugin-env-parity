import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, createLogger, createServer, resolveConfig } from "vite";
import envParity, { envParity as named, EnvParityError } from "../dist/index.js";

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "vpe-plugin-"));
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html><body><script type="module">console.log(import.meta.env.VITE_API_URL)</script></body></html>',
  );
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return root;
}

function capturingLogger() {
  const logger = createLogger("silent");
  const warnings = [];
  logger.warn = (msg) => warnings.push(msg);
  logger.warnOnce = (msg) => warnings.push(msg);
  return { logger, warnings };
}

function resolve(root, command, plugin, extra = {}) {
  const { logger, warnings } = capturingLogger();
  const run = resolveConfig(
    { root, configFile: false, logLevel: "silent", customLogger: logger, plugins: [plugin], ...extra },
    command,
    command === "build" ? "production" : "development",
  );
  return { run, warnings };
}

test("default and named exports are the same plugin factory", () => {
  assert.equal(envParity, named);
  assert.equal(envParity().name, "vite-plugin-env-parity");
});

test("real vite build succeeds when everything is set", async () => {
  const root = project({ ".env.example": "VITE_API_URL=\n", ".env": "VITE_API_URL=https://api.example.com\n" });
  const out = await build({ root, configFile: false, logLevel: "silent", plugins: [envParity()], build: { write: false } });
  assert.ok(out);
});

test("real vite build fails with a helpful error when a key is missing", async () => {
  const root = project({ ".env.example": "VITE_API_URL=\nVITE_KEY=\n", ".env": "VITE_KEY=abc\n" });
  await assert.rejects(
    build({ root, configFile: false, logLevel: "silent", plugins: [envParity()], build: { write: false } }),
    (e) =>
      e instanceof EnvParityError &&
      e.code === "ENV_MISMATCH" &&
      /1 variable from \.env\.example is not set \(mode "production"\)/.test(e.message) &&
      /Missing: +VITE_API_URL/.test(e.message) &&
      !/\n\s+at /.test(e.stack),
  );
});

test("dev server only warns by default", async () => {
  const root = project({ ".env.example": "VITE_API_URL=\n" });
  const { logger, warnings } = capturingLogger();
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    customLogger: logger,
    plugins: [envParity()],
    server: { middlewareMode: true, ws: false },
  });
  await server.close();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[vite-plugin-env-parity\] 1 variable .* \(mode "development"\)/);
});

test("failOn: always fails in dev, never only warns in build", async () => {
  const root = project({ ".env.example": "VITE_API_URL=\n" });
  await assert.rejects(resolve(root, "serve", envParity({ failOn: "always" })).run, /VITE_API_URL/);
  const { run, warnings } = resolve(root, "build", envParity({ failOn: "never" }));
  await run;
  assert.match(warnings[0], /Missing: +VITE_API_URL/);
});

test("uses the mode's env files", async () => {
  const root = project({ ".env.example": "VITE_API_URL=\n", ".env.staging": "VITE_API_URL=https://staging\n" });
  await assert.rejects(resolve(root, "build", envParity()).run, /mode "production"/);
  await resolve(root, "build", envParity(), { mode: "staging" }).run;
});

test("environment variables satisfy the check (CI)", async () => {
  const root = project({ ".env.example": "VPE_TEST_FROM_PROCESS=\n" });
  process.env.VPE_TEST_FROM_PROCESS = "1";
  try {
    await resolve(root, "build", envParity()).run;
  } finally {
    delete process.env.VPE_TEST_FROM_PROCESS;
  }
});

test("respects Vite's envDir", async () => {
  const root = project({});
  const envDir = mkdtempSync(join(tmpdir(), "vpe-envdir-"));
  writeFileSync(join(envDir, ".env.example"), "VITE_API_URL=\n");
  writeFileSync(join(envDir, ".env"), "VITE_API_URL=x\n");
  await resolve(root, "build", envParity(), { envDir }).run;
});

test("options: example, allowEmpty, ignore, reportExtra", async () => {
  const root = project({ "required.env": "VITE_A=\nVITE_B=\nSENTRY_DSN=\n", ".env": "VITE_A=\nVITE_B=1\nVITE_X=1\n" });
  const opts = { example: "required.env", allowEmpty: true, ignore: ["SENTRY_*"] };
  await resolve(root, "build", envParity(opts)).run;
  await assert.rejects(
    resolve(root, "build", envParity({ ...opts, reportExtra: true })).run,
    /Undocumented: +VITE_X/,
  );
});

test("missing example: fails build, warns in dev", async () => {
  const root = project({ ".env": "A=1\n" });
  await assert.rejects(resolve(root, "build", envParity()).run, (e) => e.code === "EXAMPLE_NOT_FOUND");
  const { run, warnings } = resolve(root, "serve", envParity());
  await run;
  assert.match(warnings[0], /Could not find \.env\.example/);
});

test("parse warnings are logged but do not fail", async () => {
  const root = project({ ".env.example": "VITE_A=\n", ".env": "VITE_A=1\nnot valid\n" });
  const { run, warnings } = resolve(root, "build", envParity());
  await run;
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /warning: \.env:2: expected KEY=value/);
});

test("invalid options throw immediately with a helpful message", () => {
  const cases = [
    [null, /expects an options object.*got null/],
    ["x", /expects an options object/],
    [{ failOn: "sometimes" }, /"failOn" must be "build", "always" or "never", but got "sometimes"/],
    [{ allowEmpty: "yes" }, /"allowEmpty" must be true or false/],
    [{ ignore: "A" }, /"ignore" must be an array/],
    [{ example: "" }, /"example" must be a file path/],
    [{ exmaple: ".env.example" }, /Unknown option "exmaple"\. Valid options are/],
  ];
  for (const [opts, re] of cases) {
    assert.throws(() => envParity(opts), (e) => e instanceof EnvParityError && e.code === "INVALID_OPTIONS" && re.test(e.message));
  }
});

test("an empty options object and undefined use the defaults", () => {
  assert.doesNotThrow(() => envParity({}));
  assert.doesNotThrow(() => envParity(undefined));
});
