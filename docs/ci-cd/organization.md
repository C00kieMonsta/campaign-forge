# Workflow Organization Guide

This document explains the organization of GitHub Actions workflows in this repository.

⚠️ **Important**: GitHub Actions does NOT support nested folders within `.github/workflows/`. All workflow files must be placed directly in the root workflows directory.

## 📁 Directory Structure

```
.github/workflows/
├── ci-backend-test.yml       # Backend testing
├── ci-frontend-test.yml      # Frontend testing
├── ci-pr-checks.yml          # Pull request validation
├── ci-utils-test.yml         # Utils package testing
├── cd-database-ci.yml        # Database migrations
├── cd-deploy.yml             # Application deployment
├── cd-release.yml            # Release management
└── security-basic.yml        # Basic security scanning
```

## 🏷️ Naming Convention

We use a **prefix-based naming convention** to organize workflows since GitHub Actions doesn't support nested folders:

- **`ci-*`**: Continuous Integration workflows (testing, validation)
- **`cd-*`**: Continuous Deployment workflows (deployment, releases)
- **`security-*`**: Security scanning workflows

## 🎯 Organization Benefits

### **Previous Attempt (Nested Folders):**

- ❌ Used nested folders (ci/, cd/, security/)
- ❌ **GitHub Actions doesn't support this!**
- ❌ Workflows wouldn't run properly
- ❌ Caused confusion and maintenance issues

### **Current Approach (Prefix-Based):**

- ✅ **GitHub Actions compatible** - all files in root directory
- ✅ **Logical grouping** by prefix (ci-, cd-, security-)
- ✅ **Easy to find** workflows by category
- ✅ **Clear separation** of concerns
- ✅ **Maintainable** and scalable structure

## 🔍 Finding Workflows

### **For CI/Testing:**

Look for `ci-*` prefixed files:

- `ci-backend-test.yml` - Backend testing
- `ci-frontend-test.yml` - Frontend testing
- `ci-pr-checks.yml` - Pull request validation
- `ci-utils-test.yml` - Utils package testing

### **For Deployment:**

Look for `cd-*` prefixed files:

- `cd-database-ci.yml` - Database migrations
- `cd-deploy.yml` - Application deployment
- `cd-release.yml` - Release management

### **For Security:**

Look for `security-*` prefixed files:

- `security-basic.yml` - Basic vulnerability scanning

## 📋 Best Practices

### **Naming Convention:**

- Use descriptive names
- Include purpose in filename
- Use kebab-case (hyphen-separated)

### **File Organization:**

- Group by primary function
- Keep related workflows together
- Separate CI from CD concerns

### **Documentation:**

- Update README.md when adding workflows
- Document triggers and purpose
- Explain any complex logic

## 🔄 Migration Notes

This organization was corrected on 2025-08-31 to fix GitHub Actions compatibility issues. The previous nested folder structure was not supported by GitHub Actions and has been replaced with a prefix-based naming convention.

### **GitHub Actions Compatibility:**

- ✅ All workflow files now in root `.github/workflows/` directory
- ✅ GitHub Actions can properly detect and run all workflows
- ✅ No changes needed to workflow contents themselves
- ✅ Existing workflow runs and history preserved
- ✅ Workflows will now actually execute (previously they were ignored!)

### **Development Workflow:**

- ✅ `act` CLI works with flat file structure
- ✅ Workflow dispatch still available
- ✅ All existing functionality preserved
- ✅ **Workflows now actually run properly!**
