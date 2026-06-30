# CI-driven Review Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the review label (`6: PR for review`) only when a PR's combined GitHub commit status turns `success`, and auto-remove it only when a review requests changes.

**Architecture:** A GitHub Action (TypeScript compiled to a single `dist/index.js` via ncc) that dispatches on webhook event name. We add a `status` event handler that checks the commit's combined status and labels the associated open PR(s) + their linked issues; we strip all prior auto-apply paths and narrow the review-event removal to `changes_requested` only. Merge/Reopen/staging logic is untouched.

**Tech Stack:** TypeScript, `@actions/core` ^1.2.4, `@actions/github` ^2.2.0 (Octokit Rest v16), ncc bundler, Node 12 runtime.

**Testing note:** This repo has no test framework and the code is tightly coupled to the GitHub Actions runtime (`github.context`, Octokit). Per the approved spec, verification is: a clean ncc build, bundle inspection (`grep`), and a logic walkthrough against the behavior table. We do NOT add a test framework (YAGNI for a single-file action).

---

## File Structure

- `index.ts` — event dispatch + per-event handlers. Add `handleStatusEvent`, remove `handlePullRequestEvent`, narrow `handlePullRequestReviewEvent`.
- `labeler.ts` — labeling helpers. Add `labelPullRequestAndLinkedIssues(client, prNumber, body, label)`; refactor `labelPRAndLinkedIssues` to delegate to it.
- `action.yml` — remove the `review-trigger` input.
- `.github/workflows/main.yml` — swap triggers (drop `pull_request`, add `status`, trim `pull_request_review`).
- `README.md` — document new behavior, remove `review-trigger`.
- `dist/index.js` — rebuilt ncc bundle (generated, committed).
- Consumer repo `Flightlogger/flightlogger/.github/workflows/main.yml` — deployment task, applied with the release tag (instructions only; lives in another repo).

---

## Task 1: Add labeler helper for PR-by-number

**Files:**
- Modify: `labeler.ts:7-16`

- [ ] **Step 1: Add `labelPullRequestAndLinkedIssues` and refactor `labelPRAndLinkedIssues` to delegate**

Replace the existing `labelPRAndLinkedIssues` function (currently `labeler.ts:7-16`) with these two functions:

```typescript
export async function labelPullRequestAndLinkedIssues(client: github.GitHub, prNumber: number, body: string, label: string) {
  const linkedIssues = getLinkedIssues(body || "");
  console.log(`Adding '${label}' label to PR: ${prNumber}...`);
  await addLabels(client, prNumber, [label]);
  linkedIssues.forEach(async value => {
    console.log(`Adding '${label}' label to issue: ${value}...`);
    await addLabels(client, value, [label]);
  });
}

export async function labelPRAndLinkedIssues(client: github.GitHub, payload: WebhookPayload, label: string) {
  const pullRequest = payload.pull_request;
  await labelPullRequestAndLinkedIssues(client, pullRequest.number, pullRequest.body, label);
}
```

- [ ] **Step 2: Verify the file still type-checks structurally**

Run: `grep -n "labelPullRequestAndLinkedIssues\|labelPRAndLinkedIssues" labeler.ts`
Expected: the helper is defined once and `labelPRAndLinkedIssues` references it; `getLinkedIssues` is still defined later in the file.

- [ ] **Step 3: Commit**

```bash
git add labeler.ts
git commit -m "Add labelPullRequestAndLinkedIssues helper for labeling PR by number

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add the `status` event handler in index.ts

**Files:**
- Modify: `index.ts` (imports, constants, `run()` dispatch, new handler)

- [ ] **Step 1: Update the import to include the new helper**

Replace the import line (`index.ts:4`):

```typescript
import { labelPRAndLinkedIssues, removeLabelFromPRAndLinkedIssues, addLabels, removeLabel } from "./labeler";
```

with:

```typescript
import { labelPRAndLinkedIssues, labelPullRequestAndLinkedIssues, removeLabelFromPRAndLinkedIssues, addLabels, removeLabel } from "./labeler";
```

- [ ] **Step 2: Add the `status` event + success constants**

After the existing `ISSUES_EVENT`/`REOPENED_TYPE` constants block (`index.ts:22-25`), add:

```typescript
// event: status
const STATUS_EVENT = "status";
const SUCCESS_STATE = "success";
```

- [ ] **Step 3: Add the dispatch branch in `run()`**

In `run()`, the event dispatch block (`index.ts:44-50`) currently starts with `if (context.eventName == PULL_REQUEST_EVENT)`. Add a `status` branch as the FIRST condition so the block reads:

```typescript
    // Handle events
    if (context.eventName == STATUS_EVENT) {
      await handleStatusEvent(client, payload);
    } else if (context.eventName == PULL_REQUEST_REVIEW_EVENT) {
      await handlePullRequestReviewEvent(client, payload);
    } else if (context.eventName == ISSUES_EVENT) {
      await handleIssuesEvent(client, payload);
    }
