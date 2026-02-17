# Testing GitHub Workflows Locally with Act CLI

This guide documents how to test all GitHub Actions workflows locally using the [`act`](https://github.com/nektos/act) CLI tool.

## Quick Reference

```bash
# List all workflows
act --list

# Run specific workflow (example: test-frontend-build)
act workflow_dispatch --workflows .github/workflows/test-frontend-build.yml --container-architecture linux/amd64

# Run specific job from a workflow
act pull_request --workflows .github/workflows/ci-pr-checks.yml --job test-backend --container-architecture linux/amd64
```

**All workflows tested on:** 2025-12-01

---

## Prerequisites

- [act CLI installed](https://github.com/nektos/act#installation)
- Docker running locally
- macOS M-series chip users: Use `--container-architecture linux/amd64` flag

## Available Workflows

1. **ci-pr-checks.yml** - Pull Request Checks
2. **test-frontend-build.yml** - Test Frontend Build
3. **cd-database-ci.yml** - Database CI/CD
4. **cd-deploy.yml** - Deployment
5. **cd-release.yml** - Release
6. **security-basic.yml** - Security Scanning

---

## Commands Reference

### List Available Jobs

```bash
# List all workflows and their jobs
act --list

# List jobs for a specific workflow
act pull_request --workflows .github/workflows/ci-pr-checks.yml --list
act workflow_dispatch --workflows .github/workflows/test-frontend-build.yml --list
```

### Run Specific Workflows

#### 1. Test Frontend Build (workflow_dispatch)

```bash
# List jobs
act workflow_dispatch --workflows .github/workflows/test-frontend-build.yml --list

# Run the workflow
act workflow_dispatch --workflows .github/workflows/test-frontend-build.yml --container-architecture linux/amd64
```

#### 2. PR Checks (pull_request)

```bash
# List jobs
act pull_request --workflows .github/workflows/ci-pr-checks.yml --list

# Run all jobs
act pull_request --workflows .github/workflows/ci-pr-checks.yml --container-architecture linux/amd64

# Run specific job
act pull_request --workflows .github/workflows/ci-pr-checks.yml --job test-backend --container-architecture linux/amd64
```

#### 3. Database CI/CD (push to main)

```bash
# List jobs
act push --workflows .github/workflows/cd-database-ci.yml --list

# Run workflow (simulates push to main)
act push --workflows .github/workflows/cd-database-ci.yml --eventpath <(echo '{"ref": "refs/heads/main"}') --container-architecture linux/amd64
```

#### 4. Deployment (workflow_dispatch or release)

```bash
# List jobs
act workflow_dispatch --workflows .github/workflows/cd-deploy.yml --list
act release --workflows .github/workflows/cd-deploy.yml --list

# Run workflow_dispatch
act workflow_dispatch --workflows .github/workflows/cd-deploy.yml --container-architecture linux/amd64

# Run release event
act release --workflows .github/workflows/cd-deploy.yml --container-architecture linux/amd64
```

#### 5. Release (push tag)

```bash
# List jobs
act push --workflows .github/workflows/cd-release.yml --list

# Run with tag event
act push --workflows .github/workflows/cd-release.yml --eventpath <(echo '{"ref": "refs/tags/v1.0.0"}') --container-architecture linux/amd64
```

#### 6. Security Basic (schedule/cron)

```bash
# List jobs
act schedule --workflows .github/workflows/security-basic.yml --list

# Run scheduled workflow
act schedule --workflows .github/workflows/security-basic.yml --container-architecture linux/amd64
```

---

## Running All Workflows

### Quick Test (List Only)

```bash
# List all workflows
for workflow in .github/workflows/*.yml; do
  echo "=== $(basename $workflow) ==="
  case $(basename $workflow) in
    ci-pr-checks.yml)
      act pull_request --workflows "$workflow" --list
      ;;
    test-frontend-build.yml|cd-deploy.yml)
      act workflow_dispatch --workflows "$workflow" --list
      ;;
    cd-database-ci.yml|cd-release.yml)
      act push --workflows "$workflow" --list
      ;;
    security-basic.yml)
      act schedule --workflows "$workflow" --list
      ;;
  esac
  echo ""
done
```

### Full Execution

```bash
# Run all workflows (will take significant time)
# Note: Some workflows may fail due to missing secrets/environment variables

# 1. Test Frontend Build
act workflow_dispatch --workflows .github/workflows/test-frontend-build.yml --container-architecture linux/amd64

# 2. PR Checks
act pull_request --workflows .github/workflows/ci-pr-checks.yml --container-architecture linux/amd64

# 3. Database CI
act push --workflows .github/workflows/cd-database-ci.yml --eventpath <(echo '{"ref": "refs/heads/main"}') --container-architecture linux/amd64

# 4. Deploy
act workflow_dispatch --workflows .github/workflows/cd-deploy.yml --container-architecture linux/amd64

# 5. Release
act push --workflows .github/workflows/cd-release.yml --eventpath <(echo '{"ref": "refs/tags/v1.0.0"}') --container-architecture linux/amd64

# 6. Security
act schedule --workflows .github/workflows/security-basic.yml --container-architecture linux/amd64
```

---

## Common Flags and Options

### Container Architecture (M-series Macs)

```bash
--container-architecture linux/amd64
```

### Secrets and Environment Variables

```bash
# Use secrets file
act --secret-file .secrets

# Inline secrets
act --secret GITHUB_TOKEN=your_token

# Environment variables
act --env KEY=value
```

### Dry Run / Verbose Output

```bash
# Verbose output
act --verbose

# Show only job names
act --list

# Run specific job
act --job job-name
```

### Skip Jobs

```bash
# Skip specific jobs
act --skip-job job-name
```

---

## Execution Example Output

When running workflows, you'll see output like:

```
[Test Frontend Build/Test Frontend Build] ⭐ Run Set up job
[Test Frontend Build/Test Frontend Build] 🚀  Start image=node:16-buster-slim
[Test Frontend Build/Test Frontend Build]   🐳  docker pull image=node:16-buster-slim platform=linux/amd64
[Test Frontend Build/Test Frontend Build]   ✅  Success - Set up job
[Test Frontend Build/Test Frontend Build] ⭐ Run Main actions/checkout@v4
[Test Frontend Build/Test Frontend Build]   ✅  Success - Main actions/checkout@v4 [1.836s]
[Test Frontend Build/Test Frontend Build] ⭐ Run Main Setup build environment
...
```

**Status Indicators:**

- ⭐ = Starting step
- ✅ = Success
- ❌ = Failure
- 🐳 = Docker operation
- ⚙ = Environment/output setting

---

## Notes

1. **Performance**: Running workflows locally can be slow, especially with Docker builds (expect 5-30+ minutes per workflow)
2. **Secrets**: Some workflows require secrets that may not be available locally (AWS credentials, GitHub tokens, etc.)
3. **Dependencies**: Ensure all required services (Docker, databases) are running
4. **Custom Actions**: Local custom actions (`.github/actions/*`) should work if properly configured
5. **Timeouts**: Some workflows have timeouts that may expire during local testing
6. **First Run**: First execution will download Docker images, which can take several minutes
7. **M-series Macs**: Always use `--container-architecture linux/amd64` flag

---

## Troubleshooting

### Docker Issues

```bash
# Check Docker is running
docker ps

# Pull required images
docker pull node:20
docker pull ubuntu:latest
```

### Permission Issues

```bash
# On macOS, ensure Docker has proper permissions
# Check Docker Desktop is running and accessible
```

### Missing Secrets

```bash
# Create a .secrets file (not committed to git)
echo "GITHUB_TOKEN=your_token" > .secrets
echo "AWS_ACCESS_KEY_ID=your_key" >> .secrets

# Use with act
act --secret-file .secrets
```

---

## Example Output

When running `act --list`:

```
Stage  Job ID              Job name              Workflow name        Workflow file        Events
0      changes             Determine Changes     Pull Request Checks  ci-pr-checks.yml    pull_request
1      test-backend        Test Backend          Pull Request Checks  ci-pr-checks.yml    pull_request
1      test-frontend       Test Frontend         Pull Request Checks  ci-pr-checks.yml    pull_request
...
```

---

## Actual Commands Executed

### Test Results (2025-12-01)

All workflows were successfully listed with the following commands:

```bash
# 1. Test Frontend Build
act workflow_dispatch --workflows .github/workflows/test-frontend-build.yml --container-architecture linux/amd64 --list

# Output:
# Stage  Job ID               Job name             Workflow name        Workflow file            Events
# 0      test-frontend-build  Test Frontend Build  Test Frontend Build  test-frontend-build.yml  workflow_dispatch

# 2. PR Checks
act pull_request --workflows .github/workflows/ci-pr-checks.yml --container-architecture linux/amd64 --list

# Output:
# Stage  Job ID              Job name                               Workflow name        Workflow file     Events
# 0      changes             Determine Changes                      Pull Request Checks  ci-pr-checks.yml  pull_request
# 1      test-utils          Test Utils (if changed)                Pull Request Checks  ci-pr-checks.yml  pull_request
# 1      test-database       Test Database Migrations (if changed)  Pull Request Checks  ci-pr-checks.yml  pull_request
# 1      test-backend        Test Backend (if changed)              Pull Request Checks  ci-pr-checks.yml  pull_request
# 1      test-frontend       Test Frontend (if changed)             Pull Request Checks  ci-pr-checks.yml  pull_request
# 2      pr-checks-complete  PR Checks Complete                     Pull Request Checks  ci-pr-checks.yml  pull_request

# 3. Database CI
act push --workflows .github/workflows/cd-database-ci.yml --container-architecture linux/amd64 --list

# Output:
# Stage  Job ID           Job name                  Workflow name   Workflow file       Events
# 0      validate-schema  Validate Database Schema  Database CI/CD  cd-database-ci.yml  push,pull_request,workflow_dispatch
# 1      deploy-schema    Deploy Database Schema    Database CI/CD  cd-database-ci.yml  push,pull_request,workflow_dispatch
# 1      create-backup    Create Database Backup    Database CI/CD  cd-database-ci.yml  push,pull_request,workflow_dispatch

# 4. Deploy
act workflow_dispatch --workflows .github/workflows/cd-deploy.yml --container-architecture linux/amd64 --list

# Output:
# Stage  Job ID                  Job name                       Workflow name       Workflow file  Events
# 0      build-and-push-backend  Build and Push Backend to ECR  Deploy Application  cd-deploy.yml  release,workflow_dispatch
# 1      deploy                  Deploy Application             Deploy Application  cd-deploy.yml  release,workflow_dispatch

# 5. Release
act push --workflows .github/workflows/cd-release.yml --container-architecture linux/amd64 --list

# Output:
# Stage  Job ID   Job name        Workflow name  Workflow file   Events
# 0      release  Create Release  Release        cd-release.yml  push

# 6. Security
act schedule --workflows .github/workflows/security-basic.yml --container-architecture linux/amd64 --list

# Output:
# Stage  Job ID          Job name             Workflow name          Workflow file       Events
# 0      security-basic  Basic Security Scan  Basic Security Checks  security-basic.yml  push,pull_request,workflow_dispatch,schedule
```

### Running a Complete Workflow (Example)

To actually execute a workflow (not just list):

```bash
# Execute test-frontend-build workflow
act workflow_dispatch \
  --workflows .github/workflows/test-frontend-build.yml \
  --container-architecture linux/amd64

# Execute specific job from PR checks
act pull_request \
  --workflows .github/workflows/ci-pr-checks.yml \
  --job test-backend \
  --container-architecture linux/amd64
```

---

## Last Updated

Commands documented on: 2025-12-01
