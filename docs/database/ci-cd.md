# Database CI/CD Documentation

This document explains the database CI/CD pipeline for the Material Extractor project.

## 🎯 Overview

The database CI/CD pipeline ensures that:

- All database migrations are tested before deployment
- Database schema changes are validated automatically
- Migrations are deployed consistently across environments
- Database backups are created before major changes

## 🔧 Workflows

### 1. **Database CI/CD** (`.github/workflows/database-ci.yml`)

**Triggers:**

- Push to `main`/`develop` branches with database changes
- Pull requests with database changes
- Manual workflow dispatch

**Jobs:**

- `validate-migrations`: Tests migrations locally with Docker
- `deploy-migrations`: Deploys to staging/production
- `create-backup`: Creates schema backups before deployment

### 2. **Application Deployment** (`.github/workflows/deploy.yml`)

**Enhanced with database deployment:**

- Deploys database migrations before application deployment
- Ensures database schema is up-to-date before backend/frontend deployment

### 3. **Pull Request Checks** (`.github/workflows/pr-checks.yml`)

**Enhanced with database validation:**

- Automatically detects database changes in PRs
- Runs migration validation tests
- Prevents merging if database tests fail

## 🚀 Usage

### Automatic Triggers

**Pull Request Testing:**

```bash
# Any PR with changes to:
# - supabase/migrations/**
# - supabase/seed.sql
# - supabase/config.toml
# Will automatically trigger database validation
```

**Deployment:**

```bash
# Push to main branch automatically:
# 1. Validates migrations
# 2. Creates backup (for production)
# 3. Deploys migrations
# 4. Deploys application
```

### Manual Deployment

**Deploy to Staging:**

```bash
# Go to GitHub Actions → Database CI/CD → Run workflow
# Select: staging
```

**Deploy to Production:**

```bash
# Go to GitHub Actions → Database CI/CD → Run workflow
# Select: production
```

### Local Testing

**Test migrations locally:**

```bash
# Run the test script
./scripts/test-database-migrations.sh

# Or use act CLI (your preferred method)
act -j validate-migrations
```

**Manual testing:**

```bash
supabase start
supabase db reset --debug
supabase db dump --local -s public
supabase stop
```

## 🔐 Required Secrets & Variables

### GitHub Secrets

```
SUPABASE_ACCESS_TOKEN    # Personal access token from Supabase dashboard
SUPABASE_DB_PASSWORD     # Database password for postgres user
```

### GitHub Variables

```
SUPABASE_PROJECT_ID      # Your Supabase project reference ID
```

### How to Get These Values

**SUPABASE_ACCESS_TOKEN:**

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click your profile → Account Settings
3. Access Tokens → Generate new token
4. Copy token to GitHub Secrets

**SUPABASE_DB_PASSWORD:**

1. Go to your Supabase project dashboard
2. Settings → Database
3. Copy the database password (the one you set when creating the project)
4. Add to GitHub Secrets

**SUPABASE_PROJECT_ID:**

1. Go to your Supabase project dashboard
2. Settings → General
3. Copy "Reference ID"
4. Add to GitHub Variables

## 📊 What Gets Tested

### Migration Validation

- ✅ Full migration sequence from scratch
- ✅ Schema integrity after migrations
- ✅ Table creation and relationships
- ✅ Row Level Security policies
- ✅ Database functions and triggers
- ✅ Basic data validation

### Deployment Verification

- ✅ Successful migration deployment
- ✅ Schema inspection after deployment
- ✅ Database connectivity tests

### Backup Creation

- ✅ Schema backup before production changes
- ✅ Backup artifact storage (30-day retention)

## 🛠️ Migration Best Practices

### Safe Migration Patterns

```sql
-- ✅ Good: Backward compatible
ALTER TABLE users ADD COLUMN phone TEXT;

-- ✅ Good: With default values
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';

-- ⚠️ Careful: May break existing code
ALTER TABLE users DROP COLUMN email;

-- ⚠️ Careful: Data type changes
ALTER TABLE users ALTER COLUMN created_at TYPE timestamptz;
```

### Migration Naming

```bash
# Format: YYYYMMDDHHMMSS_descriptive_name.sql
20250915143000_add_user_phone_field.sql
20250915143001_update_user_permissions.sql
20250915143002_seed_new_roles.sql
```

### Testing Strategy

```bash
# 1. Test locally first
./scripts/test-database-migrations.sh

# 2. Create PR (triggers automatic testing)
git checkout -b feature/add-user-phone
git add supabase/migrations/
git commit -m "Add user phone field migration"
git push origin feature/add-user-phone

# 3. Merge after PR approval (triggers staging deployment)
# 4. Manual production deployment when ready
```

## 🚨 Troubleshooting

### Common Issues

**Migration fails in CI:**

```bash
# Check migration syntax locally
supabase db reset --debug

# Look for syntax errors or constraint violations
```

**Deployment fails:**

```bash
# Check if secrets/variables are set correctly
# Verify SUPABASE_PROJECT_ID matches your project
# Ensure SUPABASE_ACCESS_TOKEN has proper permissions
```

**Backup creation fails:**

```bash
# Usually due to permissions or project linking
# Verify Supabase CLI can connect to your project
```

### Recovery Procedures

**Rollback migration:**

```bash
# Manual rollback (if needed)
supabase db reset
# Then apply migrations up to the working point
```

**Restore from backup:**

```bash
# Download backup artifact from GitHub Actions
# Apply backup SQL file to database
psql $DATABASE_URL < backup_schema_YYYYMMDD_HHMMSS.sql
```

## 📈 Monitoring

### What to Watch

- ✅ Migration execution time
- ✅ Database schema drift
- ✅ Failed migration attempts
- ✅ Backup creation success

### GitHub Actions Artifacts

- Database backups (30-day retention)
- Migration logs
- Schema inspection reports

## 🔄 Workflow Evolution

### Current State

- ✅ Basic migration validation
- ✅ Automatic deployment to staging
- ✅ Manual production deployment
- ✅ Schema backups

### Future Enhancements

- 🔄 Automated rollback procedures
- 🔄 Performance regression testing
- 🔄 Schema drift detection
- 🔄 Multi-environment testing
- 🔄 Database performance monitoring
