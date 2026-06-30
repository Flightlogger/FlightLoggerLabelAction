# FlightLogger Label Action

This action labels pull requests and their linked issues based on CI status and review events.

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

### `merge-label`

The name of the merge label

**Default:** '5: Ready for merge'

### `review-label`

The name of the review label. This label is added automatically to the pull request and its linked issues when the commit's combined CI status turns green (all GitHub commit statuses == success). It is removed automatically ONLY when a review requests changes.

**Default:** '6: PR for review'

## Example usage

In production: (Rememeber to update the version tag)

```yml
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
      - name: Label pull request and related issues
        uses: Flightlogger/FlightLoggerLabelAction@v1.2
        with:
          repo-token: "${{ secrets.GITHUB_TOKEN }}"
          merge-label: "5: Ready for merge"
          review-label: "6: PR for review"
```

In development: (Uses the action version in the PR.)

```yml
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
          merge-label: "5: Ready for merge"
          review-label: "6: PR for review"
```