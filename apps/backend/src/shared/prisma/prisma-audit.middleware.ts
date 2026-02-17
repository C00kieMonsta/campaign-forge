import { AuditContext } from "@packages/types";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  DEFAULT_AUDIT_CONFIG,
  isLightweightTable,
  sanitizeAuditData,
  shouldAuditTable,
  type AuditConfig
} from "./audit-config";

export function attachAuditMiddleware(
  prisma: PrismaClient,
  getContext: () => AuditContext,
  config: AuditConfig = DEFAULT_AUDIT_CONFIG
) {
  prisma.$use(
    async (
      params: Prisma.MiddlewareParams,
      next: (params: Prisma.MiddlewareParams) => Promise<unknown>
    ) => {
      const mutatingActions = ["create", "update", "delete", "upsert"];
      if (!mutatingActions.includes(params.action)) {
        return next(params);
      }

      const model = params.model;
      if (!model || !shouldAuditTable(model, config)) {
        return next(params);
      }

      const context = getContext();
      const result = await next(params);

      // Extract target ID from result or params
      let targetId: string | null = null;
      if (result && typeof result === "object" && "id" in result) {
        targetId = String((result as Record<string, unknown>).id);
      }

      // For deletes, try to extract from where clause
      if (params.action === "delete" && params.args?.where) {
        const where = params.args.where as Record<string, unknown>;
        if (where.id) {
          targetId = String(where.id);
        }
      }

      // Sanitize data for lightweight tables (skip before/after)
      const isLightweight = isLightweightTable(model, config);
      const after =
        params.action === "delete"
          ? null
          : isLightweight
            ? null
            : sanitizeAuditData(result, model, config);

      const auditData: Prisma.AuditLogCreateInput = {
        actorUserId: context.user?.id ?? null,
        actorOrgId: context.user?.organizationId ?? null,
        actorEmail: context.user?.email ?? null,
        targetTable: model,
        targetId,
        action: params.action,
        after: after === null ? undefined : (after as Prisma.InputJsonValue),
        correlationId: context.correlationId ?? null,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null
      };

      // Log asynchronously (don't block the operation)
      setImmediate(async () => {
        try {
          const auditClient = prisma as PrismaClient & {
            auditLog: Prisma.AuditLogDelegate;
          };
          await auditClient.auditLog.create({
            data: auditData
          });
        } catch (error) {
          console.error(
            JSON.stringify({
              level: "error",
              action: "auditLogFailed",
              model,
              error: error instanceof Error ? error.message : "Unknown error"
            })
          );
        }
      });

      return result;
    }
  );
}

/**
 * Simple context provider that returns empty context
 * This will be replaced in Phase 3 with proper request context
 */
export function createSimpleContextProvider(): () => AuditContext {
  return () => ({});
}
