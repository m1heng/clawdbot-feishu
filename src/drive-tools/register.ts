import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ResolvedFeishuAccount } from "../types.js";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { runDriveAction } from "./actions.js";
import { errorResult, json, type DriveClient } from "./common.js";
import { FeishuDriveSchema, type FeishuDriveParams } from "./schemas.js";

type DriveToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  run: (args: { client: DriveClient; account: ResolvedFeishuAccount }, params: P) => Promise<unknown>;
};

function registerDriveTool<P>(api: OpenClawPluginApi, spec: DriveToolSpec<P>) {
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
            requiredTool: "drive",
            run: async ({ client, account }) =>
              json(await spec.run({ client: client as DriveClient, account }, params as P)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: spec.name },
  );
}

export function registerFeishuDriveTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_drive: No config available, skipping drive tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_drive: No Feishu accounts configured, skipping drive tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "drive")) {
    api.logger.debug?.("feishu_drive: drive tool disabled in config");
    return;
  }

  registerDriveTool<FeishuDriveParams>(api, {
    name: "feishu_drive",
    label: "Feishu Drive",
    description:
      "Feishu cloud storage operations. Actions: list, info, create_folder, move, delete, import_document. Use 'import_document' to create documents from Markdown with better structure preservation than block-by-block writing.",
    parameters: FeishuDriveSchema,
    run: async ({ client, account }, params) => {
      const mediaMaxBytes = (account.config?.mediaMaxMb ?? 30) * 1024 * 1024;
      return runDriveAction(client, params, mediaMaxBytes);
    },
  });

  api.logger.debug?.("feishu_drive: Registered feishu_drive tool");
}