```

(Note: the `PULL_REQUEST_EVENT` branch is intentionally gone — Task 3 removes its handler.)

- [ ] **Step 4: Add the `handleStatusEvent` function**

Add this function immediately before `handlePullRequestReviewEvent` in `index.ts`:

```typescript
async function handleStatusEvent(client: github.GitHub, payload: WebhookPayload) {
  // The individual status that just changed must itself be success; if not, the
  // combined status can't be success yet, so skip the extra API call.
  if (payload.state != SUCCESS_STATE) {
    console.log(`Status '${payload.context}' is '${payload.state}', not success. Skipping.`);
    return;
  }

  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const sha = payload.sha;

  const combined = await client.repos.getCombinedStatusForRef({ owner, repo, ref: sha });
  if (combined.data.state != SUCCESS_STATE) {
    console.log(`Combined status for ${sha} is '${combined.data.state}', not success. Skipping.`);
    return;
  }

  const reviewLabel = core.getInput(REVIEW_LABEL, { required: true });
  console.log(`Combined status for ${sha} is success. Adding review label to associated open PRs...`);

  const branches = payload.branches || [];
  for (const branch of branches) {
    const pulls = await client.pulls.list({ owner, repo, state: "open", head: `${owner}:${branch.name}` });
    for (const pull of pulls.data) {
      console.log(`Found open PR #${pull.number} for branch '${branch.name}'.`);
      await labelPullRequestAndLinkedIssues(client, pull.number, pull.body, reviewLabel);
    }
  }
}
```

- [ ] **Step 5: Verify structurally**

Run: `grep -n "STATUS_EVENT\|handleStatusEvent\|getCombinedStatusForRef\|pulls.list" index.ts`
Expected: `STATUS_EVENT` referenced in both the constant and the `run()` dispatch; `handleStatusEvent` defined once; `getCombinedStatusForRef` and `pulls.list` each appear once inside it.

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "Add status event handler to apply review label on green CI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Remove all old auto-apply paths and narrow removal to changes_requested

**Files:**
- Modify: `index.ts` (constants, delete `handlePullRequestEvent`, edit `handlePullRequestReviewEvent`)

- [ ] **Step 1: Remove the now-unused pull_request constants**

Delete these lines from the constants section (`index.ts:6-13`):

```typescript
// event: pull_request
// types: [opened, edited, ready_for_review, review_requested]
const PULL_REQUEST_EVENT = "pull_request";
const OPENED_TYPE = "opened";
const EDITED_TYPE = "edited";
const READY_FOR_REVIEW_TYPE = "ready_for_review";
const REVIEW_REQUESTED_TYPE = "review_requested";
const PR_TEXT_EDITED_ACTIONS = [OPENED_TYPE, EDITED_TYPE];
```

- [ ] **Step 2: Adjust the review-event constants**

In the `pull_request_review` constants block (`index.ts:15-20`), delete the `DISMISSED_TYPE` line and add a `CHANGES_REQUESTED_STATE` constant, so the block reads:

```typescript
// event: pull_request_review:
// types: [submitted]
const PULL_REQUEST_REVIEW_EVENT = "pull_request_review";
const SUBMITTED_TYPE = "submitted";
const APPROVED_STATE = "approved";
const CHANGES_REQUESTED_STATE = "changes_requested";
```

- [ ] **Step 3: Remove the `REVIEW_TRIGGER` input constant**

Delete this line from the inputs constants block (`index.ts:28`):

```typescript
const REVIEW_TRIGGER = "review-trigger";
```

- [ ] **Step 4: Delete the entire `handlePullRequestEvent` function**

Remove the whole function `handlePullRequestEvent` (originally `index.ts:57-79`). It no longer has any callers after Task 2 Step 3.

- [ ] **Step 5: Rewrite `handlePullRequestReviewEvent`**

Replace the entire `handlePullRequestReviewEvent` function body with:

```typescript
async function handlePullRequestReviewEvent(client: github.GitHub, payload: WebhookPayload) {
  if (payload.action == SUBMITTED_TYPE && payload.review && payload.review.state == CHANGES_REQUESTED_STATE) {
    const reviewLabel = core.getInput(REVIEW_LABEL, { required: true });
    console.log(`Changes requested. Removing review label...`);
    await removeLabelFromPRAndLinkedIssues(client, payload, reviewLabel);
    return;
  }

  if (payload.action == SUBMITTED_TYPE && payload.review && payload.review.state == APPROVED_STATE) {
    const mergeLabel = core.getInput(MERGE_LABEL, { required: true });
    console.log(`Approval review submitted. Added merge label...`);
    await labelPRAndLinkedIssues(client, payload, mergeLabel);
    return;
  }
}
```

- [ ] **Step 6: Verify removed symbols are truly gone**

Run: `grep -n "PULL_REQUEST_EVENT\|handlePullRequestEvent\|REVIEW_TRIGGER\|DISMISSED_TYPE\|READY_FOR_REVIEW_TYPE\|REVIEW_REQUESTED_TYPE\|PR_TEXT_EDITED_ACTIONS\|OPENED_TYPE\|EDITED_TYPE" index.ts`
Expected: NO output (all removed).

Run: `grep -n "CHANGES_REQUESTED_STATE\|APPROVED_STATE\|removeLabelFromPRAndLinkedIssues" index.ts`
Expected: `CHANGES_REQUESTED_STATE` used in the removal branch; `APPROVED_STATE` used in the merge branch.

- [ ] **Step 7: Commit**

```bash
git add index.ts
git commit -m "Remove old review-label apply paths; remove label only on changes_requested

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Remove the `review-trigger` input from action.yml

