
import { Card } from "@packages/ui";
import { AlertCircle, Building2, CheckCircle2, Package } from "lucide-react";

interface ProjectStatsProps {
  stats: {
    totalItems: number;
    matchedItems: number;
    unmatchedItems: number;
    suppliersFound: number;
  };
}

export function ProjectStats({ stats }: ProjectStatsProps) {
  const matchRate =
    stats.totalItems > 0
      ? Math.round((stats.matchedItems / stats.totalItems) * 100)
      : 0;

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {/* Total Items */}
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
            <Package className="h-6 w-6 text-accent" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Items</p>
            <p className="text-2xl font-bold">{stats.totalItems}</p>
          </div>
        </div>
      </Card>

      {/* Matched Items */}
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Matched Items</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{stats.matchedItems}</p>
              <span className="text-sm text-green-600 font-medium">
                ({matchRate}%)
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Unmatched Items */}
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/10">
            <AlertCircle className="h-6 w-6 text-orange-600" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Unmatched</p>
            <p className="text-2xl font-bold">{stats.unmatchedItems}</p>
          </div>
        </div>
      </Card>

      {/* Suppliers Found */}
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Suppliers Found</p>
            <p className="text-2xl font-bold">{stats.suppliersFound}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
