# LENSINFRA

LENSINFRA is an oclif-based infrastructure CLI for Portainer and Docker environments.

It currently provides two main workflows:

- `lensinfra cleanup` - scans Portainer/Docker resources and optionally deletes safe cleanup candidates.
- `lensinfra check` - performs a read-only Bench stack health check and writes a JSON report.

## Requirements

- Node.js 18 or newer
- Access to a Portainer instance
- A Portainer API token with permission to read endpoints, stacks, and Docker gateway data

## Setup

Install dependencies:

```bash
npm install
```

Build the CLI:

```bash
npm run build
```

Run locally:

```bash
node bin/run.js --help
```

## Environment

Create a `.env` file in the project root.

Required:

```env
PORTAINER_URL=https://your-portainer-url
PORTAINER_PAT_TOKEN=your-portainer-api-token
PORTAINER_ENDPOINT_ID=auto
```

Optional:

```env
PORTAINER_AUTH_MODE=api-key
ALLOW_SELF_SIGNED_CERT=false
PORTAINER_TLS_VERIFY=true
MAX_DELETE_COUNT=100
STACK_NAME_FILTER=
STACK_LABEL_FILTER=
REPORT_DIR=reports
LOG_DIR=logs
```

Notes:

- Use `PORTAINER_ENDPOINT_ID=auto` only when one active Docker endpoint is available.
- Set `ALLOW_SELF_SIGNED_CERT=true` for local self-signed Portainer certificates.
- `MAX_DELETE_COUNT` protects cleanup runs from deleting more resources than expected.

## Commands

### Cleanup dry run

Preview cleanup candidates without deleting anything:

```bash
node bin/run.js cleanup --dryRun
```

The cleanup command scans:

- exited/dead containers from active stacks
- unused volumes
- unused images

Dry-run mode writes reports and logs, but does not delete resources.

### Cleanup

Run cleanup with confirmation prompts:

```bash
node bin/run.js cleanup
```

Safety behavior:

- running containers are not deleted
- mounted volumes are not deleted
- protected/data-like volumes are skipped
- images used by containers are skipped
- selected resources require confirmation before deletion
- `MAX_DELETE_COUNT` prevents unexpectedly large delete operations

### Stack health check

Run the read-only Bench stack health check:

```bash
node bin/run.js check
```

The check command validates:

- active Portainer endpoint access
- Docker gateway access
- stack service state
- replica counts
- migration-like services
- container health where Docker health data is available

This command does not modify Portainer or Docker resources.

## Outputs

Runtime logs are written to:

```text
logs/
```

JSON reports are written to:

```text
reports/
```

Cleanup reports use this format:

```text
cleanup-report-YYYY-MM-DDTHH-MM-SS.json
```

Health reports use this format:

```text
bench-health-report-YYYY-MM-DD-HH-mm-ss.json
```

## Development

Build TypeScript:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run lint:

```bash
npm run lint
```

## Project Structure

```text
src/
  commands/              oclif command entrypoints
  cleanup/               cleanup scanners and delete handlers
  reports/               cleanup report writer
  safety/                cleanup safety checks
  stack-health/          read-only stack health module
```

## Safety Summary

LENSINFRA is designed to be conservative:

- use dry-run before cleanup
- review generated reports
- confirm deletion prompts carefully
- keep stack-health read-only
- avoid changing cleanup and health-check logic without testing against a safe environment
