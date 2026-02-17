import {
  ASYNC_JOB_STATUSES,
  type ExtractionResultStatus,
  type ProjectStatusType
} from "@packages/types";
import { Badge, cn } from "@packages/ui";
import { AlertCircle, CheckCircle, Clock, Play } from "lucide-react";

interface StatusBadgeProps {
  status: string | ProjectStatusType | ExtractionResultStatus;
  type?: "project" | "extraction" | "member";
  className?: string;
}

export function StatusBadge({
  status,
  type = "extraction",
  className
}: StatusBadgeProps) {
  const getStatusConfig = () => {
    if (type === "project") {
      const variants = {
        active: {
          variant: "default" as const,
          icon: Play,
          text: "Active",
          className: "bg-accent text-accent-foreground"
        },
        completed: {
          variant: "default" as const,
          icon: CheckCircle,
          text: "Completed",
          className: "bg-accent text-accent-foreground"
        },
        on_hold: {
          variant: "secondary" as const,
          icon: Clock,
          text: "On Hold",
          className: ""
        },
        cancelled: {
          variant: "secondary" as const,
          icon: AlertCircle,
          text: "Cancelled",
          className: "bg-destructive/10 text-destructive border-destructive/20"
        }
      };
      return variants[status as keyof typeof variants] || variants.active;
    }

    if (type === "member") {
      const variants = {
        active: {
          variant: "secondary" as const,
          icon: CheckCircle,
          text: "Active",
          className: ""
        },
        pending: {
          variant: "outline" as const,
          icon: Clock,
          text: "Pending",
          className: ""
        },
        inactive: {
          variant: "destructive" as const,
          icon: AlertCircle,
          text: "Inactive",
          className: ""
        }
      };
      return (
        variants[status as keyof typeof variants] || {
          variant: "outline" as const,
          icon: AlertCircle,
          text: status,
          className: ""
        }
      );
    }

    // Default extraction status
    const variants = {
      [ASYNC_JOB_STATUSES.QUEUED]: {
        variant: "secondary" as const,
        icon: Clock,
        text: "Pending",
        className: ""
      },
      [ASYNC_JOB_STATUSES.RUNNING]: {
        variant: "default" as const,
        icon: AlertCircle,
        text: "Processing",
        className: "bg-primary text-primary-foreground"
      },
      [ASYNC_JOB_STATUSES.COMPLETED]: {
        variant: "default" as const,
        icon: CheckCircle,
        text: "Completed",
        className: "bg-accent text-accent-foreground"
      },
      [ASYNC_JOB_STATUSES.FAILED]: {
        variant: "secondary" as const,
        icon: AlertCircle,
        text: "Failed",
        className: "bg-destructive/10 text-destructive border-destructive/20"
      }
    };
    return (
      variants[status as keyof typeof variants] ||
      variants[ASYNC_JOB_STATUSES.QUEUED]
    );
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn("gap-1.5", config.className, className)}
    >
      <Icon className="h-3 w-3" />
      {config.text}
    </Badge>
  );
}
