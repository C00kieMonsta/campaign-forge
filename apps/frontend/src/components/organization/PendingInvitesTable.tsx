import type { Invitation } from "@packages/types";
import { Mail, UserX } from "lucide-react";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { RoleBadge } from "@/components/common/RoleBadge";
import { StatusBadge } from "@/components/common/StatusBadge";

interface PendingInvitesTableProps {
  invites: Invitation[];
  loading?: boolean;
  onResendInvite: (invitationId: string) => Promise<void>;
  onCancelInvite: (invitationId: string) => Promise<void>;
}

export function PendingInvitesTable({
  invites,
  loading = false,
  onResendInvite,
  onCancelInvite
}: PendingInvitesTableProps) {
  const formatDate = (date: Date | string) => {
    const dateObj = date instanceof Date ? date : new Date(date);
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  const columns = [
    {
      key: "email",
      header: "Email",
      render: (invite: Invitation) => (
        <span className="font-medium">{invite.email}</span>
      )
    },
    {
      key: "role",
      header: "Role",
      render: (invite: Invitation) => (
        <RoleBadge
          role={
            invite.role
              ? { slug: invite.role.slug, name: invite.role.name }
              : null
          }
        />
      )
    },
    {
      key: "createdAt",
      header: "Invited",
      render: (invite: Invitation) => formatDate(invite.createdAt)
    },
    {
      key: "status",
      header: "Status",
      render: (invite: Invitation) => (
        <StatusBadge
          status={invite.status as "pending" | "expired"}
          type="member"
        />
      )
    }
  ];

  const actions = [
    {
      label: "Resend invitation",
      icon: <Mail className="h-4 w-4" />,
      onClick: (invite: Invitation) => onResendInvite(invite.id),
      variant: "ghost" as const
    },
    {
      label: "Cancel invitation",
      icon: <UserX className="h-4 w-4" />,
      onClick: (invite: Invitation) => onCancelInvite(invite.id),
      variant: "ghost" as const
    }
  ];

  const emptyState = (
    <EmptyState
      icon={Mail}
      title="No pending invites"
      description="There are no pending invitations at the moment."
    />
  );

  return (
    <DataTable
      title={`Pending Invites (${invites.length})`}
      description="Invitations that are waiting for acceptance"
      data={invites}
      columns={columns}
      actions={actions}
      loading={loading}
      emptyState={emptyState}
      getRowKey={(invite) => invite.id}
    />
  );
}
