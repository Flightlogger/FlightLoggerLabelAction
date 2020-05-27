# FlightLogger Label Action

This action labels pull requests and their linked issues if the pull request comment contains a certain trigger.

It could be used by other repos, but it is really only designed for internal use at FlightLogger.

## Contributing

First run yarn to install dependencies:
```
yarn
```

If you've changed index.ts or other related javascript or typescript you have to run ncc to compile the project into a single js file:
```
ncc build index.ts
```

Afterwards you need to git add the dist/index.js file

## Inputs

### `repo-token`

**Required** Token for accessing repository.

### `review-trigger`

The string that triggers the review label

**Default:** 'please review'

### `merge-label`

The name of the merge label

**Default:** '5: Ready for merge'

### `review-label`

The name of the review label

**Default:** '6: PR for review'

## Example usage

```yml
name: "FlightBot"

on: 
  pull_request:
    types: [opened, edited, review_requested]
  pull_request_review:
    types: [submitted, edited, dismissed]
  pull_request_review_comment:
    types: [created, edited, deleted]

jobs:
  triage:
    runs-on: ubuntu-latest
    name: Label PR and Issues
    steps:
      - name: Label pull request and related issues
        uses: Jensenks/FlightLoggerLabelAction@v1.1
        with:
          repo-token: "${{ secrets.GITHUB_TOKEN }}"
          review-trigger: "please review"
          merge-label: "5: Ready for merge"
          review-label: "6: PR for review"
```