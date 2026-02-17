// src/persistence/ISupplierMatchRepository.ts
import { SelectSupplierMatchRequest } from "../dto/suppliers";
import { SupplierMatch } from "../entities/supplier_match";

export interface CreateSupplierMatchData {
  extractionResultId: string;
  supplierId: string;
  confidenceScore?: number;
  matchReason?: string;
  matchMetadata?: any;
}

export interface ISupplierMatchRepository {
  findById(matchId: string): Promise<SupplierMatch | null>;
  findMany(jobId: string): Promise<SupplierMatch[]>;
  create(data: CreateSupplierMatchData): Promise<SupplierMatch>;
  createMany(data: CreateSupplierMatchData[]): Promise<SupplierMatch[]>;
  update(matchId: string, data: Partial<SupplierMatch>): Promise<SupplierMatch>;
  selectSupplier(
    matchId: string,
    data: SelectSupplierMatchRequest,
    selectedBy: string
  ): Promise<SupplierMatch>;
  delete(matchId: string): Promise<void>;
  getMatchesByJobId(jobId: string): Promise<SupplierMatch[]>;
  getApprovedResultsByJobId(jobId: string): Promise<any[]>;
}
