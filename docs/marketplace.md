# Marketplace (not listed)

This repo is **not** on the official MiniMax marketplace. This pull request cannot complete that listing. Surfaces and regions are catalog-side. Submit progress is checked with Feishu + `submission_id` + email — we cannot do that from GitHub.

Not an official MiniMax-AI product. Do not claim MiniMax ownership.

## How a human submits this repo

Official submit is a **ZIP** or a **public GitHub** repo whose root (or a chosen subdirectory) contains `.minimax-plugin/plugin.json`.

This package already has that file at the repo root. A human (not CI) would submit:

| Field | Value |
| --- | --- |
| GitHub URL | `https://github.com/haoruilee/oh-my-mcode` |
| Branch | `main` |
| Directory | repo root (because `.minimax-plugin/plugin.json` is already there) |

Then they check progress with Feishu using the `submission_id` and the submitter email.

## What is already in the package vs what MiniMax reviews

Already in `.minimax-plugin/plugin.json` (schemaVersion 1): `displayName`, `category`, `exampleQueries`, `apps`, `mcpServers`, `skills`. Skills, MCP (`mcp.json`), and the portable Agent Plugins 1.0 `plugin.json` ship in this repo.

MiniMax still reviews catalog acceptance, surfaces, and regions. We do not claim that review has happened.

Official submit checklists sometimes reject install scripts, secrets, and symlinks. `scripts/install.sh` / `install.ps1` are for **local** drop-in only — omit them from a ZIP if the reviewer requires it. Do not put secrets in the package.

## Local install (what works today)

Official listing is separate. Local install stays:

```bash
npx oh-my-mcode install --yes
```

Confirm with `mcode plugin list -m local`. Interim while unpublished on npm: `npx github:haoruilee/oh-my-mcode install --yes`.

## Community registry (optional, separate)

[hetaoBackend/MiniMax-Code-Plugins](https://github.com/hetaoBackend/MiniMax-Code-Plugins) is a community home (`plugins/<you>/<plugin>/`). It is not the official MiniMax catalog and is not MiniMax-AI ownership. This cut documents it only — we are not opening a PR there.

## Never

- Secrets in the package
- Install-time network or install scripts as the official package entry
- Claiming official MiniMax-AI ownership or that we are listed
