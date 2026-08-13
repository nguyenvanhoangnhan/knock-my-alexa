# CLAUDE.md

Self-hosted Voice Monkey alternative: a Cloudflare Worker holds all logic, a minimal AWS Lambda shim forwards Alexa Smart Home directives to it, and a private Smart Home skill declares a virtual doorbell whose `DoorbellPress` events trigger Alexa Routines.

This is a standalone project — keep code and docs self-contained, with no references to other personal projects. Everything in this repo is written in English.

## Secrets — hard rules

This repo is public. No real credential may ever be committed, in any file, in any form.

- Secrets live in exactly two places: `.dev.vars` for local development (gitignored) and `wrangler secret put` for deployment. Nowhere else — not in code, docs, examples, tests, or commit messages.
- In docs and examples use obvious placeholders: `<ALEXA_CLIENT_SECRET>`, `<TRIGGER_TOKEN>`.
- `scripts/check-secrets.sh --staged` must pass before every commit. It runs automatically via `.githooks/pre-commit` and via the Claude Code hook in `.claude/settings.json`.
- Never bypass the guard: no `git commit --no-verify`, no editing or weakening `scripts/check-secrets.sh`, `.githooks/`, or the hook config to get a commit through. If the scanner flags a false positive, rewrite the flagged line to use a placeholder instead.
- Never stage `.dev.vars`, `.env*`, `*.pem`, `*.key`.
- If a real secret does reach a commit: stop, tell the user immediately, and treat the credential as compromised — it must be rotated and history rewritten before any push. Deleting the file in a follow-up commit is not enough.

## One-time setup per clone

```sh
git config core.hooksPath .githooks
```
