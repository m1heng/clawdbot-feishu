import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_AUTH_LOG_FILE = "feishu-user-auth.log";

export type PluginLogger = { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };

/**
 * Format a detail object as key=value pairs (values JSON-stringified if needed).
 */
function formatDetail(detail: Record<string, unknown> | undefined): string {
  if (!detail || Object.keys(detail).length === 0) return "";
  return Object.entries(detail)
    .map(([k, v]) => {
      const val = v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${val}`;
    })
    .join(" ");
}

/**
 * Create a logger that appends to a file and optionally forwards to the plugin logger.
 * Log format: [ISO_TIMESTAMP] [LEVEL] message key=value ...
 */
export function createAuthFileLogger(
  logFilePath: string,
  pluginLogger?: PluginLogger,
): { info: (msg: string, detail?: Record<string, unknown>) => void; error: (msg: string, detailOrErr?: Record<string, unknown> | unknown) => void } {
  const resolvedPath = path.isAbsolute(logFilePath) ? logFilePath : path.resolve(logFilePath);

  function write(level: "INFO" | "ERROR", message: string, extra: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] [UserAuth] ${message}${extra ? ` ${extra}` : ""}\n`;
    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(resolvedPath, line, "utf-8");
    } catch {
      // best effort
    }
    if (pluginLogger) {
      if (level === "INFO" && pluginLogger.info) {
        pluginLogger.info("[UserAuth]", extra ? `${message} ${extra}` : message);
      }
      if (level === "ERROR" && pluginLogger.error) {
        pluginLogger.error("[UserAuth]", extra ? `${message} ${extra}` : message);
      }
    }
  }

  return {
    info(msg: string, detail?: Record<string, unknown>): void {
      write("INFO", msg, formatDetail(detail));
    },
    error(msg: string, detailOrErr?: Record<string, unknown> | unknown): void {
      const extra =
        detailOrErr === undefined
          ? ""
          : typeof detailOrErr === "object" && detailOrErr !== null && !(detailOrErr instanceof Error)
            ? formatDetail(detailOrErr as Record<string, unknown>)
            : String(detailOrErr);
      write("ERROR", msg, extra);
    },
  };
}

/**
 * Resolve the auth log file path: same directory as the token store file, or system temp dir.
 * When tokenStorePath is set, we check if it's a directory and handle accordingly.
 */
export function getAuthLogFilePath(tokenStorePath: string | undefined): string {
  if (tokenStorePath) {
    const resolved = path.resolve(tokenStorePath);
    // If the path is an existing directory or looks like one (no extension), put log inside it
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return path.join(resolved, DEFAULT_AUTH_LOG_FILE);
      }
    } catch {
      // fall through
    }
    if (!path.basename(resolved).includes(".")) {
      // No extension – treat as directory
      return path.join(resolved, DEFAULT_AUTH_LOG_FILE);
    }
    // tokenStorePath is a file – put log next to it
    return path.join(path.dirname(resolved), DEFAULT_AUTH_LOG_FILE);
  }
  return path.join(os.tmpdir(), DEFAULT_AUTH_LOG_FILE);
}
