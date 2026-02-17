// Shared types for NestJS request objects
import type { Request as ExpressRequest } from "express";
import { AuthenticatedUser } from "@packages/types";

export interface AuthenticatedRequest extends ExpressRequest {
  user?: AuthenticatedUser;
}

