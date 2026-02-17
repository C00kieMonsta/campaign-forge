import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { AuthenticatedRequest } from "@/shared/types/request.types";
import {
  auditContextStorage,
  extractAuditContextFromRequest
} from "./audit-context.provider";

/**
 * Middleware to capture and store audit context from incoming requests
 * This runs early in the request pipeline to ensure context is available
 * for all subsequent database operations
 */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Extract audit context from the request
    const auditContext = extractAuditContextFromRequest(
      req as AuthenticatedRequest
    );

    // Run the rest of the request processing with audit context
    auditContextStorage.run(auditContext, () => {
      next();
    });
  }
}
