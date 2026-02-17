
import { useState } from "react";
import { useCollection, usePersistence } from "@packages/core-client";
import { CreateProjectRequestSchema } from "@packages/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea
} from "@packages/ui";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

interface CreateProjectModalProps {
  clientId: string;
}

export function CreateProjectModal({ clientId }: CreateProjectModalProps) {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    clientId,
    name: "",
    description: ""
  });

  // Read from store and access repositories
  const clients = useCollection("clients");
  const persistence = usePersistence();
  const { user } = useAuth();

  const createProject = async (data: any) => {
    return persistence.projects.createProject(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsCreating(true);

      // Check if any clients are available
      if (clients.length === 0) {
        throw new Error(
          "No clients are available. Please create a client first in the settings page."
        );
      }

      // Validate that the client exists
      const clientExists = clients.some((c) => c.id === formData.clientId);
      if (!clientExists) {
        throw new Error(
          `Selected client is not available. Please refresh the page and try again.`
        );
      }

      // Validate the form data first
      const validatedFormData = CreateProjectRequestSchema.parse(formData);

      // Get the selected client to get organizationId
      const selectedClient = clients.find((c) => c.id === formData.clientId);
      if (!selectedClient) {
        throw new Error("Selected client not found");
      }

      // Create the project using the repository
      await createProject({
        organizationId: selectedClient.organizationId,
        clientId: validatedFormData.clientId,
        name: validatedFormData.name,
        description: validatedFormData.description ?? null,
        location: validatedFormData.location ?? null,
        createdBy: user?.id || ""
      });

      setOpen(false);
      setFormData({
        clientId,
        name: "",
        description: ""
      });
    } catch (error) {
      // Extract error message from the response
      let errorMessage = "Failed to create project";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      alert(`Error: ${errorMessage}`); // TODO: Replace with proper toast notification
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-10 px-3 py-2 text-sm font-medium">
          <Plus className="h-4 w-4 mr-2" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px]"
        aria-describedby="create-project-desc"
      >
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription id="create-project-desc">
            Fill out the form below to create a new project.
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

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
