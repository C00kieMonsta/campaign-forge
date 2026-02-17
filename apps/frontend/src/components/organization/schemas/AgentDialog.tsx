import { useEffect, useState } from "react";
import type { AgentDefinition } from "@packages/types";
import { TASK_CRITICALITY } from "@packages/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea
} from "@packages/ui";
import { AgentTestDialog } from "./AgentTestDialog";

interface AgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: AgentDefinition;
  existingAgents: AgentDefinition[];
  onSave: (agent: AgentDefinition) => void;
}

export function AgentDialog({
  open,
  onOpenChange,
  agent,
  existingAgents,
  onSave
}: AgentDialogProps) {
  const isEditing = !!agent;

  const [formData, setFormData] = useState<AgentDefinition>({
    name: "",
    prompt: "",
    order: 1,
    enabled: true,
    description: "",
    criticality: TASK_CRITICALITY.LOW
  });

  const [errors, setErrors] = useState<
    Partial<Record<keyof AgentDefinition, string>>
  >({});
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);

  // Initialize form data when dialog opens or agent changes
  useEffect(() => {
    if (open) {
      if (agent) {
        setFormData(agent);
      } else {
        // Suggest next available order
        const maxOrder =
          existingAgents.length > 0
            ? Math.max(...existingAgents.map((a) => a.order))
            : 0;
        setFormData({
          name: "",
          prompt: "",
          order: maxOrder + 1,
          enabled: true,
          description: "",
          criticality: TASK_CRITICALITY.LOW
        });
      }
      setErrors({});
    }
  }, [open, agent, existingAgents]);

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof AgentDefinition, string>> = {};

    // Name validation
    if (!formData.name.trim()) {
      newErrors.name = "Agent name is required";
    } else if (formData.name.length > 100) {
      newErrors.name = "Agent name must not exceed 100 characters";
    } else {
      // Check for duplicate names (excluding current agent when editing)
      const isDuplicate = existingAgents.some(
        (a, index) =>
          a.name === formData.name &&
          (!isEditing || existingAgents[index] !== agent)
      );
      if (isDuplicate) {
        newErrors.name = "An agent with this name already exists";
      }
    }

    // Prompt validation
    if (!formData.prompt.trim()) {
      newErrors.prompt = "Agent prompt is required";
    } else if (formData.prompt.length > 5000) {
      newErrors.prompt = "Agent prompt must not exceed 5000 characters";
    }

    // Description validation
    if (formData.description && formData.description.length > 500) {
      newErrors.description = "Description must not exceed 500 characters";
    }

    // Order validation
    if (!Number.isInteger(formData.order) || formData.order < 1) {
      newErrors.order = "Agent order must be a positive integer";
    } else {
      // Check for duplicate order (excluding current agent when editing)
      const isDuplicate = existingAgents.some(
        (a, index) =>
          a.order === formData.order &&
          (!isEditing || existingAgents[index] !== agent)
      );
      if (isDuplicate) {
        newErrors.order = "An agent with this order already exists";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSave(formData);
    }
  };

  const handleTestAgent = () => {
    setIsTestDialogOpen(true);
  };

  const getCharCountColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-orange-500";
    return "text-muted-foreground";
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? "Edit Post-Processing Agent"
                : "Add Post-Processing Agent"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Agent Name */}
            <div className="space-y-2">
              <Label htmlFor="agent-name">
                Agent Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="agent-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., Deduplicate Items"
                maxLength={100}
              />
              <div className="flex items-center justify-between">
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name}</p>
                )}
                <p
                  className={`text-xs ml-auto ${getCharCountColor(
                    formData.name.length,
                    100
                  )}`}
                >
                  {formData.name.length}/100 characters
                </p>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="agent-description">Description (Optional)</Label>
              <Textarea
                id="agent-description"
                value={formData.description || ""}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Brief description of what this agent does"
                rows={2}
                maxLength={500}
              />
              <div className="flex items-center justify-between">
                {errors.description && (
                  <p className="text-sm text-destructive">
                    {errors.description}
                  </p>
                )}
                <p
                  className={`text-xs ml-auto ${getCharCountColor(
                    formData.description?.length || 0,
                    500
                  )}`}
                >
                  {formData.description?.length || 0}/500 characters
                </p>
              </div>
            </div>

            {/* Agent Prompt */}
            <div className="space-y-2">
              <Label htmlFor="agent-prompt">
                Agent Prompt <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="agent-prompt"
                value={formData.prompt}
                onChange={(e) =>
                  setFormData({ ...formData, prompt: e.target.value })
                }
                placeholder="Review the extracted items and remove any duplicates. Compare items by their name field. Keep the first occurrence and remove subsequent duplicates. Return the deduplicated array."
                rows={8}
                className="font-mono text-sm"
                maxLength={5000}
              />
              <div className="flex items-center justify-between">
                {errors.prompt && (
                  <p className="text-sm text-destructive">{errors.prompt}</p>
                )}
                <p
                  className={`text-xs ml-auto ${getCharCountColor(
                    formData.prompt.length,
                    5000
                  )}`}
                >
                  {formData.prompt.length}/5000 characters
                </p>
              </div>
            </div>

            {/* Order */}
            <div className="space-y-2">
              <Label htmlFor="agent-order">
                Order <span className="text-destructive">*</span>
              </Label>
              <Input
                id="agent-order"
                type="number"
                min="1"
                value={formData.order}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    order: parseInt(e.target.value) || 1
                  })
                }
              />
              {errors.order && (
                <p className="text-sm text-destructive">{errors.order}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Agents execute in ascending order (1, 2, 3...)
              </p>
            </div>

            {/* Enabled Checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="agent-enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, enabled: checked as boolean })
                }
              />
              <Label
                htmlFor="agent-enabled"
                className="text-sm font-normal cursor-pointer"
              >
                Enabled
              </Label>
            </div>

            {/* Test Agent Button */}
            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestAgent}
                className="w-full"
                disabled={!formData.prompt.trim()}
              >
                Test Agent
              </Button>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {isEditing ? "Save Changes" : "Save Agent"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Test Agent Dialog */}
      <AgentTestDialog
        open={isTestDialogOpen}
        onOpenChange={setIsTestDialogOpen}
        agent={formData}
      />
    </>
  );
}
