import * as github from "@actions/github";
import { WebhookPayload } from "@actions/github/lib/interfaces";

const LINKED_ISSUES_REGEX = /(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved) #(\d+)/g;
const REGEX_MATCH_ID_INDEX = 2;

export async function labelPRAndLinkedIssues(client: github.GitHub, payload: WebhookPayload, label: string) {
  const pullRequest = payload.pull_request;
  const linkedIssues = getLinkedIssues(pullRequest.body);
  console.log(`Adding '${label}' label to PR: ${pullRequest.number}...`);
  await addLabels(client, pullRequest.number, [label]);
  linkedIssues.forEach(async value => {
    console.log(`Adding '${label}' label to issue: ${value}...`);
    await addLabels(client, value, [label]);
  });
}

export async function removeLabelFromPRAndLinkedIssues(client: github.GitHub, payload: WebhookPayload, label: string) {
  const pullRequest = payload.pull_request;
  console.log(`Removing '${label}' label from PR: ${pullRequest.number}...`);
  await removeLabel(client, pullRequest.number, label);
  removeLabelFromLinkedIssues(client, payload, label)
}

export async function removeLabelFromLinkedIssues(client: github.GitHub, payload: WebhookPayload, label: string) {
  const pullRequest = payload.pull_request;
  const linkedIssues = getLinkedIssues(pullRequest.body);
  linkedIssues.forEach(async value => {
    console.log(`Removing '${label}' label from issue: ${value}...`);
    await removeLabel(client, value, label);
  });
}

export async function addLabels(client: github.GitHub, issueNumber: number, labels: string[]) {
  try {
    await client.issues.addLabels({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issueNumber,
      labels: labels,
    });
  } catch (error) {
    console.log(`Could not add label to issue/pr ${issueNumber}: ${error["name"]}`);
  }
}

export async function removeLabel(client: github.GitHub, issueNumber: number, label: string) {
  try {
    await client.issues.removeLabel({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: issueNumber,
      name: label,
    });
  } catch (error) {
    console.log(`Could not remove label from issue/pr ${issueNumber}: ${error["name"]}`);
  }
}

export function getLinkedIssues(body: string): number[] {
  console.log("Finding linked issues...");
  let match: string[];
  let result: number[] = [];
  while ((match = LINKED_ISSUES_REGEX.exec(body))) {
    console.log("Found issue: " + match[REGEX_MATCH_ID_INDEX]);
    result.push(Number(match[REGEX_MATCH_ID_INDEX]));
  }
  console.log("Finished looking for linked issues.");
  return result;
}
