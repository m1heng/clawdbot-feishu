/**
 * Shared auth logger reference so other modules (e.g. minutes) can log to the same auth log file.
 * Set by user-auth-tool when it registers; minutes/search can call getAuthLogger() to log token lookup details.
 */
export type AuthLoggerInstance = {
  info: (msg: string, detail?: Record<string, unknown>) => void;
  error: (msg: string, detailOrErr?: Record<string, unknown> | unknown) => void;
};

let authLogger: AuthLoggerInstance | null = null;

export function setAuthLogger(logger: AuthLoggerInstance | null): void {
  authLogger = logger;
}

export function getAuthLogger(): AuthLoggerInstance | null {
  return authLogger;
}
