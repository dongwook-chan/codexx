# cdxx

`cdxx` is a small Codex CLI companion inspired by `agyx`.

It provides:

- local Codex auth profile save/use/next
- passive quota scanning from `$CODEX_HOME/sessions`
- optional shell integration so `codex` runs through `cdxx session`
- a Rust native supervisor for wrapped Codex TUI processes
- live autoswitch and `codex resume <session_id>` failover when a profile reaches quota

## Install locally

```bash
cd ~/codexx
npm link
cdxx install
source ~/.zshrc
```

For the current terminal only:

```bash
eval "$(cdxx shell-init)"
```

Build the native supervisor locally:

```bash
npm run build:native
```

The published package currently ships a `darwin/arm64` native supervisor. The
Rust crate and build scripts also define a Linux target, but release tarballs
should include the matching Linux binary before the package `os` field is opened
for Linux installs.

## Profile workflow

Save the currently active Codex login:

```bash
cdxx save personal
```

Add another profile:

```bash
cdxx login work
```

Switch profiles:

```bash
cdxx list
cdxx use personal
cdxx next
cdxx current
```

`cdxx` stores profile credentials under `~/.config/cdxx/profiles/<name>/auth.json`
with owner-only permissions. The active Codex credential remains
`$CODEX_HOME/auth.json`, normally `~/.codex/auth.json`.

## Quota workflow

Scan local Codex session transcripts:

```bash
cdxx scan
cdxx scan --json
cdxx scan --json --full
```

Run Codex through the wrapper:

```bash
cdxx session -- "inspect this repo"
```

After a wrapped session exits, `cdxx` scans new or modified Codex transcripts
and records rate-limit status on the active profile. Enable live profile
failover:

```bash
cdxx autoswitch on
```

With autoswitch enabled, the Rust supervisor tails the matched Codex transcript
by byte offset. If Codex reports an exhausted rate limit, `cdxx` switches to the
next available saved profile and the supervisor starts
`codex resume <session_id>` from the same working directory.

## Session matching

Codex does not expose an `agy --log-file` style TUI transcript path option.
`cdxx` matches the child session from Codex's real transcript files instead:

1. Snapshot `$CODEX_HOME/sessions/**/*.jsonl` immediately before launching Codex.
2. Poll new or modified JSONL files while Codex runs.
3. Read only the first `session_meta` record and match:
   `payload.cwd == process.cwd()`, `payload.originator == "codex-tui"`, and
   `payload.timestamp >= launchTime - 5s`.
4. Tail the matched JSONL file from the pre-launch file size, so runtime quota
   checks depend only on newly appended log bytes.

The matched `payload.session_id`/`payload.id` is suitable for `codex resume`.

## Notes

- `cdxx` reads Codex JSONL transcripts but does not print prompts or responses.
- A profile is treated as exhausted when Codex reports `primary.used_percent >= 100`,
  `secondary.used_percent >= 100`, or a non-null `rate_limit_reached_type`.
- Reset times are derived from the `resets_at` epoch fields stored by Codex.
