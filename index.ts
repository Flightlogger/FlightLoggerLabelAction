import * as core from "@actions/core";
import * as github from "@actions/github";
import { WebhookPayload } from "@actions/github/lib/interfaces";
import { labelPRAndLinkedIssues, removeLabelFromPRAndLinkedIssues, addLabels, removeLabel } from "./labeler";

// event: pull_request
// types: [opened, edited, ready_for_review, review_requested]
const PULL_REQUEST_EVENT = "pull_request";
const OPENED_TYPE = "opened";
const EDITED_TYPE = "edited";
const READY_FOR_REVIEW_TYPE = "ready_for_review";
const REVIEW_REQUESTED_TYPE = "review_requested";
const PR_TEXT_EDITED_ACTIONS = [OPENED_TYPE, EDITED_TYPE];

// event: pull_request_review:
// types: [submitted, edited, dismissed]
const PULL_REQUEST_REVIEW_EVENT = "pull_request_review";
const SUBMITTED_TYPE = "submitted";
const DISMISSED_TYPE = "dismissed";
const APPROVED_STATE = "approved";

// event: issues:
// types: [reopened]
const ISSUES_EVENT = "issues";
const REOPENED_TYPE = "reopened";

const REPO_TOKEN = "repo-token";
const REVIEW_TRIGGER = "review-trigger";
const REOPEN_LABEL = "reopen-label";
const REVIEW_LABEL = "review-label";
const MERGE_LABEL = "merge-label";
const STAGING_LABEL = "staging-label";

async function run() {
  try {
    // Setup
    const context = github.context;
    const payload = context.payload;
    logDebuggingInfo(context);
    const token = core.getInput(REPO_TOKEN, { required: true });
    const client = new github.GitHub(token);

    // Handle events
    if (context.eventName == PULL_REQUEST_EVENT) {
      await handlePullRequestEvent(client, payload);
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

async function handlePullRequestEvent(client: github.GitHub, payload: WebhookPayload) {
  const reviewLabel = core.getInput(REVIEW_LABEL, { required: true });

  if (payload.action == READY_FOR_REVIEW_TYPE) {
    console.log(`Draft PR marked as ready for review. Adding review label...`);
    await labelPRAndLinkedIssues(client, payload, reviewLabel);
    return;
  }

  if (payload.action == REVIEW_REQUESTED_TYPE) {
    console.log(`Requested review for PR. Adding review label...`);
    await labelPRAndLinkedIssues(client, payload, reviewLabel);
    return;
  }

  const reviewTrigger = core.getInput(REVIEW_TRIGGER, { required: true });
  const reopenLabel = core.getInput(REOPEN_LABEL, { required: true });
  const prBody = payload.pull_request.body.toLowerCase();
  if (PR_TEXT_EDITED_ACTIONS.includes(payload.action) && prBody.includes(reviewTrigger.toLowerCase())) {
    console.log(`Found review trigger '${reviewTrigger}' in PR body. Adding review label...`);
    await labelPRAndLinkedIssues(client, payload, reviewLabel);
    return;
  }
}

async function handlePullRequestReviewEvent(client: github.GitHub, payload: WebhookPayload) {
  const reviewLabel = core.getInput(REVIEW_LABEL, { required: true });

  if (payload.action == DISMISSED_TYPE) {
    console.log(`Previous review dismissed. Adding review label...`);
    await labelPRAndLinkedIssues(client, payload, reviewLabel);
    return;
  }

  if (payload.action == SUBMITTED_TYPE && payload.review && payload.review.state != APPROVED_STATE) {
    console.log(`Non-approval review submitted. Removing review label...`);
    await removeLabelFromPRAndLinkedIssues(client, payload, reviewLabel);
    return;
  }

  const mergeLabel = core.getInput(MERGE_LABEL, { required: true });
  if (payload.action == SUBMITTED_TYPE && payload.review && payload.review.state == APPROVED_STATE) {
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

  if (payload.action == REOPENED_TYPE) {
    console.log(`Issue ${payload.issue.number} was reopened. Added reopen label and removing review and merge labels...`);
    await removeLabel(client, payload.issue.number, reviewLabel);
    await removeLabel(client, payload.issue.number, mergeLabel);
    await removeLabel(client, payload.issue.number, stagingLabel);
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
