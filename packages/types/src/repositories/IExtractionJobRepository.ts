// src/persistence/IExtractionJobRepository.ts
import { StartExtractionJobRequest } from "../dto/extractions";
import { ExtractionJob } from "../entities/extraction_job";

export interface CreateExtractionJobData extends StartExtractionJobRequest {
  organizationId: string;
  initiatedBy: string;
  dataLayerIds?: string[];
  compiledJsonSchema?: any;
}

export interface IExtractionJobRepository {
  getExtractionJobById(jobId: string): Promise<ExtractionJob | null>;
  getExtractionJobsByProject(projectId: string): Promise<ExtractionJob[]>;
  getExtractionJobsByDataLayer(dataLayerId: string): Promise<ExtractionJob[]>;
  createExtractionJob(data: CreateExtractionJobData): Promise<ExtractionJob>;
  updateExtractionJobStatus(
    jobId: string,
    status: "queued" | "running" | "completed" | "failed" | "cancelled",
    progressPercentage?: number,
    errorMessage?: string,
    metadata?: unknown
  ): Promise<ExtractionJob>;
  appendJobLog(
    jobId: string,
    logEntry: {
      timestamp: string;
      level: "info" | "warn" | "error";
      message: string;
    }
  ): Promise<void>;
  addDataLayerToJob(
    jobId: string,
    dataLayerId: string,
    processingOrder: number
  ): Promise<void>;
  updateExtractionJobDataLayerStatus(
    jobId: string,
    dataLayerId: string,
    status: "pending" | "processing" | "completed" | "failed"
  ): Promise<void>;
  getExtractionJobDataLayers(jobId: string): Promise<any[]>;
  deleteExtractionJob(jobId: string): Promise<void>;
  searchExtractionResults(
    searchTerm: string,
    organizationId: string
  ): Promise<ExtractionJob[]>;
  getHighConfidenceExtractions(
    organizationId: string,
    minConfidence?: number
  ): Promise<ExtractionJob[]>;
  getExtractionJobsByConfidenceScore(
    minConfidence: number
  ): Promise<ExtractionJob[]>;
  getExtractionJobsByMaterialType(
    materialType: string
  ): Promise<ExtractionJob[]>;
}
