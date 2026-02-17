// src/persistence/IDataLayerRepository.ts
import { FileUploadRequest } from "../dto/files";
import { DataLayer } from "../entities/data_layer";

export interface CreateDataLayerData extends FileUploadRequest {
  organizationId: string;
  filePath: string;
  sourceType: string;
  sourceMetadata?: any;
  parentId?: string;
}

export interface IDataLayerRepository {
  getDataLayerById(dataLayerId: string): Promise<DataLayer | null>;
  getDataLayersByProject(projectId: string): Promise<DataLayer[]>;
  createDataLayer(data: CreateDataLayerData): Promise<DataLayer>;
  updateDataLayerProcessingStatus(
    dataLayerId: string,
    status: string,
    error?: string
  ): Promise<DataLayer>;
  deleteDataLayer(dataLayerId: string): Promise<void>;
}
