/**
 * SQLite 的跨宿主端口。领域层只依赖这份契约，不能依赖 Tauri、Node 或具体驱动。
 */
export type SqlValue = null | string | number | boolean | Uint8Array;

export interface SqlStatement {
  sql: string;
  params: SqlValue[];
}

export interface TransactionStep extends SqlStatement {
  expectAffectedRows?: {
    min: number;
    max?: number;
  };
}

export interface StatementResult {
  rowsAffected: number;
  lastInsertRowId?: number | string;
}

export interface TransactionResult {
  steps: StatementResult[];
}

/**
 * 两个 SQLite 宿主都用这个稳定标记报告 affected-row 断言失败。Application
 * Service 据此把已知的 CAS 写入竞争返回为 conflict，而非吞掉成泛化事务错误。
 */
export const AFFECTED_ROWS_EXPECTATION_ERROR = "AINOVR_AFFECTED_ROWS_EXPECTATION";

export class AffectedRowsExpectationError extends Error {
  constructor(minimum: number, maximum: number, actual: number) {
    super(`${AFFECTED_ROWS_EXPECTATION_ERROR}: expected affected rows in [${minimum}, ${maximum}], received ${actual}.`);
    this.name = "AffectedRowsExpectationError";
  }
}

/** Rust Tauri 网关会把同一标记作为 invoke rejection 的文本返回。 */
export function isAffectedRowsExpectationError(cause: unknown): boolean {
  if (cause instanceof AffectedRowsExpectationError) return true;
  if (cause instanceof Error) return cause.message.includes(AFFECTED_ROWS_EXPECTATION_ERROR);
  return typeof cause === "string" && cause.includes(AFFECTED_ROWS_EXPECTATION_ERROR);
}

export interface SqlDriver {
  query<T>(statement: SqlStatement): Promise<T[]>;
  execute(statement: SqlStatement): Promise<StatementResult>;
  transaction(steps: TransactionStep[]): Promise<TransactionResult>;
  close(): Promise<void>;
}
