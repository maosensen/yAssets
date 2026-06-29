# yAssets

A cross-platform **media / asset manager** desktop app, built on Tauri 2 with a Vite + React + TypeScript frontend.

## Stack

| Layer | Tech |
|---|---|
| Shell | Tauri 2 (Rust backend + OS WebView) |
| Frontend | Vite · React 19 · TypeScript (strict) |
| Routing | TanStack Router (file-based, `src/routes/`) |
| Async / IPC state | TanStack Query |
| Virtualization | TanStack Virtual |
| Client state | Zustand |
| Styling | Tailwind CSS v4 (OKLCH) + shadcn/ui (Base UI) |
| Forms | react-hook-form + zod |
| Type-safe IPC | tauri-specta → generated `src/lib/bindings.ts` |
| Lint / format | Biome (TS) · rustfmt + clippy (Rust) |
| Tests | Vitest + Testing Library · `cargo test` |
| Hooks | lefthook (biome + rustfmt + clippy on commit) |

Baseline Tauri plugins wired: `single-instance`, `window-state`, `store`, `log`, `fs` (scoped), `dialog`, `opener`.

## Prerequisites

- Rust toolchain (`rustup`)
- Node.js 20+
- pnpm (`npm i -g pnpm`)
- Platform WebView deps (macOS/Linux WebKit; Windows ships WebView2)

## Getting started

```bash
pnpm install
pnpm lefthook install     # once, to enable git hooks
pnpm tauri dev            # run the desktop app (Vite + Rust)
```

Other commands:

```bash
pnpm dev          # frontend only (browser, no native APIs)
pnpm tauri build  # production bundle (.app/.dmg/.exe/.deb/...)
pnpm check        # full gate: typecheck + lint + test + cargo fmt-check + clippy
pnpm test         # Vitest
```

## Project layout

```
src/                 # frontend (Vite + React)
  routes/            # TanStack Router file routes
  components/ui/     # shadcn components (edit freely)
  lib/               # invoke wrapper, logger, query client, errors, stores
src-tauri/           # Rust backend
  src/commands/      # #[tauri::command]s (the IPC surface)
  src/state/         # managed AppState
  src/error.rs       # typed AppError (mirrored in src/lib/errors.ts)
  capabilities/      # per-window permission sets (deny-by-default)
.github/workflows/   # ci.yml (gate) · release.yml (signed cross-platform bundles)
```

## Conventions

Read [AGENTS.md](AGENTS.md) before contributing — it documents the architecture, the
frontend↔Rust boundary, the security red lines (deny-by-default capabilities), data-directory
conventions, the error model, and the media/asset pipeline plan.

## Releasing

Tag a version to trigger the signed, cross-platform build matrix:

```bash
git tag v0.1.0 && git push --tags
```

Configure the updater + code-signing secrets referenced in `.github/workflows/release.yml`
(`pnpm tauri signer generate` for the updater keypair) before distributing.
