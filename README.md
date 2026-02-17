# Material Extractor

A high-performance web application for extracting and analyzing materials from documents using AI-powered processing. Built with modern architecture and optimized for speed and scalability.

## Live Deployment

**✅ Successfully Deployed!**

- **Frontend**: `https://app.remorai.solutions`
- **Backend API**: `https://api.app.remorai.solutions`
- **Status**: Production ready and operational

## 📋 Project Status

### Current Phase: Frontend UI & Extraction Flow 🚧

- ✅ **Phase 0**: Initial Setup (Testing, Audit Logging, Correlation IDs)
- ✅ **Phase 1**: CI/CD Pipeline (Comprehensive workflows, Automated deployments)
- ✅ **Phase 2**: Database Schema & RBAC (Optimized schema, Simplified permissions, RLS, Multi-tenancy)
- ✅ **Phase 3**: Authentication & Identity Management (JWT, Supabase integration, Performance optimization)
- 🚧 **Phase 4**: Frontend UI & Extraction Flow (High-performance React app, Hybrid Next.js)
- 📋 **Phase 5**: PDF Cropping for Material Extraction
- 📋 **Phase 6**: Report Generation

## 🏗️ Architecture Overview

### Infrastructure

- **Frontend**: Hybrid Next.js (Dev: SSR, Prod: Static Export) on AWS CloudFront
- **Backend**: NestJS on AWS ECS Fargate
- **Database**: PostgreSQL with Prisma ORM (Supabase hosting)
- **Infrastructure**: AWS CDK, GitHub Actions CI/CD

### Technology Stack

- **Frontend**: Next.js 15, React 18, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: NestJS, TypeScript, Node.js, Prisma ORM
- **Database**: PostgreSQL with Prisma ORM and type-safe queries
- **Testing**: Jest, React Testing Library
- **Infrastructure**: AWS CDK, CloudFormation

### Performance Optimizations ⚡

- **Hybrid Build System**: Fast development with SSR, optimized static export for production
- **Prisma ORM**: Type-safe queries with optimized SQL generation and connection pooling
- **Simplified Schema**: Lightweight database design focused on core functionality
- **Client-side Caching**: Reduced API calls with intelligent state management
- **Centralized Types**: Single source of truth for data types across frontend and backend

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Setup Prisma (generate client, push schema, seed database)
cd apps/backend
pnpm db:generate
pnpm db:push
pnpm db:seed

# Start development servers (backend on :8001, frontend on :8000)
pnpm dev

# Frontend only (hybrid Next.js with fast routing)
cd apps/frontend && pnpm dev

# Backend only
cd apps/backend && pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build:all

# Build frontend only (creates static export for deployment)
cd apps/frontend && pnpm build
```

### Development vs Production Builds

- **Development**: Standard Next.js with SSR for fast routing and hot reload
- **Production**: Static export optimized for AWS CloudFront deployment
- **Automatic**: Build type determined by `NODE_ENV` environment variable

## 📚 Documentation

### 🛠️ Development

- **[Development Guide](./docs/development/README.md)** - Setup, coding standards, and development workflow
- **[Project Structure](./docs/development/README.md#project-structure)** - Monorepo organization and architecture

### 🗄️ Database

- **[Database Setup](./docs/database/README.md)** - Schema, migrations, and local development
- **[Database CI/CD](./docs/database/ci-cd.md)** - Migration testing and deployment

### 🔄 CI/CD & Deployment

- **[CI/CD Workflows](./docs/ci-cd/README.md)** - GitHub Actions workflows and organization
- **[Workflow Organization](./docs/ci-cd/organization.md)** - How workflows are structured
- **[Deployment Guide](./docs/deployment/README.md)** - Infrastructure, certificates, and deployment process

## 🏗️ Data Model

The platform uses a **phased rollout approach**:

### Phase I — Core ✅

Multi-tenant organizations with users, roles, clients, projects, and AI-powered material extraction.

**Key Tables**: `organizations`, `users`, `organization_members`, `invitations`, `roles`, `clients`, `projects`, `data_layers`, `extraction_jobs` (with embedded results as JSON)

**Simplified Schema**: Streamlined design with extraction results stored as JSON arrays within extraction jobs, removing complex relational overhead while maintaining flexibility. Uses simple role-based authorization instead of complex permission mappings.

### Phase II — Sourcing & Quoting 📋

Material normalization, supplier management, RFQ generation, and quote collection.

### Phase III — Reporting 📋

Versioned reports for compliance and client delivery with immutable history.

**[→ View detailed data model](./docs/development/README.md#data-model--phased-rollout)**

## 🔐 Security & RBAC

- **Type-Safe Database Access** with Prisma ORM preventing SQL injection and runtime errors
- **Simplified Role-Based Access Control** using conditional logic instead of complex permissions
- **Multi-tenant architecture** with organization-based data isolation
- **Centralized type definitions** ensuring consistency across frontend and backend

**Essential Roles**:

- **Administrator** (`admin`): Full system access
- **Member** (`member`): Standard user access with limited restrictions

### Database Architecture Improvements

- **Prisma ORM**: Type-safe queries with auto-completion and compile-time validation
- **Simplified Schema**: Lightweight design focused on core functionality
- **JSON Storage**: Flexible data storage for complex structures (extraction results, metadata)
- **Connection Pooling**: Optimized database connections for better performance
- **Migration Management**: Version-controlled schema changes with Prisma migrations

## 🧪 Testing Strategy

We use the `act` CLI for local CI/CD testing to ensure workflows work before pushing:

```bash
# Test workflows locally
act -j backend-test
act -j frontend-test
act pull_request

