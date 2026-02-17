// src/dto/projects.ts
import { z } from "zod";
import { Project, ProjectSchema } from "../entities/project";
import { ProjectStatus, Uuid } from "./primitives";

// ---- Location schema
export const LocationSchema = z
  .object({
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    coordinates: z
      .object({
        lat: z.number(),
        lng: z.number()
      })
      .optional()
  })
  .optional();

// ---- CreateProjectRequest
export const CreateProjectRequestSchema = z.object({
  clientId: Uuid,
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  location: LocationSchema.nullable()
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

// ---- UpdateProjectRequest
export const UpdateProjectRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: ProjectStatus.optional(),
  location: LocationSchema.nullable().optional()
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

// ---- ProjectListResponse
export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

// ---- Enhanced Project Schemas with Timeline Features
export const ProjectWithTimestampsSchema = ProjectSchema.extend({
  createdAt: z.date(),
  updatedAt: z.date(),
  // Add extraction date for timeline organization
  lastExtractionDate: z.date().nullable().optional()
});
export type ProjectWithTimestamps = z.infer<typeof ProjectWithTimestampsSchema>;

export const ProjectTimelineSchema = z.object({
  year: z.number(),
  month: z.number(),
  projects: z.array(ProjectWithTimestampsSchema),
  projectCount: z.number(),
  extractionCount: z.number().optional()
});
export type ProjectTimeline = z.infer<typeof ProjectTimelineSchema>;

export const ProjectTimelineResponseSchema = z.object({
  timeline: z.array(ProjectTimelineSchema),
  totalProjects: z.number(),
  dateRange: z.object({
    start: z.date(),
    end: z.date()
  })
});
export type ProjectTimelineResponse = z.infer<
  typeof ProjectTimelineResponseSchema
>;
