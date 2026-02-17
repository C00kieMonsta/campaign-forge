# Audit Logging System - Phase 2

## Overview

The audit logging system automatically captures database operations (create, update, delete, upsert) for compliance and debugging purposes.

## Current Implementation (Phase 2)

### Features

- ✅ Automatic capture of all mutating database operations
- ✅ Stores before/after states for updates and deletes
- ✅ Captures actor information when user context is available
- ✅ Prevents infinite recursion by skipping AuditLog operations
- ✅ Graceful failure - audit failures don't break main operations

### Files Created

- `prisma-audit.middleware.ts` - Core audit middleware
- `audit-utils.ts` - Utility functions for querying audit logs
- `prisma-audit.middleware.spec.ts` - Basic tests

### Database Table

The `audit_logs` table captures:

- `actor_user_id`, `actor_org_id`, `actor_email` - Who performed the action
- `target_table`, `target_id` - What was modified
- `action` - create/update/delete/upsert
- `before`, `after` - JSON snapshots of the data
- `correlation_id`, `ip_address`, `user_agent` - Request context

### Current Limitations

- No user context capture yet (returns empty context)
- No integration with existing audit logger
- No performance optimizations

## Testing

```bash
# Build to verify compilation
pnpm build

# Run tests
pnpm test prisma-audit.middleware.spec.ts
```

## Query Examples

```typescript
// Get audit history for a specific record
const auditLogs = await getAuditLogsForRecord(prisma, "Project", "project-id");

// Get organization audit activity
const orgAudit = await getAuditLogsForOrganization(prisma, "org-id");

// Get audit statistics
const stats = await getAuditStats(prisma, "org-id", 30);
```

## Next Steps (Phase 3)

- Integrate with request context to capture user information
- Connect with existing AuditLogger service
- Add request metadata (IP, user agent, correlation ID)
