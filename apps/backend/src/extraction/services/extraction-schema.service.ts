import { Injectable, Logger } from "@nestjs/common";
import {
  AgentDefinition,
  CompiledSchema,
  ExtractionSchema,
  JsonSchemaDefinition,
  UpdateSchemaRequest,
  ValidationResultUnion
} from "@packages/types";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { SchemaCompilerService } from "./schema-compiler.service";

@Injectable()
export class ExtractionSchemaService {
  private readonly logger = new Logger(ExtractionSchemaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly compiler: SchemaCompilerService
  ) {}

  /**
   * Generates a unique 12-character alphanumeric identifier
   */
  private generateSchemaIdentifier(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Ensures the generated identifier is unique within the organization
   */
  private async ensureUniqueIdentifier(
    organizationId: string
  ): Promise<string> {
    let identifier: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      identifier = this.generateSchemaIdentifier();
      // Use raw query to avoid type mismatch if Prisma types are stale
      const rows = await this.prisma.client.$queryRaw<
        Array<{ exists: boolean }>
      >`
        SELECT true as exists
        FROM "extraction_schemas"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "schema_identifier" = ${identifier}
        LIMIT 1
      `;
      const exists = rows.length > 0;
      if (!exists) return identifier;

      attempts++;
    } while (attempts < maxAttempts);

    throw new Error("Failed to generate unique schema identifier");
  }

  /**
   * Retrieves and compiles a schema by ID.
   * Returns the full schema with prompt, examples, name, and agents for dynamic extraction.
   */
  async getAndCompileById(
    schemaId: string,
    version?: number
  ): Promise<CompiledSchema> {
    const whereClause = {
      id: schemaId,
      ...(version ? { version } : {})
    };

    const schema = await this.prisma.client.extractionSchema.findFirst({
      where: whereClause,
      orderBy: { version: "desc" } // Get latest version if none specified
    });

    if (!schema) {
      throw new Error(`Schema not found: ${schemaId}`);
    }

    const compiled = this.compiler.compile(
      schema.definition as unknown as JsonSchemaDefinition
    );

    // Add prompt, examples, name, and agents to the compiled schema
    const typedExamples = schema.examples as Array<
      Record<string, string>
    > | null;
    const typedAgents = schema.agents as AgentDefinition[] | undefined;

    return {
      ...compiled,
      prompt: schema.prompt,
      examples: typedExamples,
      name: schema.name,
      agents: typedAgents
    };
  }

  /**
   * Retrieves and compiles a schema by organization and name.
   */
  async getAndCompileByName(
    organizationId: string,
    name: string,
    version?: number
  ): Promise<CompiledSchema> {
    const whereClause = {
      organizationId,
      name,
      ...(version ? { version } : {})
    };

    const schema = await this.prisma.client.extractionSchema.findFirst({
      where: whereClause,
      orderBy: { version: "desc" }
    });

    if (!schema) {
      throw new Error(`Schema not found: ${organizationId}/${name}`);
    }

    const compiled = this.compiler.compile(
      schema.definition as unknown as JsonSchemaDefinition
    );

    // Add prompt, examples, name, and agents to the compiled schema
    const typedExamples = schema.examples as Array<
      Record<string, string>
    > | null;
    const typedAgents = schema.agents as AgentDefinition[] | undefined;

    return {
      ...compiled,
      prompt: schema.prompt,
      examples: typedExamples,
      name: schema.name,
      agents: typedAgents
    };
  }

  /**
   * Creates a new extraction schema (always version 1 with new identifier).
   */
  async createSchema(
    organizationId: string,
    name: string,
    version: number,
    definition: Prisma.InputJsonValue,
    prompt?: string,
    examples?: Prisma.InputJsonValue | null,
    agents?: AgentDefinition[]
  ): Promise<ExtractionSchema> {
    // Validate enhanced schema structure (includes validation for new property fields)
    this.compiler.validateEnhancedSchema({
      definition
    } as ExtractionSchema);

    // Validate agents if provided
    if (agents) {
      this.compiler.validateAgents(agents);
    }

    // Validate and compile the schema
    const compiled = this.compiler.compile(
      definition as unknown as JsonSchemaDefinition
    );

    // Generate unique identifier for new schema
    const schemaIdentifier = await this.ensureUniqueIdentifier(organizationId);

    const data: Record<string, unknown> = {
      organizationId,
      schemaIdentifier,
      name,
      version,
      definition,
      compiledJsonSchema: compiled.jsonSchema,
      prompt: prompt ?? undefined,
      // Use DbNull to represent SQL NULL for optional JSON columns
      examples:
        examples === undefined
          ? undefined
          : examples === null
            ? Prisma.DbNull
            : examples,
      // Store agents as JSON array (defaults to empty array in DB)
      agents: agents ? (agents as unknown as Prisma.InputJsonValue) : undefined
    };

    const schema = await this.prisma.client.extractionSchema.create({
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      data: data as unknown as Prisma.ExtractionSchemaCreateInput
    });

    return schema as ExtractionSchema;
  }

