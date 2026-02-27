import { createFeishuClient } from "../client.js";
import {
  errorResult,
  json,
  runFeishuApiCall,
  type FeishuApiResponse,
} from "../tools-common/feishu-api.js";

export type DocClient = ReturnType<typeof createFeishuClient>;

export { json, errorResult };

export async function runDocApiCall<T extends FeishuApiResponse>(
  context: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runFeishuApiCall(context, fn);
}

export type DocFormat = "docx" | "doc";

/**
 * Detect document format from token.
 * Legacy doc tokens: usually start with "doccn" and contain only alphanumeric chars.
 * Docx tokens: Various formats that do not match legacy "doccn..." pattern.
 */
export function detectDocFormat(token: string): DocFormat {
  const normalizedToken = token.trim();
  if (/^doccn[a-zA-Z0-9]+$/.test(normalizedToken)) {
    return "doc";
  }
  return "docx";
}
