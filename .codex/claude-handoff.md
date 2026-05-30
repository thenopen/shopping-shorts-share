채 Codex -> Claude Code Handoff

## Protocol
- Claude Code owns planning, broad analysis, debugging direction, and review.
- Codex owns implementation, focused edits, test/build execution, and final patch cleanup.
- User intervention should be minimized. Codex should choose reasonable defaults and proceed when changes are reversible or backed up.
- For risky irreversible actions, Codex should stop and request explicit approval.
- After each implementation pass, Codex updates this file so Claude Code can continue automatically.

## Latest Codex Result

### Summary
- Removed the failing global Codex `UserPromptSubmit` hook that was causing: `hook exited with code 1`.
- Confirmed `vexp` is not present in global `hooks.json`.
- Confirmed global Codex TOML/JSON syntax is valid after edits.

### Files Changed
- `C:\Users\user\.codex\config.toml`
  - Removed trusted hook-state entries for global `session_start` and `user_prompt_submit` hooks.
- `C:\Users\user\.codex\hooks.json`
  - Removed `UserPromptSubmit` hook that ran `C:\Users\user\.claude\hooks\caveman-mode-tracker.js`.

### Backup
- `C:\Users\user\.codex\hooks.json.bak-before-remove-userpromptsubmit`

### Verification
- `config.toml` parsed successfully with Python `tomllib`: `TOML_OK`.
- `hooks.json` parsed successfully with PowerShell `ConvertFrom-Json`: `JSON_OK`.
- Search found no remaining `UserPromptSubmit`, `caveman-mode-tracker`, or `vexp` in `hooks.json`.

### Claude Code Follow-Up
- If `UserPromptSubmit hook (failed)` appears again, inspect project-local `.codex/hooks.json` or regenerated global hook files.
- Current project now has `.codex/claude-handoff.md` for automatic handoff notes.

---

## Latest Codex Result - Sandbox Setting Cleanup

### Summary
- Removed global Codex Windows sandbox setting from `C:\Users\user\.codex\config.toml`.
- Removed block:
  - `[windows]`
  - `sandbox = "elevated"`

### Backup
- `C:\Users\user\.codex\config.toml.bak-before-remove-windows-sandbox`

### Verification
- `config.toml` parsed successfully with Python `tomllib`: `TOML_OK`.
- Search found no remaining `[windows]` or `sandbox` setting in global config.

### Note
- This may require restarting Codex/Claude Code sessions before runtime sandbox behavior changes.

---

## Codex Report To Claude Code - Current Runtime Setup

### Summary
- User wants Claude Code to own planning/debugging and Codex to own implementation/test/final edits.
- Codex created and will maintain project handoff file at `.codex/claude-handoff.md`.
- User prefers minimal interaction; Codex should choose reasonable defaults and proceed when reversible.

### Completed
- Removed vexp-related/global hook trust state entries from `C:\Users\user\.codex\config.toml`:
  - `session_start`
  - `user_prompt_submit`
- Removed failing `UserPromptSubmit` hook from `C:\Users\user\.codex\hooks.json`.
- Removed global Windows sandbox config block from `C:\Users\user\.codex\config.toml`:
  - `[windows]`
  - `sandbox = "elevated"`
- Created project handoff file for Claude Code:
  - `C:\Users\user\Desktop\쇼핑쇼츠\.codex\claude-handoff.md`

### Verification
- `config.toml` parsed successfully with Python `tomllib`: `TOML_OK`.
- `hooks.json` parsed successfully with PowerShell `ConvertFrom-Json`: `JSON_OK`.
- No remaining `UserPromptSubmit`, `caveman-mode-tracker`, or `vexp` found in global `hooks.json`.
- No remaining `[windows]` or `sandbox` setting found in global `config.toml`.

### Backups
- `C:\Users\user\.codex\hooks.json.bak-before-remove-userpromptsubmit`
- `C:\Users\user\.codex\config.toml.bak-before-remove-windows-sandbox`

### Operational Note
- Current running sessions may still retain old sandbox/runtime behavior until restarted.
- New Codex/Claude Code sessions should pick up the cleaned config.