  /**
   * Lists all schemas for an organization (latest version only).
   */
  async listSchemasForOrganization(
    organizationId: string
  ): Promise<ExtractionSchema[]> {
    // Get all schemas for organization
    const allSchemas = await this.prisma.client.extractionSchema.findMany({
      where: { organizationId },
      orderBy: [{ schemaIdentifier: "asc" }, { version: "desc" }]
    });

    // Group by schemaIdentifier and keep only latest version
    const latestSchemasMap = new Map<string, (typeof allSchemas)[0]>();

    for (const schema of allSchemas) {
      const existing = latestSchemasMap.get(schema.schemaIdentifier);
      if (!existing || schema.version > existing.version) {
        latestSchemasMap.set(schema.schemaIdentifier, schema);
      }
    }

    return Array.from(latestSchemasMap.values()) as ExtractionSchema[];
  }

  /**
   * Lists all versions of a specific schema by identifier.
   */
  async listSchemaVersions(
    organizationId: string,
    schemaIdentifier: string
  ): Promise<ExtractionSchema[]> {
    const schemas = await this.prisma.client.extractionSchema.findMany({
      where: {
        organizationId,
        schemaIdentifier
      },
      orderBy: { version: "desc" }
    });

    return schemas as ExtractionSchema[];
  }

  /**
   * Creates a new version of an existing schema.
   * Schemas are immutable - editing creates a new version.
   */
  async createNewVersion(
    schemaId: string,
    updates: UpdateSchemaRequest
  ): Promise<ExtractionSchema> {
    // Get the current schema
    const currentSchema = await this.prisma.client.extractionSchema.findUnique({
      where: { id: schemaId }
    });

    if (!currentSchema) {
      throw new Error(`Schema not found: ${schemaId}`);
    }

    // Get the latest version number for this schema identifier
    const latestSchema = await this.prisma.client.extractionSchema.findFirst({
      where: {
        organizationId: currentSchema.organizationId,
        schemaIdentifier: currentSchema.schemaIdentifier
      },
      orderBy: { version: "desc" },
      select: { version: true }
    });

    if (!latestSchema) {
      throw new Error(
        `Latest schema not found: ${currentSchema.schemaIdentifier}`
      );
    }

    // Compile the definition if provided, otherwise use current
    const definition = (updates.definition ??
      currentSchema.definition) as unknown as JsonSchemaDefinition;

    // Validate enhanced schema structure (includes validation for new property fields)
    this.compiler.validateEnhancedSchema({
      definition
    } as ExtractionSchema);

    const compiled = this.compiler.compile(definition);

    // Create new version with same schemaIdentifier
    const updatedAgents = updates.agents as unknown as
      | Prisma.InputJsonValue
      | undefined;
    const currentExamples = currentSchema.examples as
      | Prisma.InputJsonValue
      | undefined;

    const createData: Record<string, unknown> = {
      organizationId: currentSchema.organizationId,
      schemaIdentifier: currentSchema.schemaIdentifier,
      name: updates.name || currentSchema.name,
      version: latestSchema.version + 1,
      definition,
      compiledJsonSchema: compiled.jsonSchema,
      prompt: updates.prompt ?? currentSchema.prompt,
      examples:
        updates.examples === undefined
          ? currentExamples
          : updates.examples === null
            ? Prisma.DbNull
            : updates.examples,
      agents: updatedAgents,
      changeDescription: updates.changeDescription
    };

    const schema = await this.prisma.client.extractionSchema.create({
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      data: createData as unknown as Prisma.ExtractionSchemaCreateInput
    });

    return schema as ExtractionSchema;
  }

  /**
   * Validates data against a schema without needing to compile it first.
   */
  async validateDataAgainstSchema(
    schemaId: string,
    data: Record<string, unknown>
  ): Promise<ValidationResultUnion<Record<string, unknown>>> {
    const compiled = await this.getAndCompileById(schemaId);
    return this.compiler.validateData(compiled, data);
  }

