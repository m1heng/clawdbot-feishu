import { createFeishuClient } from "../client.js";
import { errorResult, json, runFeishuApiCall, type FeishuApiResponse } from "../tools-common/feishu-api.js";

export type ChatClient = ReturnType<typeof createFeishuClient>;

export { json, errorResult };

export async function runChatApiCall<T extends FeishuApiResponse>(
  context: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runFeishuApiCall(context, fn);
}
