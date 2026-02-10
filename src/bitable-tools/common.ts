import { createFeishuClient } from "../client.js";

export type BitableClient = ReturnType<typeof createFeishuClient>;

// SDK-derived payload types keep tool input strongly typed and aligned with upstream API changes.
type AppTableFieldCreatePayload = NonNullable<
  Parameters<BitableClient["bitable"]["appTableField"]["create"]>[0]
>;
type AppTableFieldUpdatePayload = NonNullable<
  Parameters<BitableClient["bitable"]["appTableField"]["update"]>[0]
>;

export type BitableFieldCreateData = AppTableFieldCreatePayload["data"];
export type BitableFieldUpdateData = AppTableFieldUpdatePayload["data"];
export type BitableFieldDescription = NonNullable<BitableFieldCreateData["description"]>;

export function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

export function errorResult(err: unknown) {
  return json({ error: err instanceof Error ? err.message : String(err) });
}

type FeishuApiResponse = {
  code?: number;
  msg?: string;
  log_id?: string;
  logId?: string;
};

type FeishuErrorInfo = {
  code?: number;
  msg?: string;
  logId?: string;
};

const RETRYABLE_BITABLE_ERROR_CODES = new Set<number>([
  1254607, // Data not ready
  1255040, // Request timeout
  1254290, // Too many requests
  1254291, // Write conflict
]);

const RETRY_BACKOFF_MS = [350, 900, 1800];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFeishuErrorInfo(err: unknown): FeishuErrorInfo | null {
  if (!err) return null;

  // Feishu SDK may throw nested array structures like:
  // [axiosError, { code, msg, log_id, ... }]
  if (Array.isArray(err)) {
    for (let i = err.length - 1; i >= 0; i -= 1) {
      const info = extractFeishuErrorInfo(err[i]);
      if (info) return info;
    }
    return null;
  }

  if (typeof err !== "object") return null;

  const obj = err as Record<string, unknown>;
  const codeValue = obj.code;
  const msgValue = obj.msg ?? obj.message;
  const logIdValue = obj.log_id ?? obj.logId;

  const hasCode = typeof codeValue === "number";
  const hasMsg = typeof msgValue === "string";
  const hasLogId = typeof logIdValue === "string";

  if (hasCode || hasMsg || hasLogId) {
    return {
      code: hasCode ? codeValue : undefined,
      msg: hasMsg ? (msgValue as string) : undefined,
      logId: hasLogId ? (logIdValue as string) : undefined,
    };
  }

  const responseData = (obj.response as { data?: unknown } | undefined)?.data;
  if (responseData) return extractFeishuErrorInfo(responseData);

  return null;
}

function toError(err: unknown, context: string): Error {
  if (err instanceof Error) {
    const info = extractFeishuErrorInfo(err);
    if (!info) return err;
    const details = [
      info.msg || `code ${info.code}`,
      info.code !== undefined ? `code=${info.code}` : undefined,
      info.logId ? `log_id=${info.logId}` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    return new Error(`${context} failed: ${details}`);
  }

  const info = extractFeishuErrorInfo(err);
  if (info) {
    const details = [
      info.msg || `code ${info.code}`,
      info.code !== undefined ? `code=${info.code}` : undefined,
      info.logId ? `log_id=${info.logId}` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    return new Error(`${context} failed: ${details}`);
  }

  return new Error(`${context} failed: ${String(err)}`);
}

function assertFeishuOk<T extends FeishuApiResponse>(response: T, context: string): T {
  if (response.code === undefined || response.code === 0) return response;

  const message = response.msg || `code ${response.code}`;
  const detail = response.log_id ?? response.logId;
  const error = new Error(
    detail
      ? `${context} failed: ${message}, code=${response.code}, log_id=${detail}`
      : `${context} failed: ${message}, code=${response.code}`,
  ) as Error & { code?: number; log_id?: string; logId?: string };
  error.code = response.code;
  if (detail) {
    error.log_id = detail;
    error.logId = detail;
  }
  throw error;
}

export async function runBitableApiCall<T extends FeishuApiResponse>(
  context: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Bitable APIs can briefly return "Data not ready" after writes.
  // Retry only known transient codes with short backoff.
  const maxAttempts = RETRY_BACKOFF_MS.length + 1;
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt < maxAttempts) {
    try {
      const response = await fn();
      return assertFeishuOk(response, context);
    } catch (err) {
      lastErr = err;
      const info = extractFeishuErrorInfo(err);
      const retryable = info?.code !== undefined && RETRYABLE_BITABLE_ERROR_CODES.has(info.code);
      const exhausted = attempt >= maxAttempts - 1;
      if (!retryable || exhausted) {
        throw toError(err, context);
      }

      const backoffMs = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
      await sleep(backoffMs);
      attempt += 1;
    }
  }

  throw toError(lastErr, context);
}

const FIELD_TYPE_NAMES: Record<number, string> = {
  1: "Text",
  2: "Number",
  3: "SingleSelect",
  4: "MultiSelect",
  5: "DateTime",
  7: "Checkbox",
  11: "User",
  13: "Phone",
  15: "URL",
  17: "Attachment",
  18: "SingleLink",
  19: "Lookup",
  20: "Formula",
  21: "DuplexLink",
  22: "Location",
  23: "GroupChat",
  1001: "CreatedTime",
  1002: "ModifiedTime",
  1003: "CreatedUser",
  1004: "ModifiedUser",
  1005: "AutoNumber",
};

export function formatField(field: {
  field_id?: string;
  field_name?: string;
  type?: number;
  is_primary?: boolean;
  property?: unknown;
  ui_type?: string;
  is_hidden?: boolean;
}) {
  const typeName = field.type != null ? FIELD_TYPE_NAMES[field.type] || `type_${field.type}` : undefined;
  return {
    field_id: field.field_id,
    field_name: field.field_name,
    type: field.type,
    ...(typeName && { type_name: typeName }),
    is_primary: field.is_primary,
    ui_type: field.ui_type,
    is_hidden: field.is_hidden,
    ...(field.property && { property: field.property }),
  };
}
