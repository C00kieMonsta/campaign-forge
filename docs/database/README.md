# Database Setup and Schema

This directory contains the Prisma-powered database schema and configuration for the Material Extractor platform.

## 🏗️ Architecture Overview

The database uses **Prisma ORM** with PostgreSQL (hosted on Supabase) and follows a **phased approach** with a robust RBAC (Role-Based Access Control) system:

- **Phase I**: Core functionality (organizations, users, projects, data extraction) ✅
- **Phase II**: Sourcing & quoting (materials, suppliers, RFQs) 📋
- **Phase III**: Reporting (versioned reports and compliance) 📋

## 📁 Directory Structure

```
apps/backend/
├── prisma/
│   ├── schema.prisma           # Prisma schema definition
│   └── seed.ts                 # Database seeding script
├── .env                        # Environment variables (DATABASE_URL)
└── package.json               # Prisma scripts and dependencies

supabase/
├── config.toml                 # Supabase local development configuration
└── migrations/                 # Legacy migrations (removed)
```

## 🚀 Getting Started

### Prerequisites

1. **Supabase CLI**: Install the Supabase CLI

   ```bash
   npm install -g supabase
   ```

2. **Node.js 20.x** and **pnpm 8.x+**

3. **Docker**: Required for local Supabase development
   ```bash
   # macOS
   brew install docker
   # Or download from https://docker.com
   ```

### Local Development Setup

1. **Start Supabase locally**:

   ```bash
   cd /path/to/material-extractor
   supabase start
   ```

2. **Setup Prisma** (from backend directory):

   ```bash
   cd apps/backend

   # Install dependencies
   pnpm install

   # Generate Prisma client
   pnpm db:generate

   # Push schema to database
   pnpm db:push

   # Seed the database
   pnpm db:seed
   ```

3. **Access local services**:
   - **Database**: `postgresql://postgres:postgres@localhost:54322/postgres`
   - **API**: `http://localhost:54321`
   - **Studio**: `http://localhost:54323`
   - **Prisma Studio**: `pnpm db:studio`

### Available Database Commands

```bash
cd apps/backend

# Generate Prisma client (after schema changes)
pnpm db:generate

# Push schema to database (for development)
pnpm db:push

# Create and apply migrations (for production)
pnpm db:migrate

# Reset database with fresh schema
pnpm db:reset

# Seed database with initial data
pnpm db:seed

# Open Prisma Studio (database GUI)
pnpm db:studio
```

### Type Generation Commands

```bash
cd packages/utils

# Generate TypeScript types from production database
pnpm db:types

# Generate TypeScript types from local database
pnpm db:types:local

# Generate types and run type check
pnpm db:types:check
```

## 📊 Simplified Schema (Phase I)

### Core Tables

| Table                  | Purpose                       | Key Features              |
| ---------------------- | ----------------------------- | ------------------------- |
| `organizations`        | Multi-tenant organizations    | UUID, metadata            |
| `users`                | User profiles                 | Essential fields only     |
| `roles`                | **Simplified RBAC roles**     | System + custom roles     |
| `organization_members` | User-organization memberships | Single role per member    |
| `invitations`          | Pending organization invites  | Token-based system        |
| `clients`              | Customer/client records       | Simplified contact info   |
| `projects`             | Construction projects         | **Lightweight design**    |
| `data_layers`          | Ingested files (PDFs, emails) | File metadata             |
| `extraction_jobs`      | AI extraction processing jobs | **Embedded JSON results** |

### Key Simplifications

- **Simplified RBAC**: Removed permissions tables - roles now use simple conditional logic instead of complex permission mappings
- **Lightweight Projects**: Removed complex fields like `projectCode`, `startDate`, `endDate`, `budgetAmount`, `budgetCurrency`, and `settings`
- **Embedded Results**: Extraction results stored as JSON arrays within `extraction_jobs.results` instead of separate table
- **Type Safety**: Prisma generates TypeScript types automatically from the actual database schema
- **JSON Flexibility**: Using JSON fields for metadata and flexible data structures

## 🔐 Simplified RBAC System

### Default Roles

| Role       | Access Level        | Use Case              |
| ---------- | ------------------- | --------------------- |
| **Admin**  | Full system access  | System administrators |
| **Member** | Standard operations | Regular users         |

### Role-Based Conditional Logic

Instead of complex permission tables, the system uses simple role-based conditional logic:

```typescript
// Example: Simple role-based authorization
if (user.role.slug === "admin") {
  // Allow all operations
  return true;
} else if (user.role.slug === "member") {
  // Allow most operations except organization management
  return action !== "organization.edit";
}
```

### Type-Safe Database Access

```typescript
// Example: Type-safe project creation
const project = await prisma.project.create({
  data: {
    name: "New Project",
    organizationId: orgId,
    clientId: clientId,
    status: "active",
    meta: { customField: "value" }
  }
});

// Automatic TypeScript types
project.id; // string
project.name; // string
project.createdAt; // Date
project.meta; // Prisma.JsonValue
```

