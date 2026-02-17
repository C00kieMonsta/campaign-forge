# CI/CD Workflows

This directory contains GitHub Actions workflows for the material-extractor monorepo.

⚠️ **Important**: GitHub Actions does NOT support nested folders within `.github/workflows/`. All workflow files must be placed directly in the root workflows directory.

## 📁 Folder Structure

```
.github/workflows/
├── ci-backend-test.yml       # Backend testing workflow
├── ci-frontend-test.yml      # Frontend testing workflow
├── ci-pr-checks.yml          # Pull request validation
├── ci-utils-test.yml         # Utils package testing
├── cd-database-ci.yml        # Database CI/CD workflow
├── cd-deploy.yml             # Application deployment
├── cd-release.yml            # Release management
└── security-basic.yml        # Basic security scanning
```

## 🏷️ Naming Convention

We use a prefix-based naming convention to organize workflows:

- **`ci-*`**: Continuous Integration workflows (testing, validation)
- **`cd-*`**: Continuous Deployment workflows (deployment, releases)
- **`security-*`**: Security scanning workflows

## 🔄 Continuous Integration Workflows

### **Pull Request Checks** (`ci-pr-checks.yml`)

- **Triggers**: Pull Requests to `main`/`develop`
- **Purpose**: Comprehensive validation before merging
- **Features**:
  - Smart change detection (only runs relevant checks)
  - Dependency-aware execution order
  - Database migration validation
  - Linting, type checking, tests, builds

### **Backend Tests** (`ci-backend-test.yml`)

- **Triggers**: Changes to `apps/backend/**` or `packages/utils/**`
- **Purpose**: Fast feedback for backend-related changes
- **Features**: Type checking, unit tests, e2e tests, build verification

### **Frontend Tests** (`ci-frontend-test.yml`)

- **Triggers**: Changes to `apps/frontend/**` or `packages/utils/**`
- **Purpose**: Fast feedback for frontend-related changes
- **Features**: Type checking, tests, build verification, static export

### **Utils Tests** (`ci-utils-test.yml`)

- **Triggers**: Changes to `packages/utils/**` only
- **Purpose**: Validate shared utilities package
- **Features**: Type checking, tests, build verification, linting

## 🚀 Continuous Deployment Workflows

### **Database CI/CD** (`cd-database-ci.yml`)

- **Triggers**: Prisma schema changes, manual dispatch
- **Purpose**: Database schema testing and deployment with Prisma
- **Features**:
  - Prisma schema validation
  - Migration generation and testing
  - Automated deployment to staging/production
  - Database seeding validation
  - Schema integrity testing with Prisma

### **Application Deployment** (`cd-deploy.yml`)

- **Triggers**: Push to main, release publication, manual dispatch
- **Purpose**: Deploy applications to staging/production
- **Features**:
  - Prisma schema deployment
  - Database seeding
  - Environment selection
  - CDK-based infrastructure deployment
  - Health checks

### **Release Management** (`cd-release.yml`)

- **Triggers**: Push of version tags (`v*`)
- **Purpose**: Automated release creation
- **Features**:
  - Build artifacts
  - GitHub release creation
  - Build artifact uploads

## 🔒 Security Workflows

### **Basic Security** (`security-basic.yml`)

- **Triggers**: Weekly schedule, push to main/develop, PRs
- **Purpose**: Essential security checks for dependency vulnerabilities
- **Features**:
  - npm audit for vulnerability detection
  - Dependency checks across all packages
  - Outdated package detection
  - Lockfile security validation

> **Note**: We use only basic security scanning to keep workflows simple and maintainable. CodeQL analysis was removed to avoid complexity and permission issues.

## Usage

### Manual Deployment

1. Go to Actions tab in GitHub
2. Select "Deploy Application" workflow
3. Click "Run workflow"
4. Choose environment (staging/production)
5. Select which components to deploy

### Release Process

1. Create and push a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. The release workflow will automatically:
   - Build all packages
   - Create a GitHub release
   - Upload build artifacts

### Environment Configuration

- **Staging**: Automatic deployment on PR merge to develop
- **Production**: Manual deployment or automatic on release publication

## Required Secrets

Set these in your GitHub repository settings:

- `AWS_ACCESS_KEY_ID`: AWS access key for deployment
- `AWS_SECRET_ACCESS_KEY`: AWS secret key for deployment
- `SUPABASE_ACCESS_TOKEN`: Personal access token from Supabase dashboard
- `SUPABASE_DB_PASSWORD`: Database password for postgres user

## Required Variables

Set these in your GitHub repository variables:

- `AWS_REGION`: AWS region for deployment
- `STAGE`: Default deployment stage
- `SUPABASE_PROJECT_ID`: Your Supabase project reference ID

## Dependencies

These workflows assume your package.json files have these scripts:

- `type-check`: TypeScript type checking
- `test`: Unit tests
- `build`: Build the package
- `lint`: Linting (optional)
- `export`: Static export (frontend only)

### Backend-specific scripts (Prisma):

- `db:generate`: Generate Prisma client
- `db:push`: Push schema to database (development)
- `db:migrate`: Create and apply migrations (production)
- `db:seed`: Seed database with initial data

## Best Practices

1. **Always run tests locally** before pushing
2. **Use conventional commits** for better release notes
3. **Test in staging** before production deployment
4. **Monitor workflow runs** for any failures
5. **Review security scan results** regularly

## Troubleshooting

### Security Workflow Issues

If you encounter permission errors with CodeQL analysis:

1. **Check repository permissions**: Ensure the workflow has `security-events: write` permission
2. **Use basic security workflow**: Switch to `security-basic.yml` for essential checks without CodeQL
3. **Check GitHub Actions settings**: Verify that Actions are enabled in repository settings
4. **Review workflow permissions**: Ensure the workflow has the necessary permissions defined

### Common Issues

- **CodeQL permission errors**: Use the basic security workflow as an alternative
- **Dependency audit failures**: Check for known vulnerabilities in your packages
- **Secret detection alerts**: Review any detected secrets and remove them if not needed
