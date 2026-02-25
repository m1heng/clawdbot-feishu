import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { runWikiAction } from "./actions.js";
import { errorResult, json, type WikiClient } from "./common.js";
import { FeishuWikiSchema, type FeishuWikiParams } from "./schemas.js";

type WikiToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  run: (client: WikiClient, params: P) => Promise<unknown>;
};

function registerWikiTool<P>(api: OpenClawPluginApi, spec: WikiToolSpec<P>) {
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
            requiredTool: "wiki",
            run: async ({ client }) => json(await spec.run(client as WikiClient, params as P)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: spec.name },
  );
}

export function registerFeishuWikiTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_wiki: No config available, skipping wiki tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_wiki: No Feishu accounts configured, skipping wiki tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "wiki")) {
    api.logger.debug?.("feishu_wiki: wiki tool disabled in config");
    return;
  }

  registerWikiTool<FeishuWikiParams>(api, {
    name: "feishu_wiki",
    label: "Feishu Wiki",
    description:
      "Feishu knowledge base operations. Actions: spaces, nodes, get, create, move, rename",
    parameters: FeishuWikiSchema,
    run: (client, params) => runWikiAction(client, params),
  });

  api.logger.debug?.("feishu_wiki: Registered feishu_wiki tool");
}
