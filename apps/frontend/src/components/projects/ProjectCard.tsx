import type { Project } from "@packages/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@packages/ui";
import { Building2, Calendar, Clock, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/common";
import { formatDate, formatRelativeDate } from "@/utils/date-helpers";

interface ProjectCardProps {
  project: Project;
}

const MAX_NAME_LENGTH = 50;

function truncateName(
  name: string,
  maxLength: number = MAX_NAME_LENGTH
): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength)}...`;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link to={`/projects/${project.id}`}>
      <Card className="h-full hover:shadow-lg transition-all duration-200 cursor-pointer group hover:border-primary/20 bg-card">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CardTitle
                className="text-lg font-semibold text-foreground truncate group-hover:text-primary transition-colors"
                title={project.name}
              >
                {truncateName(project.name)}
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
        <CardContent className="pt-0 space-y-4">
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

          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                View Project
              </span>
              <Eye className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
