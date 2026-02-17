import type { Project } from "@packages/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  cn
} from "@packages/ui";
import { Building2, Calendar, Clock, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/common";
import { formatDate, formatRelativeDate } from "@/utils/date-helpers";

interface ProjectCardSelectableProps {
  project: Project;
  isEditMode?: boolean;
  isSelected?: boolean;
  onSelect?: (projectId: string, checked: boolean) => void;
}

export function ProjectCardSelectable({
  project,
  isEditMode = false,
  isSelected = false,
  onSelect
}: ProjectCardSelectableProps) {
  const isArchived = project.status === "archived";

  const CardWrapper = ({ children }: { children: React.ReactNode }) => {
    if (isEditMode) {
      return (
        <Card
          className={cn(
            "h-full transition-all duration-200 relative",
            isArchived && "opacity-60",
            isSelected && "ring-2 ring-primary"
          )}
        >
          {children}
        </Card>
      );
    }

    return (
      <Link to={`/projects/${project.id}`}>
        <Card
          className={cn(
            "h-full hover:shadow-lg transition-all duration-200 cursor-pointer group hover:border-primary/20 bg-card",
            isArchived && "opacity-60"
          )}
        >
          {children}
        </Card>
      </Link>
    );
  };

  return (
    <CardWrapper>
      {isEditMode && (
        <div className="absolute top-3 left-3 z-10">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) =>
              onSelect?.(project.id, checked as boolean)
            }
          />
        </div>
      )}

      <CardHeader className={cn("pb-4", isEditMode && "pl-10")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle
              className={cn(
                "text-lg font-semibold text-foreground truncate transition-colors",
                !isEditMode && "group-hover:text-primary"
              )}
            >
              {project.name}
            </CardTitle>
            {project.description && (
              <CardDescription className="line-clamp-2 text-sm mt-2 text-muted-foreground">
                {project.description}
              </CardDescription>
            )}
          </div>
          <StatusBadge status={project.status} type="project" />
        </div>
      </CardHeader>

      <CardContent className={cn("pt-0 space-y-4", isEditMode && "pl-10")}>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex items-center justify-between w-full">
              <span className="text-sm text-muted-foreground">Client:</span>
              <span className="text-sm font-medium text-foreground truncate ml-2">
                {project.client?.name || "Unknown Client"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex items-center justify-between w-full">
              <span className="text-sm text-muted-foreground">Created:</span>
              <span className="text-sm font-medium text-foreground">
                {formatDate(project.createdAt, {
                  year: "2-digit",
                  month: "short",
                  day: "numeric"
                })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex items-center justify-between w-full">
              <span className="text-sm text-muted-foreground">Updated:</span>
              <span className="text-sm text-muted-foreground">
                {formatRelativeDate(project.updatedAt)}
              </span>
            </div>
          </div>
        </div>

        {!isEditMode && (
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                View Project
              </span>
              <Eye className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
        )}
      </CardContent>
    </CardWrapper>
  );
}
