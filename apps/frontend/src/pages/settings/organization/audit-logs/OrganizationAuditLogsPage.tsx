import { useState } from "react";
import { AuditLogDetailsModal, AuditLogsTable } from "@/components/audit";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { OrganizationTabs } from "@/components/organization";
import type { AuditLog } from "@/hooks/use-audit-logs";
import { useProtectedRoute } from "@/hooks/use-protected-route";

/**
 * Organization Audit Logs Settings Page
 *
 * View audit logs for the organization (admin only)
 */
export default function OrganizationAuditLogsPage() {
  useProtectedRoute(); // Ensure user is authenticated

  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLog | null>(
    null
  );
  const [auditLogModalOpen, setAuditLogModalOpen] = useState(false);

  const handleViewAuditLogDetails = (log: AuditLog) => {
    setSelectedAuditLog(log);
    setAuditLogModalOpen(true);
  };

  return (
    <AdminRouteGuard>
      <div className="p-4 lg:p-6">
        <div className="mx-auto">
          {/* Header */}
          <div className="mb-6 lg:mb-8">
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight mb-2">
              Organization Settings
            </h1>
            <p className="text-sm lg:text-base text-muted-foreground">
              View audit logs for your organization
            </p>
          </div>

          {/* Tabs Navigation */}
          <OrganizationTabs />

          {/* Content */}
          <div className="mt-6">
            <AuditLogsTable onViewDetails={handleViewAuditLogDetails} />
          </div>

          {/* Audit Log Details Modal */}
          <AuditLogDetailsModal
            log={selectedAuditLog}
            open={auditLogModalOpen}
            onOpenChange={setAuditLogModalOpen}
          />
        </div>
      </div>
    </AdminRouteGuard>
  );
}
