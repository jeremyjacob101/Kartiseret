# PR 1 as built — Preserve zero Rotten Tomatoes values

Status: merged as PR #166, `Preserve zero Rotten Tomatoes scores and counts`. This file is an implementation record, not a task prompt.

## What merged

Rotten Tomatoes scorecard parsing in Now Playing and Cinematheques Update now preserves explicit numeric zero critic/audience ratings and vote counts. Missing or unparseable values retain the existing database value. The change was limited to four files and added fixture-backed tests.

## What was removed before merge

The proposed RT identity/link verification and TMDb candidate-selection changes were removed. PR #166 did not change RT search-result matching, stored RT link validation, title normalization, Unicode handling, TMDb fallback selection, title grouping, aliases, or typo-tolerant search. The existing matching behavior remains the baseline for later work.

## Validation recorded on PR #166

- `python -m unittest discover -s backend/tests` — 55 tests passed.
- `python -m compileall -q backend` — passed.
- `git diff --check` — passed.

Do not run this old task prompt or infer additional identity guarantees from the PR title. If matching correctness work is wanted later, scope it as a separate explicitly approved change.
