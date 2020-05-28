import * as core from '@actions/core';
import * as github from '@actions/github';
import { WebhookPayload } from '@actions/github/lib/interfaces';

const LINKED_ISSUES_REGEX = /(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved) #(\d+)/g;
const REGEX_MATCH_ID_INDEX = 2;
const PULL_REQUEST_EVENT = "pull_request";
const PULL_REQUEST_REVIEW_EVENT = "pull_request_review";
const REVIEW_LABEL_ACTIONS = ["opened", "edited"];
const MERGE_LABEL_ACTIONS = ["submitted"];
const APPROVED_STATE = "approved";

async function run() {
  try {
    const context = github.context;
    const payload = context.payload;
    logDebuggingInfo(context);
    if (!payload.pull_request) {
      console.log("No payload pull request. Exiting...");
      return;
    }
    const token = core.getInput('repo-token', {required: true});
    const client = new github.GitHub(token);

    if (context.eventName == PULL_REQUEST_EVENT && REVIEW_LABEL_ACTIONS.includes(payload.action)) {
      await applyReviewLabels(client, payload);
    } else if (context.eventName == PULL_REQUEST_REVIEW_EVENT && MERGE_LABEL_ACTIONS.includes(payload.action)) {
      if (!payload.review || payload.review.state != APPROVED_STATE) return;
      await applyMergeLabels(client, payload);
    }
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

async function applyReviewLabels(client: github.GitHub, payload: WebhookPayload) {
  const reviewLabel = core.getInput('review-label', {required: true});
  const reviewTrigger = core.getInput('review-trigger', {required: true});
  const pullRequest = payload.pull_request;

  if(pullRequest.body.toLowerCase().includes(reviewTrigger.toLowerCase())) {
    console.log(`Found review trigger in PR body: ${reviewTrigger}`);
    await labelPRAndLinkedIssues(client, payload, reviewLabel);
  }
}

async function applyMergeLabels(client: github.GitHub, payload: WebhookPayload) {
  const mergeLabel = core.getInput('merge-label', {required: true});
  await labelPRAndLinkedIssues(client, payload, mergeLabel);
}

async function labelPRAndLinkedIssues(client: github.GitHub, payload: WebhookPayload, label: string) {
  const pullRequest = payload.pull_request;
  const linkedIssues = getLinkedIssues(pullRequest.body);
  console.log(`Adding '${label}' label to PR: ${pullRequest.number}...`);
  await addLabels(client, pullRequest.number, [label]);
  linkedIssues.forEach(async (value) => {
    console.log(`Adding '${label}' label to issue: ${value}...`);
    await addLabels(client, value, [label]) 
  })
}

async function addLabels(
  client: github.GitHub,
  prNumber: number,
  labels: string[]
) {
  try {
    await client.issues.addLabels({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: prNumber,
      labels: labels
    });
  } catch (error) {
    console.log(`Could not add label to issue/pr ${prNumber}: ${error['name']}`)
  }
}

function getLinkedIssues(body: string): number[] {
  console.log("Finding linked issues...");
  let match: string[];
  let result: number[] = [];
  while (match = LINKED_ISSUES_REGEX.exec(body)) {
    console.log("Found issue: " + match[REGEX_MATCH_ID_INDEX])
    result.push(Number(match[REGEX_MATCH_ID_INDEX]))
  }
  console.log("Finished looking for linked issues.");
  return result;
};

function logDebuggingInfo(context: any) { // context has type Context
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