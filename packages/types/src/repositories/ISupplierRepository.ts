// src/persistence/ISupplierRepository.ts
import {
  CreateSupplierRequest,
  DeleteSupplierResponse,
  UpdateSupplierRequest
} from "../dto/suppliers";
import { Supplier } from "../entities/supplier";

export interface CreateSupplierData extends CreateSupplierRequest {
  organizationId: string;
}

export interface ISupplierRepository {
  getSupplierById(supplierId: string): Promise<Supplier | null>;
  getSuppliersByOrganization(organizationId: string): Promise<Supplier[]>;
  createSupplier(data: CreateSupplierData): Promise<Supplier>;
  updateSupplier(
    supplierId: string,
    data: UpdateSupplierRequest
  ): Promise<Supplier>;
  deleteSupplier(supplierId: string): Promise<DeleteSupplierResponse>;
  getSuppliersByOrganizationWithPagination(
    organizationId: string,
    page: number,
    limit: number
  ): Promise<{ suppliers: Supplier[]; total: number }>;
}

/**
 * Normalized response for supplier matches - avoids data duplication
 * Suppliers are returned separately and referenced by ID in matches
 */
export interface NormalizedSupplierMatchesResponse {
  extractionResults: Array<{
    id: string;
    data: Record<string, unknown>;
    status: string;
    matches: Array<{
      id: string;
      supplierId: string; // ← Reference to supplier, not full object
      confidenceScore: number | null;
      matchReason: string | null;
      isSelected: boolean;
    }>;
  }>;
  suppliers: Record<string, Supplier>; // ← Suppliers indexed by ID
}
