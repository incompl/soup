---
description: Commit the current working copy with a short message
---

Commit the current working copy.

1. Run `git status` and `git diff` (including staged changes) to see what changed.
2. Stage all changes with `git add -A`.
3. Write a commit message that:
   - is **less than 60 characters** long, and
   - concisely describes what changed.
4. Create the commit.

Do not push. Do not open a PR. Just commit.

Do not add a `Co-Authored-By` trailer or any other trailer — the commit message
should be only the single-line subject.
