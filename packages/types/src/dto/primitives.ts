// src/dto/primitives.ts
import { z } from "zod";
// ---- Project Status Enum
// Import constants from constants package to avoid duplication
import { RESOURCE_STATUSES_VALUES } from "../constants";

// ---- Shared primitive schemas ----
export const Uuid = z.string().uuid();
export const Email = z.string().email();
export const IsoDateString = z
  .string()
  .datetime({ offset: true })
  .or(z.string());
export const Slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/);

export const ProjectStatus = z.enum(RESOURCE_STATUSES_VALUES);
export type ProjectStatusType = z.infer<typeof ProjectStatus>;

// ---- Common type aliases ----
export type Uuid = z.infer<typeof Uuid>;
export type Email = z.infer<typeof Email>;
export type IsoDateString = z.infer<typeof IsoDateString>;
export type Slug = z.infer<typeof Slug>;