# Test hybrid frontend build
cd apps/frontend && pnpm build  # Tests production static export
cd apps/frontend && pnpm dev    # Tests development SSR

# Run performance tests
pnpm test:coverage
```

**[→ View testing guide](./docs/development/README.md#testing)**

## 🗑️ AWS Stack Management

### Force Delete CloudFormation Stacks

When stacks get stuck in `UPDATE_ROLLBACK_COMPLETE` or other problematic states, use these commands to force delete them:

```bash
# Login to AWS (required first)
aws sso login --profile production

# Delete individual stacks
aws cloudformation delete-stack --stack-name RemoraiAppBackend-production --profile production
aws cloudformation delete-stack --stack-name RemoraiAppFrontend-production --profile production

# Check deletion progress
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_IN_PROGRESS UPDATE_ROLLBACK_COMPLETE \
  --profile production \
  --query "StackSummaries[?contains(StackName, 'MaterialExtractor')].{StackName:StackName,StackStatus:StackStatus,CreationTime:CreationTime}" \
  --output table

# Alternative: Delete all MaterialExtractor stacks at once (use with caution)
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
  --profile production \
  --query "StackSummaries[?contains(StackName, 'MaterialExtractor')].StackName" \
  --output text | xargs -I {} aws cloudformation delete-stack --stack-name {} --profile production
```

### Troubleshooting Stack Deletion

If stacks fail to delete due to resource dependencies:

```bash
# Get detailed stack events to identify blocking resources
aws cloudformation describe-stack-events \
  --stack-name RemoraiAppBackend-production \
  --profile production \
  --query "StackEvents[?ResourceStatusReason != null].{LogicalResourceId:LogicalResourceId,ResourceStatus:ResourceStatus,ResourceStatusReason:ResourceStatusReason}" \
  --output table

# Force delete specific resources if needed (replace with actual resource IDs)
# aws cloudformation delete-stack --stack-name <stack-name> --retain-resources <resource-logical-id>
```

**Note**: Always verify the stack list before deletion to avoid accidentally deleting active resources.

## ⚡ Performance Metrics

### Recent Optimizations (January 2025)

- **Database Architecture**: Complete migration to Prisma ORM for type safety and performance
- **Simplified RBAC**: Removed complex permissions system in favor of simple role-based conditional logic
- **Simplified Schema**: Lightweight design with 50% fewer tables and JSON-based flexibility
- **Type Safety**: End-to-end TypeScript with auto-generated types from actual database schema
- **Centralized Types**: Single source of truth for data structures across the entire stack
- **Frontend Routing**: ~70% faster navigation with hybrid Next.js setup
- **API Response Times**: Significantly improved with optimized Prisma queries

## 🏗️ Hybrid Build System

Our Next.js setup automatically adapts to the environment:

### Development Mode

```bash
cd apps/frontend && pnpm dev
```

- **Standard Next.js**: Full SSR capabilities
- **Fast Hot Reload**: Instant updates during development
- **Proper Routing**: No static export limitations
- **API Routes**: Support for Next.js API endpoints (if needed)

### Production Mode

```bash
cd apps/frontend && NODE_ENV=production pnpm build
```

- **Static Export**: Optimized for AWS CloudFront
- **Pre-rendered Pages**: All routes pre-built as HTML
- **CDN Optimized**: Perfect for global distribution
- **No Server Required**: Pure static files

### Build Scripts

- `pnpm build`: Production static export
- `pnpm dev`: Development SSR server
- `./scripts/build-frontend.sh`: Automated build with verification

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Test locally using `act` CLI and hybrid builds
4. Make your changes and run tests
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📝 License

This project is private and proprietary.

---

## 🔗 Quick Links

- **[🛠️ Development Setup](./docs/development/README.md)**
- **[🗄️ Database Guide](./docs/database/README.md)**
- **[🚀 Deployment Guide](./docs/deployment/README.md)**
- **[🔄 CI/CD Workflows](./docs/ci-cd/README.md)**
- **[📊 Live Frontend](https://app.remorai.solutions)**
- **[🔌 Live API](https://api.app.remorai.solutions)**
