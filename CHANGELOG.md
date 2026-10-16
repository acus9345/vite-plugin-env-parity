# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-16

### Added

- `envParity()` Vite plugin: checks that every variable in `.env.example` is set in the env files Vite loads for the current mode or in environment variables. Fails `vite build` and warns in `vite dev` by default.
- Options: `example`, `failOn` (`"build"`, `"always"`, `"never"`), `allowEmpty`, `reportExtra` and `ignore` (with `*` wildcards).
- Detects `.env` files saved as UTF-16 or UTF-8 with BOM, which Vite cannot read, and explains how to re-save them.
- `EnvParityError` with machine-readable `code` values, and TypeScript types for all options.
- Supports Vite 6, 7 and 8.

[0.1.0]: https://github.com/acus9345/vite-plugin-env-parity/releases/tag/v0.1.0
