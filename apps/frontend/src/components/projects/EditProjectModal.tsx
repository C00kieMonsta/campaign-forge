import { useEffect, useState } from "react";
import { usePersistence } from "@packages/core-client";
import type { Project, UpdateProjectRequest } from "@packages/types";
import { UpdateProjectRequestSchema } from "@packages/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from "@packages/ui";

interface EditProjectModalProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
  onProjectUpdated?: () => void;
}

const PROJECT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "deleted", label: "Deleted" }
] as const;

export function EditProjectModal({
  project,
  isOpen,
  onClose,
  onProjectUpdated
}: EditProjectModalProps) {
  // Access repository for project operations
  const persistence = usePersistence();
  const updateProject = async (
    projectId: string,
    data: UpdateProjectRequest
  ) => {
    return persistence.projects.updateProject(projectId, data);
  };
  const [isUpdating, setIsUpdating] = useState(false);
  const [formData, setFormData] = useState<Partial<UpdateProjectRequest>>({
    name: "",
    description: "",
    status: "active"
  });

  // Update form data when project changes
  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name,
        description: project.description || "",
        status: project.status
      });
    }
  }, [project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsUpdating(true);
      const validatedData = UpdateProjectRequestSchema.parse(formData);
      await updateProject(project.id, validatedData);

      onClose();
      onProjectUpdated?.();
    } catch (error) {
      let errorMessage = "Failed to update project";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      alert(`Error: ${errorMessage}`); // TODO: Replace with proper toast notification
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[425px]"
        aria-describedby="edit-project-desc"
      >
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription id="edit-project-desc">
            Modify the project details below and save your changes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Project Name *</Label>
            <Input
              id="name"
              value={formData.name || ""}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="Enter project name"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description || ""}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Enter project description"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status || "active"}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  status: value as "active" | "archived" | "deleted"
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating ? "Updating..." : "Update Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
