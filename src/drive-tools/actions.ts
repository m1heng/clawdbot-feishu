import { createAndWriteDoc } from "../doc-write-service.js";
import { runDriveApiCall, type DriveClient } from "./common.js";
import type { FeishuDriveParams } from "./schemas.js";

type DriveMoveType = "doc" | "docx" | "sheet" | "bitable" | "folder" | "file" | "mindnote" | "slides";
type DriveDeleteType = DriveMoveType | "shortcut";

async function getFileType(client: DriveClient, fileToken: string): Promise<string> {
  let pageToken: string | undefined;
  
  do {
    const listRes = await runDriveApiCall("drive.file.list", () =>
      client.drive.file.list({
        params: pageToken ? { page_token: pageToken } : {},
      }),
    );

    const file = listRes.data?.files?.find((f: any) => f.token === fileToken);
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

async function getRootFolderToken(client: DriveClient): Promise<string> {
  // Use generic HTTP client to call the root folder meta API
  // as it's not directly exposed in the SDK.
  const domain = (client as any).domain ?? "https://open.feishu.cn";
  const res = await runDriveApiCall("drive.explorer.v2.root_folder.meta", () =>
    (client as any).httpInstance.get(`${domain}/open-apis/drive/explorer/v2/root_folder/meta`) as Promise<{
      code?: number;
      msg?: string;
      data?: { token?: string };
    }>,
  );
  const token = res.data?.token;
  if (!token) throw new Error("Root folder token not found");
  return token;
}

async function listFolder(client: DriveClient, folderToken?: string) {
  // Filter out invalid folder_token values (empty, "0", etc.)
  const validFolderToken = folderToken && folderToken !== "0" ? folderToken : undefined;
  const res = await runDriveApiCall("drive.file.list", () =>
    client.drive.file.list({
      params: validFolderToken ? { folder_token: validFolderToken } : {},
    }),
  );

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

async function getFileInfo(client: DriveClient, fileToken: string, folderToken?: string, type?: string) {
  let effectiveType = type;
  
  if (!effectiveType) {
    let pageToken: string | undefined;
    
    do {
      const res = await runDriveApiCall("drive.file.list", () =>
        client.drive.file.list({
          params: folderToken ? { folder_token: folderToken, page_token: pageToken } : { page_token: pageToken },
        }),
      );

      const file = res.data?.files?.find((f: any) => f.token === fileToken);
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

  let pageToken: string | undefined;
  
  do {
    const res = await runDriveApiCall("drive.file.list", () =>
      client.drive.file.list({
        params: folderToken ? { folder_token: folderToken, page_token: pageToken } : { page_token: pageToken },
      }),
    );

    const file = res.data?.files?.find((f: any) => f.token === fileToken);
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

async function createFolder(client: DriveClient, name: string, folderToken?: string) {
  // Feishu supports using folder_token="0" as the root folder.
  // We try to resolve the real root token (explorer API), but fall back to "0"
  // because some tenants/apps return 400 for that explorer endpoint.
  let effectiveToken = folderToken && folderToken !== "0" ? folderToken : "0";
  if (effectiveToken === "0") {
    try {
      effectiveToken = await getRootFolderToken(client);
    } catch {
      // ignore and keep "0"
    }
  }

  const res = await runDriveApiCall("drive.file.createFolder", () =>
    client.drive.file.createFolder({
      data: {
        name,
        folder_token: effectiveToken,
      },
    }),
  );

  return {
    token: res.data?.token,
    url: res.data?.url,
  };
}

async function moveFile(
  client: DriveClient,
  fileToken: string,
  type: string,
  folderToken: string,
) {
  const res = await runDriveApiCall("drive.file.move", () =>
    client.drive.file.move({
      path: { file_token: fileToken },
      data: {
        type: type as DriveMoveType,
        folder_token: folderToken,
      },
    }),
  );

  return {
    success: true,
    task_id: res.data?.task_id,
  };
}

async function deleteFile(client: DriveClient, fileToken: string, type?: string) {
  let effectiveType = type;
  
  if (!effectiveType) {
    console.log(`[feishu_drive.delete] Auto-detecting type for file_token: ${fileToken}`);
    effectiveType = await getFileType(client, fileToken);
    console.log(`[feishu_drive.delete] Detected type: ${effectiveType}`);
  }
  
  console.log(`[feishu_drive.delete] Deleting file ${fileToken} with type: ${effectiveType}`);
  const res = await runDriveApiCall("drive.file.delete", () =>
    client.drive.file.delete({
      path: { file_token: fileToken },
      params: {
        type: effectiveType as DriveDeleteType,
      },
    }),
  );

  return {
    success: true,
    task_id: res.data?.task_id,
    type_used: effectiveType,
  };
}

/**
 * Import markdown content as a new Feishu document.
 * Uses create + write approach for reliable content import.
 * Note: docType parameter is accepted for API compatibility but docx is always used.
 */
async function importDocument(
  client: DriveClient,
  title: string,
  content: string,
  mediaMaxBytes: number,
  folderToken?: string,
  _docType?: "docx" | "doc",
) {
  return createAndWriteDoc(client, title, content, mediaMaxBytes, folderToken);
}

export async function runDriveAction(
  client: DriveClient,
  params: FeishuDriveParams,
  mediaMaxBytes: number,
) {
  switch (params.action) {
    case "list":
      return listFolder(client, params.folder_token);
    case "info":
      return getFileInfo(client, params.file_token, undefined, (params as any).type);
    case "create_folder":
      return createFolder(client, params.name, params.folder_token);
    case "move":
      return moveFile(client, params.file_token, params.type, params.folder_token);
    case "delete":
      return deleteFile(client, params.file_token, (params as any).type);
    case "import_document":
      return importDocument(
        client,
        params.title,
        params.content,
        mediaMaxBytes,
        params.folder_token,
        params.doc_type || "docx",
      );
    default:
      return { error: `Unknown action: ${(params as any).action}` };
  }
}
