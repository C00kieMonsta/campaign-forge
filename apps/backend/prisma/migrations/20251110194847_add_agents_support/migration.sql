-- AlterTable
ALTER TABLE "extraction_results" ADD COLUMN     "agent_execution_metadata" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "extraction_schemas" ADD COLUMN     "agents" JSONB NOT NULL DEFAULT '[]';
