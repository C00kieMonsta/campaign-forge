/**
 * Base repository contract defining standard CRUD operations
 * Domain-specific repositories can extend this interface
 */
export interface IBaseRepository<T, TCreate, TUpdate> {
  findById(id: string): Promise<T | null>;
  findMany(filter?: Partial<T>): Promise<T[]>;
  create(data: TCreate): Promise<T>;
  update(id: string, data: TUpdate): Promise<T>;
  delete(id: string): Promise<void>;
}