**Files:**
- Modify: `action.yml:7-9`

- [ ] **Step 1: Delete the `review-trigger` input**

Remove these lines from `action.yml`:

```yaml
  review-trigger:
    description: 'The string that triggers the review label'
    default: 'please review'
```

- [ ] **Step 2: Verify**

Run: `grep -n "review-trigger" action.yml`
Expected: NO output.

- [ ] **Step 3: Commit**

```bash
git add action.yml
git commit -m "Remove review-trigger input from action definition

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Update the action's own workflow triggers

**Files:**
- Modify: `.github/workflows/main.yml`

- [ ] **Step 1: Replace the `on:` triggers and drop the `review-trigger` input**

Replace the full contents of `.github/workflows/main.yml` with:

```yaml
name: "FlightBot"

on:
  issues:
    types: [reopened]
  status:
  pull_request_review:
    types: [submitted]

jobs:
  triage:
    runs-on: ubuntu-latest
    name: Label PR and Issues
    steps:
      - name: Checkout # Only needed for development use
        uses: actions/checkout@v2
      - name: Label pull request and related issues
        uses: ./
        with:
          repo-token: "${{ secrets.GITHUB_TOKEN }}"
          staging-label: "4: Staging"
          merge-label: "5: Ready for merge"
          review-label: "6: PR for review"
          reopen-label: "Reopen"
```

- [ ] **Step 2: Verify**

Run: `grep -n "pull_request:\|review-trigger\|status:\|pull_request_review:" .github/workflows/main.yml`
Expected: `status:` and `pull_request_review:` present; NO `pull_request:` (the bare `pull_request` trigger) and NO `review-trigger`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/main.yml
git commit -m "Update action workflow: add status trigger, drop pull_request

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the README to locate the behavior + inputs sections**

Run: `grep -n "review-trigger\|review\|please review\|status\|label" README.md`
Use the output to find: (a) the inputs table/list mentioning `review-trigger`, and (b) any prose describing when the review label is added/removed.

- [ ] **Step 2: Edit the README**

- Remove every mention of the `review-trigger` input (table row and any prose referencing "please review").
- Update the review-label description to: the label is added automatically when the commit's combined CI status turns green (all GitHub commit statuses `success`), and removed automatically only when a review requests changes. It is applied to the PR and its linked issues.
- Leave merge-label, staging-label, and reopen-label docs unchanged.

(Exact wording is at the implementer's discretion since the README's current prose is unknown until Step 1; the content above is the required substance.)

- [ ] **Step 3: Verify**

Run: `grep -n "review-trigger\|please review" README.md`
Expected: NO output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Update README for CI-driven review label behavior

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Rebuild the dist bundle

**Files:**
- Modify: `dist/index.js` (generated)

- [ ] **Step 1: Install dependencies**

Run: `yarn install`
Expected: completes, creating `node_modules/`.

- [ ] **Step 2: Build the bundle with ncc**

Run: `npx --yes @vercel/ncc build index.ts -o dist`
Expected: prints `ncc: ...` and writes `dist/index.js` with no TypeScript errors. If ncc reports a TS error, fix the source in `index.ts`/`labeler.ts` and rebuild.

- [ ] **Step 3: Verify the new behavior is in the bundle**

Run: `grep -c "getCombinedStatusForRef" dist/index.js`
Expected: `1` or more (the status handler made it into the bundle).

Run: `grep -c "please review\|ready_for_review\|review_requested" dist/index.js`
Expected: `0` (old apply paths are gone from the bundle).

- [ ] **Step 4: Smoke-load the bundle**

Run: `node -e "process.env.INPUT_REPO_TOKEN='x'; require('./dist/index.js')" 2>&1 | head -5`
Expected: it runs without a syntax/module error. (It may log a GitHub context error because there's no event payload locally — that is fine; we only care that the module parses and executes.)

- [ ] **Step 5: Commit**

```bash
git add dist/index.js yarn.lock
git commit -m "Rebuild dist bundle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Logic walkthrough verification (no code change)

