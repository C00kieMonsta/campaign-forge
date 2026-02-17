import { cn } from "@packages/ui";

interface LoadingSkeletonProps {
  className?: string;
}

export function LoadingSkeleton({ className }: LoadingSkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded bg-muted", className)}
      aria-label="Loading..."
    />
  );
}

interface PageHeaderSkeletonProps {
  showBackButton?: boolean;
}

export function PageHeaderSkeleton({
  showBackButton = false
}: PageHeaderSkeletonProps) {
  return (
    <div className="p-4 lg:p-6">
      <div className="mx-auto">
        <div className="mb-4 lg:mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-4">
          {showBackButton && (
            <LoadingSkeleton className="h-8 w-8 lg:h-10 lg:w-10" />
          )}
          <LoadingSkeleton className="h-6 lg:h-8 w-48" />
        </div>
        <div className="space-y-4 lg:space-y-6">
          <LoadingSkeleton className="h-24 lg:h-32" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-20 lg:h-24" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 3, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid gap-4 py-3 border-b last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns }).map((_, j) => (
            <LoadingSkeleton key={j} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardSkeletonProps {
  count?: number;
  className?: string;
}

export function CardSkeleton({ count = 1, className }: CardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn("space-y-4 p-6 border rounded-lg", className)}
        >
          <LoadingSkeleton className="h-6 w-3/4" />
          <LoadingSkeleton className="h-4 w-full" />
          <LoadingSkeleton className="h-4 w-2/3" />
        </div>
      ))}
    </>
  );
}
