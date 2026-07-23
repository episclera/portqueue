import { InvalidOptionsError } from '../errors/errors.js';

/** Logical table names. Never a string literal at a query site. */
export enum TableName {
  QUEUE = 'queue',
  JOB = 'job',
  SCHEDULE = 'schedule',
  INSTANCE = 'instance',
  MIGRATION = 'migration',
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a user-influenced identifier (schema / tablePrefix) against a strict
 * allowlist. Fails fast with a clear error; never reaches SQL raw.
 */
export function validateIdentifier(kind: string, value: string, maxLen = 63): string {
  if (!IDENTIFIER_RE.test(value)) {
    throw new InvalidOptionsError(
      `Invalid ${kind} '${value}': must match ${IDENTIFIER_RE} (letters, digits, underscore; not starting with a digit).`,
    );
  }
  if (value.length > maxLen) {
    throw new InvalidOptionsError(
      `Invalid ${kind} '${value}': exceeds the ${maxLen}-character limit for this engine.`,
    );
  }
  return value;
}

/**
 * Resolves fully-qualified, prefixed, schema-qualified object names once.
 */
export class TableNames {
  readonly prefix: string;
  readonly schema?: string;

  constructor(options: { tablePrefix?: string; schema?: string; maxIdentifierLen?: number }) {
    this.prefix = validateIdentifier(
      'tablePrefix',
      options.tablePrefix ?? 'pq_',
      options.maxIdentifierLen,
    );
    if (options.schema !== undefined) {
      this.schema = validateIdentifier('schema', options.schema, options.maxIdentifierLen);
    }
  }

  /** The bare (unqualified) physical table name, e.g. `pq_job`. */
  bare(table: TableName): string {
    return `${this.prefix}${table}`;
  }
}
