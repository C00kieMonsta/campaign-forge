import { useMemo } from "react";
import type { Project } from "@packages/types";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@packages/ui";
import { Calendar, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { toDate } from "@/utils/date-helpers";

interface ProjectsTimelineProps {
  projects: Project[];
}

interface TimelineGroup {
  year: number;
  month: number;
  monthName: string;
  projects: Project[];
  count: number;
}

export function ProjectsTimeline({ projects }: ProjectsTimelineProps) {
  const timelineData = useMemo(() => {
    const groups: Map<string, TimelineGroup> = new Map();

    projects.forEach((project) => {
      const date = toDate(project.createdAt);
      const year = date.getFullYear();
      const month = date.getMonth();
      const monthName = date.toLocaleDateString("en-US", { month: "long" });
      const key = `${year}-${month}`;

      if (!groups.has(key)) {
        groups.set(key, {
          year,
          month,
          monthName,
          projects: [],
          count: 0
        });
      }

      const group = groups.get(key)!;
      group.projects.push(project);
      group.count = group.projects.length;
    });

    // Sort by year and month (most recent first)
    return Array.from(groups.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }, [projects]);

  const formatDate = (dateValue: any) => {
    const date =
      typeof dateValue === "string"
        ? new Date(dateValue)
        : dateValue instanceof Date
          ? dateValue
          : new Date(dateValue);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  const formatRelativeDate = (dateValue: any) => {
    const date =
      typeof dateValue === "string"
        ? new Date(dateValue)
        : dateValue instanceof Date
          ? dateValue
          : new Date(dateValue);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return "Today";
    if (diffInDays === 1) return "Yesterday";
    if (diffInDays < 7) return `${diffInDays} days ago`;
    if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
    if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months ago`;
    return `${Math.floor(diffInDays / 365)} years ago`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "completed":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "on_hold":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "cancelled":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="p-12">
          <div className="text-center">
            <Calendar className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              No projects to display
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              Create your first project to see the timeline view
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Timeline Header */}
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <Calendar className="h-4 w-4" />
        <span>
          Timeline View • {projects.length} project
          {projects.length !== 1 ? "s" : ""} across {timelineData.length} time
          period{timelineData.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Timeline Groups */}
      {timelineData.map((group) => (
        <Collapsible key={`${group.year}-${group.month}`} defaultOpen>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <ChevronDown className="h-4 w-4 transition-transform data-[state=closed]:rotate-90" />
                      <div>
                        <CardTitle className="text-lg">
                          {group.monthName} {group.year}
                        </CardTitle>
                        <CardDescription>
                          {group.count} project{group.count !== 1 ? "s" : ""}
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="ml-auto">
                    {group.count}
                  </Badge>
                </div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.projects.map((project) => (
                    <Link key={project.id} to={`/projects/${project.id}`}>
                      <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-base truncate">
                                {project.name}
                              </CardTitle>
                            </div>
                            <Badge className={getStatusColor(project.status)}>
                              {project.status}
                            </Badge>
                          </div>
                          {project.description && (
                            <CardDescription className="line-clamp-2 text-xs">
                              {project.description}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex items-center justify-between">
                              <span>Client:</span>
                              <span className="font-medium truncate ml-2">
                                {project.client?.name || "Unknown Client"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Created:</span>
                              <span className="font-medium">
                                {formatDate(new Date(project.createdAt))}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Updated:</span>
                              <span className="text-gray-500">
                                {formatRelativeDate(
                                  new Date(project.updatedAt)
                                )}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ))}
    </div>
  );
}
