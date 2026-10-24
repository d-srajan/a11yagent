// Shared structured logger. One JSON object per line so container logs stay
// greppable and machine-parseable. Writes to the process streams directly,
// which is why the codebase-wide no-console rule never needs an exception.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  base?: LogFields;
  write?: (line: string, level: LogLevel) => void;
}

function defaultWrite(line: string, level: LogLevel): void {
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVEL_ORDER[options.level ?? "info"];
  const base = options.base ?? {};
  const write = options.write ?? defaultWrite;

  const log = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const entry: LogFields = { time: new Date().toISOString(), level, msg, ...base };
    for (const [key, value] of Object.entries(fields)) entry[key] = serializeError(value);
    write(JSON.stringify(entry), level);
  };

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}
