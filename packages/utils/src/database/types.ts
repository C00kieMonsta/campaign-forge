// JSON type for Prisma JsonValue compatibility
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// NOTE: Supabase Database types removed - this project uses Prisma exclusively
// If Supabase types are needed, regenerate them from the Supabase schema

// Enums from Prisma schema
export type ProjectStatus =
  | "active"
  | "completed"
  | "cancelled"
  | "on_hold"
  | "archived"
  | "deleted";
export type ExtractionResultStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "edited";

// Prisma-compatible types (camelCase field names to match backend expectations)
// These types mirror what Prisma generates but are defined manually to avoid circular dependencies

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  meta: Json;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  roles?: Role[];
  members?: OrganizationMember[];
  invitations?: Invitation[];
  clients?: Client[];
  projects?: Project[];
  dataLayers?: DataLayer[];
  extractionJobs?: ExtractionJob[];
  extractionSchemas?: ExtractionSchema[];
  suppliers?: Supplier[];
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  phone: string | null;
  timezone: string;
  meta: Json;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  organizationMemberships?: OrganizationMember[];
  sentInvitations?: Invitation[];
  acceptedInvitations?: Invitation[];
  initiatedExtractionJobs?: ExtractionJob[];
  editedExtractionResults?: ExtractionResult[];
  verifiedExtractionResults?: ExtractionResult[];
  selectedSupplierMatches?: SupplierMatch[];
}

export interface Client {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: Json | null;
  meta: Json;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  organization?: Organization;
  projects?: Project[];
}

export interface Supplier {
  id: string;
  organizationId: string;
  name: string;
  contactName: string | null;
  contactEmail: string;
  contactPhone: string | null;
  address: Json | null;
  materialsOffered: Json; // Array of materials
  meta: Json;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  organization?: Organization;
  matches?: SupplierMatch[];
}

export interface SupplierMatch {
  id: string;
  extractionResultId: string;
  supplierId: string;
  confidenceScore: number | null;
  matchReason: string | null;
  matchMetadata: Json;
  isSelected: boolean;
  selectedBy: string | null;
  selectedAt: Date | null;
  emailSent: boolean;
  emailSentAt: Date | null;
  meta: Json;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  extractionResult?: ExtractionResult;
  supplier?: Supplier;
  selector?: User;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  invitedBy: string;
  token: string;
  status: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  organization?: Organization;
  role?: Role;
  inviter?: User;
  accepter?: User;
}

export interface Project {
  id: string;
  organizationId: string;
  clientId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  location: Json | null;
  meta: Json;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  client?: Client;
  organization?: Organization;
  dataLayers?: DataLayer[];
}

export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  organization?: Organization;
  members?: OrganizationMember[];
  invitations?: Invitation[];
}

export interface DataLayer {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description: string | null;
  fileType: string;
  filePath: string;
  fileSize: bigint | null;
  fileHash: string | null;
  sourceType: string;
  sourceMetadata: Json;
  processingStatus: string;
  processingError: string | null;
  processedAt: Date | null;
  parentId: string | null;
  meta: Json;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  organization?: Organization;
  project?: Project;
  parent?: DataLayer;
  children?: DataLayer[];
  extractionJobDataLayers?: ExtractionJobDataLayer[];
}

export interface ExtractionJob {
  id: string;
  organizationId: string;
  initiatedBy: string;
  jobType: string;
  status: string;
  progressPercentage: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  config: Json;
  schemaId: string;
  compiledJsonSchema: Json; // Compiled JSON schema from the referenced schema
  meta: Json;
  logs: Json; // Array of log messages with timestamps for real-time feedback
  createdAt: Date;
  updatedAt: Date;
  // Relations
  organization?: Organization;
  initiator?: User;
  schema?: ExtractionSchema;
  extractionResults?: ExtractionResult[];
  extractionJobDataLayers?: ExtractionJobDataLayer[];
}

export interface ExtractionSchema {
  id: string;
  organizationId: string;
  name: string;
  version: number;
  definition: Json;
  compiledJsonSchema: Json;
  prompt?: string | null;
  examples?: Json | null;
  createdAt: Date;
  // Relations
  organization?: Organization;
  extractionJobs?: ExtractionJob[];
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  roleId: string;
  status: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  user?: User;
  role?: Role;
}

// Enhanced ExtractionResult with evidence and human verification
export interface ExtractionResult {
  id: string;
  extractionJobId: string;
  // Raw AI extraction data (never modified after creation)
  rawExtraction: Json;
  // Evidence of where the data came from
  evidence: Json;
  // Human-verified version (starts as copy of rawExtraction, can be edited)
  verifiedData: Json | null;
  // Metadata fields for performance and querying
  status: ExtractionResultStatus;
  confidenceScore: number | null;
  pageNumber: number | null;
  locationInDoc: string | null;
  // Extracted key fields for indexing and quick access (from verifiedData if available, else rawExtraction)
  itemCode: string | null;
  itemName: string | null;
  quantity: number | null;
  unit: string | null;
  // Human verification tracking
  verifiedBy: string | null;
  verifiedAt: Date | null;
  verificationNotes: string | null;
  // Audit fields
  editedBy: string | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  extractionJob?: ExtractionJob;
  editor?: User;
  verifier?: User;
  supplierMatches?: SupplierMatch[];
}

export interface ExtractionJobDataLayer {
  id: string;
  extractionJobId: string;
  dataLayerId: string;
  processingOrder: number;
  status: string;
  createdAt: Date;
  // Relations
  extractionJob?: ExtractionJob;
  dataLayer?: DataLayer;
}
