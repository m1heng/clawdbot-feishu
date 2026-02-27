import { Type, type TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ResolvedFeishuAccount } from "../types.js";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { listAppScopes, runDocAction } from "./actions.js";
import { errorResult, json, type DocClient } from "./common.js";
import { FeishuDocSchema, type FeishuDocParams } from "./schemas.js";

type DocToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  requiredTool?: "doc" | "scopes";
  run: (args: { client: DocClient; account: ResolvedFeishuAccount }, params: P) => Promise<unknown>;
};

function registerDocTool<P>(api: OpenClawPluginApi, spec: DocToolSpec<P>) {
  api.registerTool(
    {
      name: spec.name,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      async execute(_toolCallId, params) {
        try {
          return await withFeishuToolClient({
            api,
            toolName: spec.name,
            requiredTool: spec.requiredTool,
            run: async ({ client, account }) =>
              json(await spec.run({ client: client as DocClient, account }, params as P)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: spec.name },
  );
}

export function registerFeishuDocTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_doc: No config available, skipping doc tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_doc: No Feishu accounts configured, skipping doc tools");
    return;
  }

  const docEnabled = hasFeishuToolEnabledForAnyAccount(api.config, "doc");
  const scopesEnabled = hasFeishuToolEnabledForAnyAccount(api.config, "scopes");
  const registered: string[] = [];

  if (docEnabled) {
    registerDocTool<FeishuDocParams>(api, {
      name: "feishu_doc",
      label: "Feishu Doc",
      description:
        'Feishu document operations. Actions: read, write, append, create, create_and_write, list_blocks, get_block, update_block, delete_block, list_comments, create_comment, get_comment, list_comment_replies. Use "create_and_write" for atomic create + content write.',
      parameters: FeishuDocSchema,
      requiredTool: "doc",
      run: async ({ client, account }, params) => {
        const mediaMaxBytes = (account.config?.mediaMaxMb ?? 30) * 1024 * 1024;
        return runDocAction(client, params, mediaMaxBytes);
      },
    });
    registered.push("feishu_doc");
  }

  if (scopesEnabled) {
    registerDocTool<Record<string, never>>(api, {
      name: "feishu_app_scopes",
      label: "Feishu App Scopes",
      description:
        "List current app permissions (scopes). Use to debug permission issues or check available capabilities.",
      parameters: Type.Object({}),
      requiredTool: "scopes",
      run: async ({ client }) => listAppScopes(client),
    });
    registered.push("feishu_app_scopes");
  }

  if (registered.length > 0) {
    api.logger.debug?.(`feishu_doc: Registered ${registered.join(", ")}`);
  }
}
