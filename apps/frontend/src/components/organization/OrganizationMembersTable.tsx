import type {
  Role,
  OrganizationMember as StoreOrganizationMember
} from "@packages/types";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@packages/ui";
import { Users, UserX } from "lucide-react";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { RoleBadge } from "@/components/common/RoleBadge";
import { StatusBadge } from "@/components/common/StatusBadge";

interface OrganizationMembersTableProps {
  members: StoreOrganizationMember[];
  availableRoles: Role[];
  loading?: boolean;
  onUpdateRole: (memberId: string, newRoleId: string) => Promise<void>;
  onRemoveMember: (member: StoreOrganizationMember) => void;
}

export function OrganizationMembersTable({
  members,
  availableRoles,
  loading = false,
  onUpdateRole,
  onRemoveMember
}: OrganizationMembersTableProps) {
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
      key: "name",
      header: "Name",
      render: (member: StoreOrganizationMember) => (
        <span className="font-medium">
          {member.user?.firstName || "Unknown"}{" "}
          {member.user?.lastName || "User"}
        </span>
      )
    },
    {
      key: "email",
      header: "Email",
      render: (member: StoreOrganizationMember) => (
        <span>{member.user?.email || "Unknown"}</span>
      )
    },
    {
      key: "role",
      header: "Role",
      render: (member: StoreOrganizationMember) => (
        <Select
          value={member.role?.id || ""}
          onValueChange={(value) => onUpdateRole(member.id, value)}
        >
          <SelectTrigger className="w-32">
            <RoleBadge role={member.role ?? null} />
          </SelectTrigger>
          <SelectContent>
            {availableRoles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (member: StoreOrganizationMember) => (
        <StatusBadge status={member.status} type="member" />
      )
    },
    {
      key: "joinedAt",
      header: "Joined",
      render: (member: StoreOrganizationMember) => formatDate(member.joinedAt)
    }
  ];

  const actions = [
    {
      label: "Remove member",
      icon: <UserX className="h-4 w-4" />,
      onClick: (member: StoreOrganizationMember) => onRemoveMember(member),
      variant: "ghost" as const,
      disabled: (member: StoreOrganizationMember) =>
        member.role?.slug === "owner"
    }
  ];

  const emptyState = (
    <EmptyState
      icon={Users}
      title="No members found"
      description="There are no members in your organization yet."
    />
  );

  return (
    <DataTable
      title={`Organization Members (${members.length})`}
      description="Current members of your organization and their roles"
      data={members}
      columns={columns}
      actions={actions}
      loading={loading}
      emptyState={emptyState}
      getRowKey={(member) => member.id}
    />
  );
}