## 🔄 Schema Management

### Making Schema Changes

1. **Update schema**:

   ```bash
   # Edit apps/backend/prisma/schema.prisma
   vim apps/backend/prisma/schema.prisma
   ```

2. **Generate Prisma client**:

   ```bash
   cd apps/backend
   pnpm db:generate
   ```

3. **Apply changes** (development):

   ```bash
   pnpm db:push
   ```

4. **Generate TypeScript types**:

   ```bash
   cd packages/utils
   pnpm db:types  # From production
   # OR
   pnpm db:types:local  # From local database
   ```

5. **Create migration** (production):
   ```bash
   cd apps/backend
   pnpm db:migrate
   ```

### Migration Best Practices

- **Schema-first**: Define changes in `schema.prisma`
- **Generate Prisma client**: Always run `pnpm db:generate` after schema changes
- **Generate TypeScript types**: Run `pnpm --filter @packages/utils db:types` to auto-generate types from actual database
- **Test locally**: Use `pnpm db:push` for development
- **Version control**: Use `pnpm db:migrate` for production deployments
- **Seed data**: Keep `seed.ts` updated with essential data

## 📈 Performance Features

### Prisma Optimizations

- **Connection pooling**: Automatic connection management
- **Query optimization**: Optimized SQL generation
- **Type safety**: Compile-time query validation
- **Lazy loading**: Efficient relation loading
- **Caching**: Built-in query result caching

### Strategic Indexes

```prisma
// Example indexes in schema.prisma
model Organization {
  id   String @id @default(uuid())
  slug String @unique

  @@index([slug])
  @@index([createdAt])
}

model Project {
  organizationId String
  clientId       String
  status         String

  @@index([organizationId])
  @@index([clientId])
  @@index([status])
}
```

## 🧪 Testing with Prisma

### Database Testing

```typescript
// Example test with Prisma
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("Project Service", () => {
  beforeEach(async () => {
    // Clean test database
    await prisma.project.deleteMany();
    await prisma.client.deleteMany();
  });

  it("should create project", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        organizationId: "org-id",
        clientId: "client-id"
      }
    });

    expect(project.name).toBe("Test Project");
  });
});
```

## 🛡️ Security Features

### Application-Level Security

- **Type safety**: Prevents SQL injection through type-safe queries
- **Input validation**: Zod schemas validate all inputs
- **Centralized authorization**: Permission checking in service layer
- **Multi-tenancy**: Organization-based data isolation

### Example Security Pattern

```typescript
// Service layer with simplified role-based authorization
async createProject(userId: string, orgId: string, data: CreateProjectRequest) {
  // Get user's role in the organization
  const membership = await this.prisma.organizationMember.findFirst({
    where: { userId, organizationId: orgId },
    include: { role: true }
  });

  // Simple role-based check
  if (!membership || (membership.role.slug !== 'admin' && membership.role.slug !== 'member')) {
    throw new ForbiddenException('Insufficient permissions');
  }

  // Type-safe database operation
  return this.prisma.project.create({
    data: {
      ...data,
      organizationId: orgId
    }
  });
}
```

## 🔮 Future Phases

### Phase II - Sourcing & Quoting

Tables to be added:

- `materials` - Material glossary with normalization
- `suppliers` - Supplier directory and contact management
- `rfqs` - Request for quotes generation
- `supplier_quotes` - Quote collection and comparison

### Phase III - Reporting

Tables to be added:

- `reports` - Report metadata and versioning
- `report_versions` - Immutable report artifacts

## 🆘 Troubleshooting

### Common Issues

1. **Prisma client not generated**:

   ```bash
   cd apps/backend
   pnpm db:generate
   ```

2. **Schema out of sync**:

   ```bash
   pnpm db:push  # Development
   # OR
   pnpm db:migrate  # Production
   ```

3. **Database connection issues**:
   - Check `DATABASE_URL` in `.env`
   - Ensure Supabase is running (`supabase start`)
   - Verify connection string format

4. **Type errors after schema changes**:
   ```bash
   pnpm db:generate  # Regenerate Prisma client
   pnpm build        # Rebuild application
   ```

### Debugging Queries

```typescript
// Enable query logging
const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"]
});

// Use Prisma Studio for visual debugging
// pnpm db:studio
```

## 📚 Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)
- [Supabase with Prisma](https://supabase.com/docs/guides/integrations/prisma)
- [TypeScript with Prisma](https://www.prisma.io/docs/concepts/overview/prisma-in-your-stack/is-prisma-an-orm#type-safety)

---

## 🎯 Key Benefits of Prisma Migration

- **Type Safety**: End-to-end TypeScript with auto-generated types
- **Developer Experience**: Auto-completion, compile-time validation
- **Performance**: Optimized queries and connection pooling
- **Maintainability**: Schema-first approach with version control
- **Flexibility**: JSON fields for complex data structures
- **Consistency**: Single source of truth for data models
