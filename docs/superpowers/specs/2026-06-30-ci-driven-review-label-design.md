# CI-driven review label — design

Date: 2026-06-30

## Summary

Change when the review label (`6: PR for review`) is applied and removed by the
FlightLogger Label Action.

- **Stop** auto-applying the review label on PR lifecycle/review events.
- **Apply** the review label automatically only when CI goes green (the commit's
  combined GitHub status becomes `success`).
- **Stop** removing the review label on incidental review activity (e.g. plain
  comments). The label is auto-removed **only** when a review explicitly
  requests changes.
- The label continues to be applied to both the PR and its linked issues.

Out of scope (unchanged): merge-label-on-approval, the `Reopen` flow on issue
reopen, and the staging label.

## Current behavior (for reference)

Review label `6: PR for review`:

- **Applied** on: `pull_request` `ready_for_review`, `pull_request`
  `review_requested`, `pull_request` `opened`/`edited` whose body contains the
  `review-trigger` string (`please review`), and `pull_request_review`
  `dismissed`.
- **Removed** on: `pull_request_review` `submitted` with any state other than
  `approved` (covers both `changes_requested` and `commented`).

## New behavior

| Trigger | New behavior |
|---|---|
| PR `ready_for_review` | no longer touches the review label |
| PR `review_requested` | no longer touches the review label |
| PR body contains `please review` | no longer touches the review label |
| Review `dismissed` | no longer touches the review label |
| Review submitted = `changes_requested` | **removes** review label (PR + linked issues) |
| Review submitted = `commented` | does nothing |
| Review submitted = `approved` | adds merge label (unchanged) |
| Issue `reopened` | strips review/merge/staging, adds `Reopen` (unchanged) |
| **Commit combined status → `success`** | **adds** review label (PR + linked issues) |

## CI-green detection

The consuming repo (`Flightlogger/flightlogger`) runs CI on CircleCI, which
reports each job back to GitHub as a **commit status** (contexts like
`ci/circleci: build`, `ci/circleci: ruby_test`, …). CodeRabbit also posts a
commit status. The GitHub **combined status** for a commit is `success` only
when every commit-status context is `success`.

Decision: treat "CI green" as **combined status == `success`**. This
intentionally includes every tool that reports via commit statuses (CircleCI,
CodeRabbit, etc.) — the label means "all green, ready for a human."

Note: tools that report via the *checks* system (Aikido, Codacy, GitHub
Actions) are NOT part of the combined status and therefore do not affect this
logic.

### Algorithm

On a `status` webhook event:

1. Read `payload.sha`.
2. Call `repos.getCombinedStatusForRef({ owner, repo, ref: sha })`.
3. If `combined.state !== "success"`, stop.
4. Resolve the open PR(s) whose head is this commit: for each name in
   `payload.branches`, call
   `pulls.list({ owner, repo, state: "open", head: "<owner>:<branch>" })`.
5. For each matching open PR, read its `body`, parse linked issues with the
   existing `getLinkedIssues` logic, and add the review label to the PR and each
   linked issue.

The combined status flips to `success` when the last pending context completes;
that completion fires a `status` event whose combined lookup returns `success`.
Label adds are idempotent (`addLabels` swallows duplicate errors), so repeated
`status` events after green are harmless.

Pushes to branches without an open PR (including the default branch) resolve to
zero PRs and are no-ops.

## Code changes

### `index.ts`
- Add `STATUS_EVENT = "status"` handling in `run()`, dispatching to a new
  `handleStatusEvent(client, payload)` implementing the algorithm above.
- Remove `handlePullRequestEvent` entirely (all of its paths only added the
  review label, which is now CI-driven). Remove the `PULL_REQUEST_EVENT`
  dispatch.
- In `handlePullRequestReviewEvent`:
  - Delete the `dismissed` → add-review-label branch.
  - Change the removal condition from `state != APPROVED_STATE` to
    `state == "changes_requested"`.
  - Keep the `approved` → merge-label branch unchanged.
- Remove now-unused constants/inputs: `REVIEW_TRIGGER`, `OPENED_TYPE`,
  `EDITED_TYPE`, `READY_FOR_REVIEW_TYPE`, `REVIEW_REQUESTED_TYPE`,
  `PR_TEXT_EDITED_ACTIONS`, `DISMISSED_TYPE`. Add a `CHANGES_REQUESTED_STATE`
  constant.

### `labeler.ts`
- Add a helper that labels a PR (given its number and body) and its linked
  issues, reused by the CI path, e.g.
  `labelPullRequestAndLinkedIssues(client, prNumber, body, label)`. Refactor
  `labelPRAndLinkedIssues` to delegate to it so behavior stays identical for the
  existing callers.

### Workflows
- Action's own `.github/workflows/main.yml` and the consumer
  `flightlogger/.github/workflows/main.yml`:
  - Add the `status` event trigger.
  - Remove the `pull_request` trigger (no longer used).
  - Trim `pull_request_review` to `types: [submitted]`.
  - Keep `issues: [reopened]`.

### `action.yml` + `README.md`
- Remove the `review-trigger` input and its documentation.
- Update README to describe the new CI-green / changes-requested behavior.

### `dist/index.js`
- Rebuild with ncc (`npx @vercel/ncc build index.ts -o dist`) after deps are
  installed, so the committed bundle matches the TypeScript.

## Deployment notes (not code changes here)
- The consumer repo pins `Flightlogger/FlightLoggerLabelAction@v1.6`. After this
  lands, a new release tag is needed and the consumer's `uses:` reference must be
  bumped. Flagged for the user; not changed automatically.

## Testing

This action has no existing automated test suite. Verification approach:
- `tsc`/ncc build succeeds and produces an updated `dist/index.js`.
- Manual reasoning walkthrough of each event path against the table above.
- (Optional follow-up) live validation on a test PR in the consumer repo after
  release.
