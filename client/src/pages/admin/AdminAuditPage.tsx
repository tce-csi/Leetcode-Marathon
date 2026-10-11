import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/feedback";
import { api } from "@/lib/api-client";
import { formatDate, formatRelative } from "@/lib/format";
import type { AuditLogEntry } from "@/lib/services/admin";

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    api
      .get<{ logs: AuditLogEntry[] }>("/api/admin/audit?limit=150")
      .then((data) => setLogs(data.logs))
      .catch(() => setLogs([]));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" description="A record of every privileged action." />

      {logs === null ? (
        <PageLoader label="Loading audit log" />
      ) : logs.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-5" />} title="No audit entries yet" />
      ) : (
        <Card className="divide-y divide-border">
          {logs.map((log) => (
            <div key={log.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={log.actor_type === "ADMIN" ? "brand" : log.actor_type === "STUDENT" ? "info" : "neutral"}>
                  {log.actor_type}
                </Badge>
                <span className="font-mono text-sm">{log.action}</span>
                {log.entity_type ? (
                  <span className="text-xs text-muted">on {log.entity_type}</span>
                ) : null}
              </div>
              <div className="text-xs text-muted" title={formatDate(log.created_at)}>
                {formatRelative(log.created_at)}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
