// src/dto/roles.ts
import { z } from "zod";
import { Role, RoleSchema } from "../entities/roles";

// ---- RoleListResponse
export const RoleListResponseSchema = z.object({
  roles: z.array(RoleSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;
