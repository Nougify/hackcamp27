# Team workflow (Entire + Claude Code)

This repo uses Entire. Commits capture the Claude session as a checkpoint automatically. Run `entire agent-help` for exact CLI flags.

## Branches and trails
- Never commit to `main`. Work on a feature branch: `git switch main && git pull && git switch -c <name>/<feature>`.
- Each feature gets one trail: `entire trail create --title "<feature>"` (skip if the branch already has one: `entire trail list --project gh/nougify`).
- Keep features small; merge every few hours.

## Before pushing
1. Run `entire review` (profile `general`: local Claude Code reviewers, verdict posted to the trail). This uses the user's Claude plan, not Entire billing.
2. Fix or report every finding it raises before pushing.
3. Commit, then `git push origin <branch>`.

## Finishing a feature
- `entire trail ready <number>` to request review. A teammate approves (`entire trail approve hackcamp27/<n>`) and merges (`entire trail merge hackcamp27/<n>`).
- After someone else merges, sync: `entire trail update-branch` or `git pull origin main`.

## Gotchas
- `entire trail show` with no args returns 403; pass the number: `entire trail show <n> --project gh/nougify`.
- In Git Bash, prefix `entire api` calls with `MSYS_NO_PATHCONV=1`.
- Ask the user before `entire enable/disable/clean/login` or granting project access.