  /**
   * Validate extraction result data
   */
  validateResult(
    data: Record<string, unknown>
  ): ValidationResultUnion<Record<string, unknown>> {
    try {
      // For now, return success with the original data
      // This should use the compiled schema to validate the result structure
      return { success: true, data };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: {
          message: errorMessage
        }
      };
    }
  }

  /**
   * Validate evidence data structure
   */
  validateEvidence(
    evidence: Record<string, unknown>
  ): ValidationResultUnion<Record<string, unknown>> {
    try {
      // Basic validation for evidence structure
      if (!evidence || typeof evidence !== "object") {
        return {
          success: false,
          errors: {
            message: "Evidence must be an object"
          }
        };
      }
      return { success: true, data: evidence };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: { message: errorMessage }
      };
    }
  }

  /**
   * Updates an existing extraction schema by creating a new version.
   * Schemas are immutable - this is an alias for createNewVersion.
   */
  async updateSchema(
    schemaId: string,
    updates: UpdateSchemaRequest
  ): Promise<ExtractionSchema> {
    return this.createNewVersion(schemaId, updates);
  }

  /**
   * Gets the count of extraction jobs that reference a schema.
   */
  async getSchemaJobCount(schemaId: string): Promise<number> {
    return this.prisma.client.extractionJob.count({
      where: { schemaId }
    });
  }

  /**
   * Gets the count of extraction jobs that reference any version of a schema.
   */
  async getSchemaJobCountByIdentifier(
    organizationId: string,
    schemaIdentifier: string
  ): Promise<number> {
    // Collect all schema ids using raw query
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "extraction_schemas"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "schema_identifier" = ${schemaIdentifier}
    `;
    const schemaIds = rows.map((s: { id: string }) => s.id);

    return this.prisma.client.extractionJob.count({
      where: { schemaId: { in: schemaIds } }
    });
  }

  /**
   * Deletes all versions of a schema by schema ID.
   * Cascades deletion to all extraction jobs that reference any version.
   */
  async deleteSchema(schemaId: string): Promise<{ deletedJobsCount: number }> {
    // Check if schema exists and get its identifier
    const schema = await this.prisma.client.extractionSchema.findUnique({
      where: { id: schemaId }
    });

    if (!schema) {
      throw new Error(`Schema not found: ${schemaId}`);
    }

    // Delete all versions using the schema identifier
    return this.deleteAllVersions(
      schema.organizationId,
      schema.schemaIdentifier
    );
  }

  /**
   * Deletes all versions of a schema by identifier.
   * Cascades deletion to all extraction jobs that reference any version.
   */
  async deleteAllVersions(
    organizationId: string,
    schemaIdentifier: string
  ): Promise<{ deletedJobsCount: number }> {
    this.logger.log(
      JSON.stringify({
        level: "info",
        action: "deleteAllVersionsStarted",
        organizationId,
        schemaIdentifier
      })
    );

    // Get count of jobs that will be deleted
    const countResult = await this.prisma.client.$queryRaw<
      Array<{ count: bigint }>
    >`
      SELECT COUNT(*) as count
      FROM "extraction_jobs" ej
      WHERE ej."schema_id" IN (
        SELECT id FROM "extraction_schemas"
        WHERE "organization_id" = ${organizationId}::uuid
          AND "schema_identifier" = ${schemaIdentifier}
      )
    `;
    const jobCount = Number(countResult[0]?.count ?? 0);

    this.logger.log(
      JSON.stringify({
        level: "info",
        action: "deleteAllVersionsJobCount",
        organizationId,
        schemaIdentifier,
        jobCount
      })
    );

    // Delete all extraction jobs using a subquery (more efficient for large datasets)
    // This will cascade to extraction_results and extraction_job_data_layers
    if (jobCount > 0) {
      await this.prisma.client.$executeRaw`
        DELETE FROM "extraction_jobs"
        WHERE "schema_id" IN (
          SELECT id FROM "extraction_schemas"
          WHERE "organization_id" = ${organizationId}::uuid
            AND "schema_identifier" = ${schemaIdentifier}
        )
      `;

      this.logger.log(
        JSON.stringify({
          level: "info",
          action: "deleteAllVersionsJobsDeleted",
          organizationId,
          schemaIdentifier,
          deletedJobsCount: jobCount
        })
      );
    }

    // Now delete all versions of the schema
    await this.prisma.client.$executeRaw`
      DELETE FROM "extraction_schemas"
      WHERE "organization_id" = ${organizationId}::uuid
        AND "schema_identifier" = ${schemaIdentifier}
    `;

    this.logger.log(
      JSON.stringify({
        level: "info",
        action: "deleteAllVersionsCompleted",
        organizationId,
        schemaIdentifier,
        deletedJobsCount: jobCount
      })
    );

    return { deletedJobsCount: jobCount };
  }

  /**
   * Gets a schema by ID without compilation.
   */
  async getSchemaById(schemaId: string): Promise<ExtractionSchema | null> {
    const schema = await this.prisma.client.extractionSchema.findUnique({
      where: { id: schemaId }
    });

    if (!schema) {
      return null;
    }

    return schema as ExtractionSchema;
  }

  /**
   * Tests a single agent against sample data without persisting results.
   * This method will be fully functional once AgentExecutionService is implemented (Task 5).
   *
   * @param agentDefinition - The agent definition to test
   * @param inputData - Sample input data to process
   * @returns The transformed output and execution metadata
   */
  async testAgent(
    agentDefinition: AgentDefinition,
    _inputData: Record<string, unknown>
  ): Promise<{
    output: Record<string, unknown>;
    metadata: {
      agentName: string;
      agentOrder: number;
      agentPrompt: string;
      executedAt: string;
      durationMs: number;
      status: "success" | "failed" | "timeout";
      error?: string;
    };
  }> {
    // Validate the agent definition
    this.compiler.validateAgents([agentDefinition]);

    // TODO: This will be implemented once AgentExecutionService is created in Task 5
    // For now, return a placeholder response
    throw new Error(
      "testAgent method requires AgentExecutionService to be implemented (Task 5)"
    );
  }
}
