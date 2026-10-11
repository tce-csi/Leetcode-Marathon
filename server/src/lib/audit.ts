import type { ActorKind } from "@/lib/types";
import type { Db } from "@/lib/db/types";
import { getDb } from "@/lib/db";

export interface AuditEntry {
  actorType: ActorKind;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Best-effort write to the audit log. Never throws into the caller. */
export async function writeAudit(entry: AuditEntry, db?: Db): Promise<void> {
  try {
    const client = db ?? getDb();
    await client.query(
      `insert into audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, ip)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.actorType,
        entry.actorId ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.ip ?? null,
      ],
    );
  } catch (error) {
    console.error("[audit] failed to write audit entry", error);
  }
}
