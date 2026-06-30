import * as core from "@actions/core";
import * as github from "@actions/github";
import { WebhookPayload } from "@actions/github/lib/interfaces";
import { labelPRAndLinkedIssues, labelPullRequestAndLinkedIssues, removeLabelFromPRAndLinkedIssues, addLabels, removeLabel } from "./labeler";

// event: pull_request_review:
// types: [submitted]
const PULL_REQUEST_REVIEW_EVENT = "pull_request_review";
const SUBMITTED_TYPE = "submitted";
const APPROVED_STATE = "approved";
const CHANGES_REQUESTED_STATE = "changes_requested";

// event: issues:
// types: [reopened]
const ISSUES_EVENT = "issues";
const REOPENED_TYPE = "reopened";

// event: status
const STATUS_EVENT = "status";
const SUCCESS_STATE = "success";

const REPO_TOKEN = "repo-token";
const REOPEN_LABEL = "reopen-label";
const REVIEW_LABEL = "review-label";
const MERGE_LABEL = "merge-label";
const STAGING_LABEL = "staging-label";
const STAGING_QA_TESTED_LABEL = "staging-qa-tested-label"

async function run() {
  try {
    // Setup
    const context = github.context;
    const payload = context.payload;
    logDebuggingInfo(context);
    const token = core.getInput(REPO_TOKEN, { required: true });
    const client = new github.GitHub(token);

    // Handle events
    if (context.eventName == STATUS_EVENT) {
      await handleStatusEvent(client, payload);
    } else if (context.eventName == PULL_REQUEST_REVIEW_EVENT) {
      await handlePullRequestReviewEvent(client, payload);
    } else if (context.eventName == ISSUES_EVENT) {
      await handleIssuesEvent(client, payload);
    }
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

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
  // The `${owner}:${branch.name}` head filter only matches same-repo (non-fork) branches.
  // Fork PRs are intentionally not handled, since this action runs on an internal repo.
  for (const branch of branches) {
    const pulls = await client.pulls.list({ owner, repo, state: "open", head: `${owner}:${branch.name}` });
    for (const pull of pulls.data) {
      console.log(`Found open PR #${pull.number} for branch '${branch.name}'.`);
      await labelPullRequestAndLinkedIssues(client, pull.number, pull.body, reviewLabel);
    }
  }
}

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

async function handleIssuesEvent(client: github.GitHub, payload: WebhookPayload) {
  const reviewLabel = core.getInput(REVIEW_LABEL, { required: true });
  const mergeLabel = core.getInput(MERGE_LABEL, { required: true });
  const reopenLabel = core.getInput(REOPEN_LABEL, { required: true });
  const stagingLabel = core.getInput(STAGING_LABEL, { required: true });
  const stagingQaTestedLabel = core.getInput(STAGING_QA_TESTED_LABEL, { required: true });

  if (payload.action == REOPENED_TYPE) {
    console.log(`Issue ${payload.issue.number} was reopened. Added reopen label and removing review, merge and staging labels...`);
    await removeLabel(client, payload.issue.number, reviewLabel);
    await removeLabel(client, payload.issue.number, mergeLabel);
    await removeLabel(client, payload.issue.number, stagingLabel);
    await removeLabel(client, payload.issue.number, stagingQaTestedLabel);
    await addLabels(client, payload.issue.number, [reopenLabel]);
    return;
  }
}

function logDebuggingInfo(context: any) {
  // context has type Context
  console.log("Running FlightLogger Label Action...");
  console.log("Event activated by: " + context.actor);
  console.log("Event name: " + context.eventName);
  console.log("Payload action: " + context.payload.action);
  console.log("Context action: " + context.action);
  console.log("Payload changes: " + JSON.stringify(context.payload.changes, undefined, 2));
  if (context.payload.review) {
    console.log("Review state: " + context.payload.review.state);
  }
}

run();
