import { Suspense, useEffect, useState } from "react";
import { useClients, usePersistence, useProjects } from "@packages/core-client";
import type { Client, Project } from "@packages/types";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton
} from "@packages/ui";

// Loading skeleton components
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Metrics cards component
function MetricsCards({
  metrics
}: {
  metrics: {
    totalClients: number;
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
  };
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.totalClients}</div>
          <p className="text-xs text-muted-foreground">
            Active client accounts
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.totalProjects}</div>
          <p className="text-xs text-muted-foreground">All projects</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.activeProjects}</div>
          <p className="text-xs text-muted-foreground">Currently in progress</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Completed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.completedProjects}</div>
          <p className="text-xs text-muted-foreground">
            Successfully completed
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Recent projects component
function RecentProjects({ projects }: { projects: Project[] }) {
  const recentProjects = projects
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Projects</CardTitle>
        <CardDescription>Latest project activity</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recentProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects yet</p>
          ) : (
            recentProjects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {project.description || "No description"}
                  </p>
                </div>
                <Badge className={getStatusColor(project.status)}>
                  {project.status}
                </Badge>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Main dashboard content component
function DashboardDataContent() {
  const persistence = usePersistence();
  const clients = useClients();
  const projects = useProjects();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        await Promise.all([
          persistence.clients.getAll(),
          persistence.projects.getAll()
        ]);
      } catch (err) {
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to fetch dashboard data")
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [persistence]);

  const metrics = {
    totalClients: clients.length,
    totalProjects: projects.length,
    activeProjects: projects.filter((p: Project) => p.status === "active")
      .length,
    completedProjects: projects.filter((p: Project) => p.status === "archived")
      .length
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">
            Error loading dashboard data: {error.message || "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <MetricsCards metrics={metrics} />

      <div className="grid gap-4 md:grid-cols-2">
        <RecentProjects projects={projects} />

        <Card>
          <CardHeader>
            <CardTitle>Client Overview</CardTitle>
            <CardDescription>Your active clients</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clients yet</p>
              ) : (
                clients.slice(0, 5).map((client: Client) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium">{client.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {client.contactEmail || "No contact email"}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {
                        projects.filter(
                          (p: Project) => p.clientId === client.id
                        ).length
                      }{" "}
                      projects
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Main exported component with Suspense boundary
export function DashboardContent() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardDataContent />
    </Suspense>
  );
}
