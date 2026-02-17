// src/persistence/IInvitationRepository.ts
import { SendInvitationRequest } from "../dto/invitations";
import { Invitation } from "../entities/invitation";

export interface CreateInvitationData {
  organizationId: string;
  email: string;
  roleId: string;
  invitedBy: string;
}

export interface IInvitationRepository {
  getInvitationByToken(token: string): Promise<Invitation | null>;
  getInvitationsByOrganization(organizationId: string): Promise<Invitation[]>;
  createInvitation(data: CreateInvitationData): Promise<Invitation>;
  updateInvitationStatus(
    invitationId: string,
    status: "pending" | "accepted" | "rejected" | "expired",
    acceptedBy?: string
  ): Promise<Invitation>;
  resendInvitation(invitationId: string): Promise<Invitation>;
  deleteInvitation(invitationId: string): Promise<void>;
}
