/**
 * Organization Repository (Cold Data)
 *
 * Manages organization members and invitations fetching, caching, and store hydration.
 * Organization data is cold data - it changes infrequently and uses longer cache TTLs.
 */

import type {
  Invitation,
  OrganizationMember
} from "@packages/types";
import {
  removeInvitation,
  removeOrganizationMember,
  setInvitation,
  setInvitations,
  setOrganizationMember,
  setOrganizationMembers
} from "../store/slices/entities-slice";
import {
  setInvitationsError,
  setOrganizationMembersError
} from "../store/slices/ui-slice";
import type { RootState } from "../store/store";
import {
  BaseRepository,
  IColdRepository,
  type RepositoryDependencies
} from "./base-repository";

/**
 * Repository for managing Organization Entities (Members and Invitations)
 *
 * Implements the store-first pattern for:
 * - Fetching organization members
 * - Fetching pending invitations
 * - Creating and managing invitations
 * - Updating member roles
 * - Removing members
 */
export class OrganizationRepository
  extends BaseRepository<OrganizationMember | Invitation>
{
  /**
   * Cache TTL for cold data: 300 seconds (5 minutes)
   */
  readonly cacheTTL = 300;

  constructor(dependencies: RepositoryDependencies) {
    super(dependencies);
  }

  /**
   * Get the base API path for organization endpoints
   */
  protected getBasePath(): string {
    return "/organizations";
  }

  /**
   * Fetch all members for an organization
   */
  async getOrganizationMembers(
    organizationId: string
  ): Promise<OrganizationMember[]> {
    try {
      const response = await this.adapter.get<{
        users: OrganizationMember[];
        total: number;
        page: number;
        limit: number;
      }>(
        `${this.getBasePath()}/${organizationId}/members`
      );

      // Extract members array from paginated response
      const members = response.users || [];

      // Hydrate store with fetched members
      this.store.dispatch(setOrganizationMembers(members));

      return members;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch organization members";
      this.store.dispatch(setOrganizationMembersError(errorMessage));
      throw error;
    }
  }

  /**
   * Fetch a single organization member by ID
   */
  async getOrganizationMember(
    memberId: string
  ): Promise<OrganizationMember | null> {
    try {
      return await this.adapter.get<OrganizationMember>(
        `${this.getBasePath()}/members/${memberId}`
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "getOrganizationMember",
          memberId,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      throw error;
    }
  }

  /**
   * Fetch all pending invitations for an organization
   */
  async getOrganizationInvitations(
    organizationId: string
  ): Promise<Invitation[]> {
    try {
      const response = await this.adapter.get<{
        invitations: Invitation[];
        total: number;
        page: number;
        limit: number;
      }>(
        `${this.getBasePath()}/${organizationId}/invitations`
      );

      // Extract invitations array from paginated response
      const invitations = response.invitations || [];

      // Hydrate store with fetched invitations
      this.store.dispatch(setInvitations(invitations));

      return invitations;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch invitations";
      this.store.dispatch(setInvitationsError(errorMessage));
      throw error;
    }
  }

  /**
   * Send an invitation to a user
   */
  async sendInvitation(
    organizationId: string,
    data: { email: string; roleId: string }
  ): Promise<Invitation> {
    try {
      const response = await this.adapter.post<Invitation>(
        `${this.getBasePath()}/${organizationId}/invite`,
        data
      );

      // Add to store
      this.store.dispatch(setInvitation(response));

      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "sendInvitation",
          organizationId,
          email: data.email,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      throw error;
    }
  }

  /**
   * Resend an invitation
   */
  async resendInvitation(invitationId: string): Promise<Invitation> {
    try {
      const response = await this.adapter.post<Invitation>(
        `${this.getBasePath()}/invitations/${invitationId}/resend`,
        {}
      );

      // Update store
      this.store.dispatch(setInvitation(response));

      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "resendInvitation",
          invitationId,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      throw error;
    }
  }

  /**
   * Cancel an invitation
   */
  async cancelInvitation(invitationId: string): Promise<void> {
    try {
      await this.adapter.delete(`${this.getBasePath()}/invitations/${invitationId}`);

      // Remove from store
      this.store.dispatch(removeInvitation(invitationId));
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "cancelInvitation",
          invitationId,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      throw error;
    }
  }

  /**
   * Update a member's role
   */
  async updateMemberRole(
    memberId: string,
    roleId: string
  ): Promise<OrganizationMember> {
    try {
      const response = await this.adapter.put<OrganizationMember>(
        `${this.getBasePath()}/members/${memberId}/role`,
        { roleId }
      );

      // Update store
      this.store.dispatch(setOrganizationMember(response));

      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "updateMemberRole",
          memberId,
          roleId,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      throw error;
    }
  }

  /**
   * Remove a member from an organization
   */
  async removeMember(memberId: string): Promise<void> {
    try {
      await this.adapter.delete(`${this.getBasePath()}/members/${memberId}`);

      // Remove from store
      this.store.dispatch(removeOrganizationMember(memberId));
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "removeMember",
          memberId,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );
      throw error;
    }
  }

  // BaseRepository abstract method implementations (not used for this repository)
  protected getEntityType(): keyof RootState["entities"] {
    return "organizationMembers"; // Default, not used
  }

  protected dispatchSetEntity(): void {
    // Not used - we dispatch directly in specific methods
  }

  protected dispatchSetEntities(): void {
    // Not used - we dispatch directly in specific methods
  }

  protected dispatchRemoveEntity(): void {
    // Not used - we dispatch directly in specific methods
  }

  protected dispatchError(): void {
    // Not used - we dispatch directly in specific methods
  }
}

