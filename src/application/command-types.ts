export type CommandActorKind = "human" | "human_via_agent" | "external_agent" | "internal_agent" | "system";

export interface CommandEnvelope {
  schemaVersion: 1;
  commandId: string;
  idempotencyKey: string;
  correlationId: string;
  actor: {
    kind: CommandActorKind;
    id: string;
  };
  projectId?: string;
  expectedRevision?: number;
  tool: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export interface ResourceRef {
  type: string;
  id: string;
}

export interface DomainDiagnostic {
  code: string;
  message: string;
  resourceId?: string;
  field?: string;
}

export type CommandResult =
  | { kind: "ok"; revision?: number; resourceRefs: ResourceRef[] }
  | { kind: "accepted"; taskId: string; runId?: string }
  | { kind: "conflict"; currentRevision: number; diagnostics: DomainDiagnostic[] }
  | { kind: "blocked"; diagnostics: DomainDiagnostic[] }
  | { kind: "needs_confirmation"; confirmationId: string; risk: string; expiresAt: number }
  | { kind: "error"; code: string; message: string; retryable: boolean };
