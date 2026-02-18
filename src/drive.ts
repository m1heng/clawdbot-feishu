import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type * as Lark from "@larksuiteoapi/node-sdk";
import { FeishuDriveSchema, type FeishuDriveParams } from "./drive-schema.js";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "./tools-common/tool-exec.js";
import { createAndWriteDoc } from "./doc-write-service.js";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ============ Actions ============

async function getRootFolderToken(client: Lark.Client): Promise<string> {
  // Use generic HTTP client to call the root folder meta API
  // as it's not directly exposed in the SDK
  const domain = (client as any).domain ?? "https://open.feishu.cn";
  const res = (await (client as any).httpInstance.get(
    `${domain}/open-apis/drive/explorer/v2/root_folder/meta`,
  )) as { code: number; msg?: string; data?: { token?: string } };
  if (res.code !== 0) throw new Error(res.msg ?? "Failed to get root folder");
  const token = res.data?.token;
  if (!token) throw new Error("Root folder token not found");
  return token;
}

async function listFolder(client: Lark.Client, folderToken?: string) {
  // Filter out invalid folder_token values (empty, "0", etc.)
  const validFolderToken = folderToken && folderToken !== "0" ? folderToken : undefined;
  const res = await client.drive.file.list({
    params: validFolderToken ? { folder_token: validFolderToken } : {},
  });
  if (res.code !== 0) throw new Error(res.msg);

  return {
    files:
      res.data?.files?.map((f) => ({
        token: f.token,
        name: f.name,
        type: f.type,
        url: f.url,
        created_time: f.created_time,
        modified_time: f.modified_time,
        owner_id: f.owner_id,
      })) ?? [],
    next_page_token: res.data?.next_page_token,
  };
}

async function getFileInfo(client: Lark.Client, fileToken: string, folderToken?: string) {
  let pageToken: string | undefined;
  
  do {
    const res = await client.drive.file.list({
      params: folderToken ? { folder_token: folderToken, page_token: pageToken } : { page_token: pageToken },
    });
    if (res.code !== 0) throw new Error(res.msg);

    const file = res.data?.files?.find((f) => f.token === fileToken);
    if (file) {
      return {
        token: file.token,
        name: file.name,
        type: file.type,
        url: file.url,
        created_time: file.created_time,
        modified_time: file.modified_time,
        owner_id: file.owner_id,
      };
    }
    
    pageToken = res.data?.next_page_token;
  } while (pageToken);

  throw new Error(`File not found: ${fileToken}`);
}

async function createFolder(client: Lark.Client, name: string, folderToken?: string) {
  // Feishu supports using folder_token="0" as the root folder.
  // We *try* to resolve the real root token (explorer API), but fall back to "0"
  // because some tenants/apps return 400 for that explorer endpoint.
  let effectiveToken = folderToken && folderToken !== "0" ? folderToken : "0";
  if (effectiveToken === "0") {
    try {
      effectiveToken = await getRootFolderToken(client);
    } catch {
      // ignore and keep "0"
    }
  }

  const res = await client.drive.file.createFolder({
    data: {
      name,
      folder_token: effectiveToken,
    },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return {
    token: res.data?.token,
    url: res.data?.url,
  };
}

async function moveFile(
  client: Lark.Client,
  fileToken: string,
  type: string,
  folderToken: string,
) {
  const res = await client.drive.file.move({
    path: { file_token: fileToken },
    data: {
      type: type as "doc" | "docx" | "sheet" | "bitable" | "folder" | "file" | "mindnote" | "slides",
      folder_token: folderToken,
    },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return {
    success: true,
    task_id: res.data?.task_id,
  };
}

async function deleteFile(client: Lark.Client, fileToken: string, type?: string) {
  let effectiveType = type;
  
  if (!effectiveType) {
    console.log(`[feishu_drive.delete] Auto-detecting type for file_token: ${fileToken}`);
    effectiveType = await getFileType(client, fileToken);
    console.log(`[feishu_drive.delete] Detected type: ${effectiveType}`);
  }
  
  console.log(`[feishu_drive.delete] Deleting file ${fileToken} with type: ${effectiveType}`);
  const res = await client.drive.file.delete({
    path: { file_token: fileToken },
    params: {
      type: effectiveType as
        | "doc"
        | "docx"
        | "sheet"
        | "bitable"
        | "folder"
        | "file"
        | "mindnote"
        | "slides"
        | "shortcut",
    },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return {
    success: true,
    task_id: res.data?.task_id,
    type_used: effectiveType,
  };
}

async function getFileType(client: Lark.Client, fileToken: string): Promise<string> {
  let pageToken: string | undefined;
  
  do {
    const listRes = await client.drive.file.list({
      params: pageToken ? { page_token: pageToken } : {},
    });
    if (listRes.code !== 0) throw new Error(listRes.msg);

    const file = listRes.data?.files?.find((f) => f.token === fileToken);
    if (file) {
      if (!file.type) {
        throw new Error(`File found but no type for ${fileToken}. Please provide the 'type' parameter explicitly.`);
      }
      return file.type;
    }
    
    pageToken = listRes.data?.next_page_token;
  } while (pageToken);

  throw new Error(`File not found: ${fileToken}. Please provide the 'type' parameter explicitly.`);
}

// ============ Import Document Functions ============

/**
 * Import markdown content as a new Feishu document
 * Uses create + write approach for reliable content import.
 * Note: docType parameter is accepted for API compatibility but docx is always used.
 */
async function importDocument(
  client: Lark.Client,
  title: string,
  content: string,
  mediaMaxBytes: number,
  folderToken?: string,
  _docType?: "docx" | "doc",
) {
  return createAndWriteDoc(client, title, content, mediaMaxBytes, folderToken);
}

// ============ Tool Registration ============

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

  api.registerTool(
    {
      name: "feishu_drive",
      label: "Feishu Drive",
      description:
        "Feishu cloud storage operations. Actions: list, info, create_folder, move, delete, import_document. Use 'import_document' to create documents from Markdown with better structure preservation than block-by-block writing.",
      parameters: FeishuDriveSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuDriveParams;
        try {
          return await withFeishuToolClient({
            api,
            toolName: "feishu_drive",
            requiredTool: "drive",
            run: async ({ client, account }) => {
              const mediaMaxBytes = (account.config?.mediaMaxMb ?? 30) * 1024 * 1024;
              switch (p.action) {
                case "list":
                  return json(await listFolder(client, p.folder_token));
                case "info":
                  return json(await getFileInfo(client, p.file_token));
                case "create_folder":
                  return json(await createFolder(client, p.name, p.folder_token));
                case "move":
                  return json(await moveFile(client, p.file_token, p.type, p.folder_token));
                case "delete":
                  return json(await deleteFile(client, p.file_token, p.type));
                case "import_document":
                  return json(
                    await importDocument(
                      client,
                      p.title,
                      p.content,
                      mediaMaxBytes,
                      p.folder_token,
                      (p as any).doc_type || "docx",
                    ),
                  );
                default:
                  return json({ error: `Unknown action: ${(p as any).action}` });
              }
            },
          });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_drive" },
  );

  api.logger.debug?.("feishu_drive: Registered feishu_drive tool");
}
