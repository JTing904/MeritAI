// Transient database failures (A15): the request did nothing that sticks (a transaction that failed rolled
// back), so the client may simply try again. The app's error handler answers 503 RETRY for these.

/** Prisma codes: can't reach / timed out / connection closed, pool timeout, transaction API error (e.g. the
 * interactive transaction timed out), write conflict or deadlock, too many connections. */
const PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034", "P2037"]);

/** Driver adapter error kinds (@prisma/driver-adapter-utils) that mean "try again". */
const ADAPTER_KINDS = new Set([
  "DatabaseNotReachable",
  "ConnectionClosed",
  "SocketTimeout",
  "TransactionWriteConflict",
  "TooManyConnections",
  "TransactionAlreadyClosed",
]);

/**
 * Postgres SQLSTATEs: serialization failure, deadlock, lock not available (lock_timeout), query canceled
 * (statement_timeout), too many connections, out of memory, server shutting down / restarting, and the
 * connection-exception class 08.
 */
const SQLSTATES = new Set(["40001", "40P01", "55P03", "57014", "53300", "53400", "57P01", "57P02", "57P03"]);

/** Socket errors from node / pg before Prisma wraps them. */
const NODE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);

/** pg's own messages for a pool that couldn't hand out a connection or lost one. */
const PG_MESSAGES = /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error/i;

type Loose = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown; code?: unknown } } };
  cause?: unknown;
};

function sqlStateTransient(code: unknown): boolean {
  return typeof code === "string" && (SQLSTATES.has(code) || code.startsWith("08"));
}

/** True for a lock/transaction timeout, write conflict, deadlock or lost/unavailable connection. */
export function isTransientDbError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as Loose;
  if (e.name === "PrismaClientInitializationError") return true;
  if (typeof e.code === "string" && (PRISMA_CODES.has(e.code) || NODE_CODES.has(e.code) || sqlStateTransient(e.code))) return true;
  const cause = e.meta?.driverAdapterError?.cause;
  if (cause) {
    if (typeof cause.kind === "string" && ADAPTER_KINDS.has(cause.kind)) return true;
    if (sqlStateTransient(cause.originalCode) || sqlStateTransient(cause.code)) return true;
  }
  if (typeof e.message === "string" && PG_MESSAGES.test(e.message)) return true;
  return isTransientDbError(e.cause, depth + 1);
}
