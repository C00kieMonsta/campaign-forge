# Development Guide

This guide covers the development setup, practices, and workflows for the Material Extractor platform.

## 🛠️ Development Setup

### Prerequisites

- Node.js 20.x
- pnpm 8.x+
- Supabase CLI
- AWS CLI configured (optional for local development)
- Docker (for local development)

### Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd material-extractor

# Install dependencies
pnpm install

# Setup Prisma (generate client, push schema, seed database)
cd apps/backend
pnpm db:generate
pnpm db:push
pnpm db:seed
cd ../..

# Build all packages
pnpm build:all

# Run tests
pnpm test

# Start development servers
pnpm dev
```

### Project Structure

```
material-extractor/
├── apps/
│   ├── backend/          # NestJS API server
│   └── frontend/         # Next.js web application
├── packages/
│   └── utils/            # Shared utilities
├── infrastructure/       # AWS CDK infrastructure code
└── .github/workflows/    # CI/CD workflows
```

### Available Scripts

- `pnpm dev` - Start development servers
- `pnpm build:all` - Build all applications
- `pnpm test` - Run all tests
- `pnpm lint` - Run linting
- `pnpm type-check` - Run TypeScript type checking

### Database Scripts (Backend)

- `pnpm db:generate` - Generate Prisma client
- `pnpm db:push` - Push schema to database
- `pnpm db:migrate` - Create and apply migrations
- `pnpm db:reset` - Reset database with fresh schema
- `pnpm db:seed` - Seed database with initial data
- `pnpm db:studio` - Open Prisma Studio

## 🏗️ Data Model & Phased Rollout

This document describes the database schema for our Prisma-powered platform with PostgreSQL (hosted on Supabase).
We follow a **phased approach**: start with the bare minimum, layer in sourcing/quoting, then add reporting.

## Phase I — Core (bare minimum) ✅

**Goal:**

- Multi-tenant orgs with users, roles, and invitations
- Clients & projects per org
- Inbound data ingestion (PDF/email)
- Extraction jobs + results
- Auditing of business events

### Tables (Simplified Schema)

- **organizations** → each company using the platform
- **users** → user profiles with essential information
- **organization_members** → membership of a user in an org (`role_id`)
- **invitations** → pending invites to join an org (status + token)
- **roles** → simplified RBAC system (no permissions tables)
- **clients** → per org, represent customers/end-clients
- **projects** → per org+client, simplified construction projects
- **data_layers** → ingested PDFs/emails, linked to project
- **extraction_jobs** → async runs on a data_layer with embedded results as JSON

**Key Simplifications:**

- **Simplified RBAC**: Removed permissions tables - roles now use simple conditional logic
- **Embedded Results**: Extraction results stored as JSON arrays within `extraction_jobs.results`
- **Lightweight Projects**: Removed complex fields like budget tracking, dates, and settings
- **JSON Flexibility**: Using JSON fields for metadata and flexible data structures

### Access & Permissions

- Users are linked to orgs via `organization_members`
- Each membership has a **role_id**, pointing to a role (e.g., admin, member)
- **Simple role-based authorization** using conditional logic instead of complex permission mappings
- **Type-safe queries** with Prisma prevent SQL injection and runtime errors
- **Application-level authorization** with centralized role checking

## Phase II — Sourcing & Quoting 📋

**Goal:**

- Normalize materials
- Manage supplier directory
- Generate RFQs from extracted data
- Collect supplier quotes

### Tables

- **materials** → org glossary of canonical material names, specs, synonyms
- **suppliers** → directory of suppliers (contact info, tags)
- **rfqs** → request for quotes per project
- **rfq_line_items** → requested items (linked to extraction results or free-typed)
- **rfq_suppliers** → distribution of an RFQ to suppliers
- **supplier_quotes** → quotes from suppliers (currency, terms, validity)
- **supplier_quote_items** → line-level quotes (price, lead time, MOQ)

## Phase III — Reporting 📋

**Goal:**

- Create versioned reports for compliance and client delivery
- Immutable history of report versions

### Tables

- **reports** → top-level report record (project, title, status, current_version)
- **report_versions** → versioned artifacts (file path, input snapshot, notes, published/draft)

## Simplified RBAC Model (applies across phases)

- **roles**: system roles like `admin`, `member` with simple conditional logic
- **organization_members.role_id**: each user has one role per org
- Helper: `checkRole(role_slug, org_id)` checks if current user has the required role

**Best practice:**

- One role per member per org (simple mental model)
- Use **role-based conditional logic** instead of complex permission mappings
- Keep role set minimal: admin (full access) and member (standard access)

## Audit Log

- **audit_log** is append-only
- Captures: `at, actor_user_id, organization_id, entity_type, entity_id, action, changes(before/after), request_id, ctx(jsonb)`
- Indexed by `organization_id, at`
- Growth managed by partitioning or archiving

## Phase Rollout

1. **Phase I** ✅:
   - Create orgs, invite users, manage clients/projects
   - Upload data (PDF/email), run extraction jobs, review results
   - Audit everything
   - Simple role-based authorization controls access to features

2. **Phase II** 📋:
   - Org glossary of materials/suppliers
   - Generate RFQs from extracted results
   - Manage supplier distribution + track quotes
   - Compare offers by price/lead time

3. **Phase III** 📋:
   - Generate reports from project/RFQ/quote data
   - Store as immutable, versioned artifacts
   - Publish versions to clients with traceable snapshots

## Development Practices

- **Prisma-first**: all schema changes in `apps/backend/prisma/schema.prisma`
- **Type safety**: Prisma generates TypeScript types from the database schema
- **Centralized types**: Shared types in `@packages/utils` for consistency
- **JSON for flexibility**: keep `meta`/`results` extensible without schema churn
- **UUIDs everywhere** for PKs
- **Timestamps** with automatic `@default(now())` and `@updatedAt`
- **Migration management**: Version-controlled schema changes with Prisma migrations

## 🧪 Testing

### Local Testing Strategy

We use the `act` CLI for local testing of GitHub Actions workflows, as this is your preferred method. This allows us to test CI/CD workflows locally before pushing changes.

```bash
# Test specific workflow
act -j backend-test

