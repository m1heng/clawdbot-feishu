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
 * Legacy doc tokens: doccnXXXXXXXXXXXXXXXXXXXXXXX (starts with "docc", 27 chars total)
 * Docx tokens: Various formats without "docc" prefix
 */
export function detectDocFormat(token: string): DocFormat {
  if (token.startsWith("docc")) {
    return "doc";
  }
  return "docx";
}
