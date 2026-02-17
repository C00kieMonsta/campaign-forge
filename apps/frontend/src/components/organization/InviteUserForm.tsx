
import { useState } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@packages/ui";
import type { Role } from "@packages/types";
import { Mail } from "lucide-react";
import { FormModal, FormModalFooter } from "@/components/common/FormModal";

interface InviteData {
  email: string;
  roleId: string;
}

interface InviteUserFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableRoles: Role[];
  onSubmit: (data: InviteData) => Promise<void>;
  isSubmitting?: boolean;
}

export function InviteUserForm({
  open,
  onOpenChange,
  availableRoles,
  onSubmit,
  isSubmitting = false
}: InviteUserFormProps) {
  const [inviteData, setInviteData] = useState<InviteData>({
    email: "",
    roleId:
      availableRoles.find((role) => role.slug === "member")?.id ||
      availableRoles[0]?.id ||
      ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(inviteData);
    setInviteData({
      email: "",
      roleId:
        availableRoles.find((role) => role.slug === "member")?.id ||
        availableRoles[0]?.id ||
        ""
    });
  };

  const handleCancel = () => {
    onOpenChange(false);
    setInviteData({
      email: "",
      roleId:
        availableRoles.find((role) => role.slug === "member")?.id ||
        availableRoles[0]?.id ||
        ""
    });
  };

  const trigger = (
    <Button>
      <Mail className="h-4 w-4 mr-2" />
      Invite User
    </Button>
  );

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Invite New User"
      description="Send an invitation to join your organization"
      trigger={trigger}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email Address *</Label>
          <Input
            id="email"
            type="email"
            value={inviteData.email}
            onChange={(e) =>
              setInviteData({ ...inviteData, email: e.target.value })
            }
            placeholder="Enter email address"
            required
          />
        </div>
        <div>
          <Label htmlFor="role">Role *</Label>
          <Select
            value={inviteData.roleId}
            onValueChange={(value) =>
              setInviteData({ ...inviteData, roleId: value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {availableRoles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormModalFooter
          onCancel={handleCancel}
          cancelText="Cancel"
          submitText="Send Invite"
          isSubmitting={isSubmitting}
        />
      </form>
    </FormModal>
  );
}
