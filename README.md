# Beheld — moved

> ⚠️ **This repository is the historical home of the Beheld CLI.** Active
> development has moved to **[beheldhq/cli](https://github.com/beheldhq/cli)**.
> File issues, open PRs, and pull releases from there.

## What changed

- **Code & releases:** [github.com/beheldhq/cli](https://github.com/beheldhq/cli)
- **Engine (private):** [github.com/beheldhq/engine](https://github.com/beheldhq/engine)
- **Install:** `curl -fsSL beheld.dev/install.sh | sh` (unchanged — now serves
  from `beheldhq/cli` automatically)
- **Documentation:** [beheld.dev](https://beheld.dev)

## Why this repo is still here

- `scripts/install.sh` is kept as a safety net for any tooling or bookmarks
  that point directly at
  `raw.githubusercontent.com/eduardovrocha/beheld/main/scripts/install.sh`.
  The script's `REPO` is already pointed at `beheldhq/cli`, so users hitting
  the old raw URL still get a working install.
- Git history is preserved so old commit links, blame, and forks continue to
  resolve.

This repository is read-only going forward. No new commits will land here;
no new releases will be cut here. Existing releases (≤ v0.4.1) remain
available for reference but are superseded by [beheldhq/cli releases](https://github.com/beheldhq/cli/releases).

---

For everything else, head to **[beheldhq/cli](https://github.com/beheldhq/cli)**.
