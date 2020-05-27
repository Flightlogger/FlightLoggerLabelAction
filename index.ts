import * as core from '@actions/core';
import * as github from '@actions/github';

const LINKED_ISSUES_REGEX = /(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved) #(\d+)/g;
const REGEX_MATCH_ID_INDEX = 2;

async function run() {
  try {
    console.log("Running labeler...");
    const payload = github.context.payload;
    if (!payload.pull_request) {
      console.log("No payload pull request. Exiting...");
      return;
    }
    const token = core.getInput('repo-token', {required: true});
    const reviewTrigger = core.getInput('review-trigger', {required: true});
    const mergeLabel = core.getInput('merge-label', {required: true});
    const reviewLabel = core.getInput('review-label', {required: true});
    
    const client = new github.GitHub(token);
    const pullRequest = payload.pull_request;
    
    if(pullRequest.body.toLowerCase().includes(reviewTrigger.toLowerCase())) {
      console.log("Found review trigger!");
      const linkedIssues = getLinkedIssues(pullRequest.body);
      console.log("Adding review label to PR and linked issues...");
      await addLabels(client, pullRequest.number, [reviewLabel]);
      linkedIssues.forEach(async (value) => {
        await addLabels(client, value, [reviewLabel]) 
      })
    }

    console.log("Payload action: " + payload.action);
    console.log("Payload changes: " + JSON.stringify(payload.changes, undefined, 2));
    console.log("\nPayload:\n");
    console.log(JSON.stringify(payload, undefined, 2));
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
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

run();