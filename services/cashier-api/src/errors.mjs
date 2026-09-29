/**
 * Typed errors shared by both cashier repository backends (in-memory and SQL)
 * and by the handlers layer. Handlers map these to HTTP status codes instead
 * of letting them fall through as unhandled 500s:
 *
 *   CashierValidationError -> 400
 *   CashierConflictError   -> 409
 */

export class CashierValidationError extends Error {
  constructor(message, { field, cause } = {}) {
    super(message);
    this.name = "CashierValidationError";
    this.code = "cashier_validation_failed";
    this.field = field;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class CashierConflictError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "CashierConflictError";
    this.code = "cashier_conflict";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Postgres constraint violations use SQLSTATE class 23 (integrity constraint
 * violation). node-postgres surfaces the SQLSTATE code as `err.code`. Rather
 * than let these bubble up as unhandled 500s, translate them into typed
 * cashier errors the handlers layer already knows how to map.
 */
export function translatePostgresError(err) {
  const sqlState = err?.code;
  if (typeof sqlState !== "string" || !sqlState.startsWith("23")) {
    return err;
  }

  const detail = err.constraint ?? err.detail ?? err.message;
  if (sqlState === "23505") {
    return new CashierConflictError(`unique_constraint_violation: ${detail}`, { cause: err });
  }

  // 23502 not_null_violation, 23503 foreign_key_violation, 23514 check_violation,
  // and the remaining 23xxx codes are all client-correctable input problems.
  return new CashierValidationError(`constraint_violation: ${detail}`, { cause: err });
}
