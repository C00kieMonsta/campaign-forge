import { z } from "zod";
import { ProjectStatus, Uuid } from "./primitives";

// ---- Project (entity schema) - matches Prisma output (camelCase)
export const ProjectSchema = z.object({
  id: Uuid,
  organizationId: Uuid,
  clientId: Uuid,
  name: z.string(),
  description: z.string().nullable(),
  status: ProjectStatus,
  location: z.unknown().nullable(), // JsonValue from Prisma
  meta: z.unknown(), // JsonValue from Prisma
  createdAt: z.date(),
  updatedAt: z.date(),
  // Include client relation when fetched from API
  client: z
    .object({
      id: z.string(),
      name: z.string()
    })
    .optional()
});
export type Project = z.infer<typeof ProjectSchema>;
