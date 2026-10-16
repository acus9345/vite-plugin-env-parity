# vite-plugin-env-parity

Fail your Vite build when a variable listed in `.env.example` is missing or empty, so it doesn't silently become `undefined` in production.

[![npm](https://img.shields.io/npm/v/vite-plugin-env-parity)](https://www.npmjs.com/package/vite-plugin-env-parity)
[![license](https://img.shields.io/npm/l/vite-plugin-env-parity)](LICENSE)

- **Zero config**: your existing `.env.example` is the schema.
- **Mode-aware**: checks the same files Vite loads (`.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`) plus environment variables, so it works in CI.
- **Friendly in dev**: `vite build` fails, `vite dev` only warns.
- **Catches Windows encoding traps**: `.env` files saved as UTF-16 (what `>` does in Windows PowerShell) or with a BOM, which Vite can't read.
- No runtime dependencies. Vite 6, 7 and 8. Node.js 20.19+ or 22.12+.

## Install

```sh
npm install --save-dev vite-plugin-env-parity
```

## Quick start

1. Add the plugin to `vite.config.ts` (or `vite.config.js`):

   ```ts
   import { defineConfig } from "vite";
   import envParity from "vite-plugin-env-parity";

   export default defineConfig({
     plugins: [envParity()],
   });
   ```

2. List the variables your app needs in `.env.example` (values are optional):

   ```ini
   VITE_API_URL=
   VITE_SENTRY_DSN=
   ```

3. Build:

   ```sh
   npx vite build
   ```

   If `VITE_SENTRY_DSN` isn't set anywhere, the build stops with:

   ```text
   error during build:
   [EnvParityError: [vite-plugin-env-parity] 1 variable from .env.example is not set (mode "production").
     Missing:        VITE_SENTRY_DSN
   How to fix:
     - Set the missing variables in .env, .env.local, .env.production, .env.production.local or as environment variables (e.g. in your CI settings).
     - To skip a variable on purpose, use envParity({ ignore: ["NAME"] }).]
   ```

   Add `VITE_SENTRY_DSN=...` to `.env` (or set it as an environment variable) and the build passes.

### Try it in a new project

These commands work as written in PowerShell, cmd, bash and zsh:

```sh
npx create-vite@latest my-app --template vanilla-ts --no-interactive --no-immediate
cd my-app
npm install
npm install --save-dev vite-plugin-env-parity
```

Then do steps 1–3 above. The `vanilla-ts` template has no `vite.config.ts`, so create one with the contents from step 1.

## Options

```ts
envParity({
  example: ".env.example",
  failOn: "build",
  allowEmpty: false,
  reportExtra: false,
  ignore: [],
});
```

| Option | Default | Description |
| --- | --- | --- |
| `example` | `".env.example"` in your `envDir` | File that lists the required variables. Relative paths resolve from the Vite `root`. |
| `failOn` | `"build"` | `"build"`: fail `vite build`, warn in `vite dev`/`vite preview`. `"always"`: fail every command. `"never"`: only warn. |
| `allowEmpty` | `false` | Accept variables that are set but empty (`KEY=`). |
| `reportExtra` | `false` | Also fail when your .env files define variables that the example doesn't list, so it stays up to date. |
| `ignore` | `[]` | Variables to skip. `*` is a wildcard: `["DEBUG", "SENTRY_*"]`. |

Where a variable can be set (later ones win, same as Vite):

1. `.env`
2. `.env.local`
3. `.env.[mode]` (for example `.env.production`)
4. `.env.[mode].local`
5. Environment variables (`process.env`), so CI secrets count

The files are read from Vite's `envDir` (the project root unless you changed it). With `envDir: false`, only environment variables are checked.

### Examples

Fail in dev too, and allow optional variables to be empty:

```ts
envParity({ failOn: "always", allowEmpty: true });
```

Use a different example file and skip some variables:

```ts
envParity({ example: "config/env.template", ignore: ["SENTRY_*"] });
```

Only check production builds:

```ts
export default defineConfig(({ mode }) => ({
  plugins: [mode === "production" && envParity()],
}));
```

### Errors

Problems are thrown as `EnvParityError`, with a `code` of `ENV_MISMATCH`, `EXAMPLE_NOT_FOUND`, `FILE_UNREADABLE` or `INVALID_OPTIONS`. Invalid options (like a typo in an option name) throw as soon as Vite loads the config, whatever `failOn` is set to.

```ts
import envParity, { EnvParityError, type EnvParityOptions } from "vite-plugin-env-parity";
```

## Troubleshooting

**`Could not find .env.example`**: create the file in your project root (or `envDir`) with one `KEY=` per line, or point to your file with `envParity({ example: "path/to/file" })`.

**The build fails in CI, but works locally**: your local `.env` files are usually not committed, so CI only has environment variables. Set the missing ones in your CI settings (in GitHub Actions, as `env:` on the build step, using secrets for anything private), or skip them with `ignore`.

**`Wrong encoding: .env (UTF-16 LE)` or `(UTF-8 with BOM)`**: Vite can't read these files, so their values never reach your app. In Windows PowerShell 5.1, `echo KEY=value > .env` creates UTF-16 files. Re-save the file as UTF-8 by running this in PowerShell in your project folder (replace `.env` with the file's name):

```powershell
[IO.File]::WriteAllLines("$PWD\.env", (Get-Content .env))
```

Or in VS Code, click the encoding in the status bar and choose **Save with Encoding** > **UTF-8**.

**PowerShell: `npx : File ...\npx.ps1 cannot be loaded because running scripts is disabled on this system`**: this is a PowerShell setting, not a problem with this package. Use `npx.cmd` instead of `npx` (and `npm.cmd` instead of `npm`), or allow local scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**Vitest prints a warning**: Vitest runs your Vite config in `test` mode, where the plugin only warns. Add the variables to `.env.test`, or only add the plugin for builds (see the examples above).

**`warning: .env:7: expected KEY=value`**: that line couldn't be parsed and was skipped. Add `=` or turn it into a comment with `#`. Warnings never fail the build on their own.

## License

[MIT](LICENSE)