# Test with specific event
act push

# Test pull request workflow
act pull_request
```

### Testing Best Practices

1. **Always test locally first** using `act` CLI
2. **Anticipate potential pitfalls** and edge cases
3. **Avoid overly confident assumptions** about code behavior
4. **Test database migrations** thoroughly before deployment
5. **Validate CI/CD workflows** locally before pushing

### Database Testing

```bash
# Test database migrations locally
./scripts/test-database-migrations.sh

# Or use act for database CI workflow
act -j validate-migrations
```

## 🔧 Code Style and Standards

### Performance and Maintainability

- **Avoid overhead**: No unnecessary memory allocations, event listeners, or recursive calls
- **Readable and maintainable**: Someone else (or future you) should easily follow the logic
- **Lean code**: Prefer built-in methods and idiomatic constructs over verbose alternatives

### Code Style Rules

- **DRY (Don't Repeat Yourself)**: Abstract repeated logic into functions or constants
- **Short functions**: Prefer smaller, focused functions over long procedural blocks
- **Single responsibility**: One function/module = one clear job
- **Guard clauses**: Use early returns to reduce nesting and improve readability

### Comments & Documentation

- **Short and clear**: Comments should be concise, helpful, and only where necessary
- **No redundant comments**: Avoid restating what the code already makes obvious
- **Explain intent, not syntax**: Focus on why, not how

### General Principles

- **No shortcuts**: Always implement complete logic; don't skip necessary steps for brevity
- **Prioritize reuse**: Use existing variables, functions, and utilities when possible
- **Avoid bloat**: Do not introduce unnecessary abstractions, wrappers, or boilerplate
- **Keep it clean**: Structure code clearly with consistent formatting and meaningful naming
- **Minimize dependencies**: Only import what's needed—don't over-engineer
- **Clean up unused resources**: After running tests or creating Docker containers and other temporary assets, remove them promptly to avoid clutter and hidden costs
- **Aim for clean solutions**: Before suggesting a change, ensure it's maintainable and not just a hack; if it's a workaround, make that explicit and outline the path to a proper fix

## 🔄 Development Workflow

### Branch Strategy

- **main**: Production-ready code
- **develop**: Integration branch for features
- **feature/\***: Feature development branches
- **hotfix/\***: Emergency fixes for production

### Commit Guidelines

- Use conventional commits for better release notes
- Keep commits focused and atomic
- Write descriptive commit messages

### Pull Request Process

1. Create feature branch from develop
2. Implement changes with tests
3. Test locally using `act` CLI
4. Create pull request with clear description
5. Address review feedback
6. Merge after approval and passing CI

## 📚 Additional Resources

For more detailed information, see the specialized documentation:

- [Database Setup Guide](../database/README.md)
- [CI/CD Workflows](../ci-cd/README.md)
- [Deployment Guide](../deployment/README.md)

👉 This development setup gives you:

- A **minimum usable platform** in Phase I
- A clear path to handle **sourcing/quoting** in Phase II
- A clean extension to **reporting/compliance** in Phase III
- RBAC + auditing baked in from day 1
