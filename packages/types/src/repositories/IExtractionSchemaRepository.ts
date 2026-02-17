// src/persistence/IExtractionSchemaRepository.ts
import { CreateSchemaRequest } from "../dto/extraction-schemas";
import { ExtractionSchema } from "../entities/extraction_schema";

export interface CreateExtractionSchemaData extends CreateSchemaRequest {
  organizationId: string;
  schemaIdentifier: string;
  compiledJsonSchema: any;
}

export interface IExtractionSchemaRepository {
  findById(schemaId: string): Promise<ExtractionSchema | null>;
  findMany(organizationId: string): Promise<ExtractionSchema[]>;
  findByIdentifier(
    organizationId: string,
    schemaIdentifier: string
  ): Promise<ExtractionSchema[]>;
  create(data: CreateExtractionSchemaData): Promise<ExtractionSchema>;
  update(
    schemaId: string,
    data: Partial<ExtractionSchema>
  ): Promise<ExtractionSchema>;
  delete(schemaId: string): Promise<void>;
}
