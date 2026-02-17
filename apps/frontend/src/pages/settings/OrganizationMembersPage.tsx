import { useCallback, useEffect, useState } from "react";
import {
  useInvitations,
  useOrganizationMembers,
  usePersistence
} from "@packages/core-client";
import type { OrganizationMember, Role } from "@packages/types";
import {
  ConfirmationDialog,
  ErrorState,
  LoadingSkeleton
} from "@/components/common";
import {
  InviteUserForm,
  OrganizationMembersTable,
  OrganizationTabs,
  PendingInvitesTable
} from "@/components/organization";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

/**
 * Organization Members Settings Page
 *
 * Manage organization members, roles, and pending invitations
 */
export default function OrganizationMembersPage() {
  useProtectedRoute(); // Ensure user is authenticated

  const persistence = usePersistence();
  const members = useOrganizationMembers();
  const invitations = useInvitations();

  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Get auth headers with token
      const supabase = getSupabaseBrowser();
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // Fetch current user to get organization ID
      const userResponse = await fetch(
        `${import.meta.env.VITE_API_URL}/api/auth/me`,
        { headers }
      );
      if (!userResponse.ok) {
        throw new Error("Failed to fetch user profile");
      }

      const profile = await userResponse.json();
      const userOrgId = profile.organizationId;

      if (!userOrgId) {
        setError(
          "You are not associated with any organization. Please contact your administrator."
        );
        return;
      }

      setOrganizationId(userOrgId);

      // Fetch members and invitations through persistence provider
      // Data is automatically stored in Redux
      await Promise.all([
        persistence.organization.getOrganizationMembers(userOrgId),
        persistence.organization.getOrganizationInvitations(userOrgId)
      ]);

      // Fetch available roles
      const rolesRes = await fetch(
        `${import.meta.env.VITE_API_URL}/api/organizations/${userOrgId}/roles`,
        { headers }
      );
      if (rolesRes.ok) {
        const rolesData = await rolesRes.json();
        setAvailableRoles(rolesData.roles || []);
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Failed to fetch organization data";
      setError(errorMsg);
      console.error(
        JSON.stringify({
          level: "error",
          action: "fetchOrganizationData",
          error: errorMsg
        })
      );
    } finally {
      setLoading(false);
    }
  }, [persistence]);

  const handleSendInvite = async (data: { email: string; roleId: string }) => {
    if (!organizationId) return;
    try {
      setSubmitting(true);
      await persistence.organization.sendInvitation(organizationId, data);
      setInviteModalOpen(false);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "sendInvitationFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!selectedMemberId) return;

    try {
      setSubmitting(true);
      await persistence.organization.removeMember(selectedMemberId);
      setRemoveDialogOpen(false);
      setSelectedMemberId(null);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "removeMemberFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateRole = async (memberId: string, roleId: string) => {
    try {
      await persistence.organization.updateMemberRole(memberId, roleId);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "updateMemberRoleFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    }
  };

  const handleResendInvite = async (invitationId: string) => {
    try {
      await persistence.organization.resendInvitation(invitationId);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "resendInvitationFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    }
  };

  const handleCancelInvite = async (invitationId: string) => {
    try {
      await persistence.organization.cancelInvitation(invitationId);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "cancelInvitationFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
    }
  };

  const openRemoveDialog = (member: OrganizationMember) => {
    setSelectedMemberId(member.id);
    setRemoveDialogOpen(true);
  };

  // Get the selected member for the confirmation dialog
  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId)
    : null;

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-4 lg:p-6">
        <div className="mx-auto">
          <LoadingSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="mx-auto">
          <ErrorState
            title="Organization Access Error"
            message={error}
            onRetry={fetchData}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mx-auto">
        {/* Header */}
        <div className="mb-6 lg:mb-8">
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2">
            Organization Settings
          </h1>
          <p className="text-sm lg:text-base text-muted-foreground">
            Manage your organization members, roles, and invitations
          </p>
        </div>

        {/* Tabs Navigation */}
        <OrganizationTabs />

        {/* Content */}
        <div className="mt-6 space-y-8">
          {/* Invite Button */}
          <div className="flex justify-end">
            <InviteUserForm
              open={inviteModalOpen}
              onOpenChange={setInviteModalOpen}
              availableRoles={availableRoles}
              onSubmit={handleSendInvite}
              isSubmitting={submitting}
            />
          </div>

          {/* Members Table */}
          <OrganizationMembersTable
            members={members}
            availableRoles={availableRoles}
            onUpdateRole={handleUpdateRole}
            onRemoveMember={openRemoveDialog}
          />

          {/* Pending Invites Table */}
          <PendingInvitesTable
            invites={invitations}
            onResendInvite={handleResendInvite}
            onCancelInvite={handleCancelInvite}
          />
        </div>

        {/* Remove Member Confirmation */}
        <ConfirmationDialog
          open={removeDialogOpen}
          onOpenChange={setRemoveDialogOpen}
          title="Remove Member"
          description={`Are you sure you want to remove "${selectedMember?.user?.firstName || "Unknown"} ${selectedMember?.user?.lastName || "User"}" from your organization? This action cannot be undone.`}
          onConfirm={handleRemoveMember}
          isLoading={submitting}
          isDestructive
        />
      </div>
    </div>
  );
}
