import { Badge } from "@packages/ui";

interface RoleBadgeProps {
  role?: { slug: string; name: string } | null;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  if (!role) {
    return (
      <Badge variant="outline" className={className}>
        Unknown
      </Badge>
    );
  }

  const getRoleBadgeConfig = (roleSlug: string) => {
    switch (roleSlug) {
      case "owner":
        return {
          className:
            "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300"
        };
      case "admin":
        return {
          className:
            "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
        };
      case "member":
        return {
          variant: "secondary" as const
        };
      case "viewer":
        return {
          variant: "outline" as const
        };
      default:
        return {
          variant: "outline" as const
        };
    }
  };

  const config = getRoleBadgeConfig(role.slug);

  if (config.className) {
    return (
      <Badge className={`${config.className} ${className || ""}`}>
        {role.name}
      </Badge>
    );
  }

  return (
    <Badge variant={config.variant} className={className}>
      {role.name}
    </Badge>
  );
}
