// src/repositories/IUserRepository.ts
import { User } from "../entities/user";

export interface IUserRepository {
  getUserById(userId: string): Promise<User | null>;
  getUsersByOrgId(organizationId: string): Promise<User[]>;
  createUser(user: Omit<User, "id">): Promise<User>;
  createUserWithId(user: User): Promise<User>;
  updateUser(userId: string, data: Partial<User>): Promise<User>;
  deleteUser(userId: string): Promise<void>;
}
