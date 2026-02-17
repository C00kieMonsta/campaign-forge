
import { Badge } from "@packages/ui";
import { Building2 } from "lucide-react";

interface Client {
  name: string;
}

interface ClientStatusProps {
  client: Client | null;
  projectCount: number;
}

export function ClientStatus({ client, projectCount }: ClientStatusProps) {
  if (!client) return null;

  return (
    <div className="flex items-center gap-4 mt-4 p-3 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Client: {client.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Projects:</span>
        <Badge variant="default" className="bg-accent text-accent-foreground">
          {projectCount}
        </Badge>
      </div>
    </div>
  );
}