**Files:** none

- [ ] **Step 1: Walk each event path against the behavior table and confirm in writing**

Confirm in the session output:
- `status` event, individual state not `success` → early return, no API calls.
- `status` event, individual `success` but combined not `success` → return after combined lookup.
- `status` event, combined `success` → for each branch, open PRs get review label on PR + linked issues.
- `pull_request_review` submitted `changes_requested` → review label removed from PR + linked issues.
- `pull_request_review` submitted `commented` → no-op.
- `pull_request_review` submitted `approved` → merge label added (unchanged).
- `pull_request_review` `dismissed` → no-op (no longer re-adds).
- `issues` `reopened` → strips review/merge/staging, adds Reopen (unchanged).
- No `pull_request` (bare) handling remains.

- [ ] **Step 2: Confirm the public API of labeler.ts is internally consistent**

Run: `grep -n "export async function\|export function" labeler.ts`
Expected: `labelPullRequestAndLinkedIssues`, `labelPRAndLinkedIssues`, `removeLabelFromPRAndLinkedIssues`, `removeLabelFromLinkedIssues`, `addLabels`, `removeLabel`, `getLinkedIssues` — and `index.ts` imports only names that exist here.

---

## Task 9 (Deployment — separate repo, apply WITH the release): consumer workflow + version bump

> This task edits `Flightlogger/flightlogger` (a different repo at `/Users/nicholasladefoged/flightlogger`) and creates a release of this action. Do NOT apply it until the action changes above are merged and tagged. Documented here for completeness; confirm with the user before doing it.

- [ ] **Step 1: Tag a new release of this action**

After merge to `master`, create a new tag (e.g. `v1.7`) and move/update the major ref if one is used. Exact tag name to be chosen by the user.

- [ ] **Step 2: Update the consumer workflow**

In `/Users/nicholasladefoged/flightlogger/.github/workflows/main.yml`, change the `on:` block to:

```yaml
on:
  issues:
    types: [reopened]
  status:
  pull_request_review:
    types: [submitted]
```

remove the `pull_request:` trigger and the `review-trigger:` input line, and bump:

```yaml
        uses: Flightlogger/FlightLoggerLabelAction@v1.7
```

(to whatever tag was created in Step 1).

- [ ] **Step 3: Commit in the consumer repo**

```bash
cd /Users/nicholasladefoged/flightlogger
git add .github/workflows/main.yml
git commit -m "Switch review label to CI-driven (status event)"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** apply-on-green (Task 2), remove old apply paths (Task 3), remove-only-on-changes_requested (Task 3), label PR + linked issues (Task 1/2), workflow triggers (Task 5), action input removal (Task 4), README (Task 6), dist rebuild (Task 7), deployment (Task 9). All spec sections covered.
- **Placeholder scan:** README wording (Task 6) is substance-specified but exact prose is deferred because current README text is unknown until read — flagged explicitly, not a silent TODO.
- **Type consistency:** `labelPullRequestAndLinkedIssues(client, prNumber, body, label)` defined in Task 1, imported and called with the same signature in Task 2. Constants removed in Task 3 are confirmed unused by grep steps.
