import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createFeishuClient } from "../client.js";
import type { FeishuConfig } from "../types.js";
import {
  batchDeleteRecords,
  createField,
  createRecord,
  deleteField,
  deleteRecord,
  getRecord,
  listFields,
  listRecords,
  updateField,
  updateRecord,
} from "./actions.js";
import { errorResult, json, type BitableClient } from "./common.js";
import { getBitableMeta } from "./meta.js";
import {
  BatchDeleteRecordsSchema,
  type BatchDeleteRecordsParams,
  CreateFieldSchema,
  type CreateFieldParams,
  CreateRecordSchema,
  type CreateRecordParams,
  DeleteFieldSchema,
  type DeleteFieldParams,
  DeleteRecordSchema,
  type DeleteRecordParams,
  GetMetaSchema,
  type GetMetaParams,
  GetRecordSchema,
  type GetRecordParams,
  ListFieldsSchema,
  type ListFieldsParams,
  ListRecordsSchema,
  type ListRecordsParams,
  UpdateFieldSchema,
  type UpdateFieldParams,
  UpdateRecordSchema,
  type UpdateRecordParams,
} from "./schemas.js";

type ToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  run: (client: BitableClient, params: P) => Promise<unknown>;
};

// Shared registration wrapper keeps all bitable tools consistent:
// same response envelope and same error conversion path.
function registerBitableTool<P>(
  api: OpenClawPluginApi,
  getClient: () => BitableClient,
  spec: ToolSpec<P>,
) {
  api.registerTool(
    {
      name: spec.name,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      async execute(_toolCallId, params) {
        try {
          return json(await spec.run(getClient(), params as P));
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: spec.name },
  );
}

export function registerFeishuBitableTools(api: OpenClawPluginApi) {
  const feishuCfg = api.config?.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
    api.logger.debug?.("feishu_bitable: Feishu credentials not configured, skipping bitable tools");
    return;
  }

  const getClient = () => createFeishuClient(feishuCfg);

  // Keep registration explicit and flat so each tool is easy to locate and modify.
  registerBitableTool<GetMetaParams>(api, getClient, {
    name: "feishu_bitable_get_meta",
    label: "Feishu Bitable Get Meta",
    description:
      "Parse a Bitable URL and get app_token, table_id, and table list. Use this first when given a /wiki/ or /base/ URL.",
    parameters: GetMetaSchema,
    run: (client, { url }) => getBitableMeta(client, url),
  });

  registerBitableTool<ListFieldsParams>(api, getClient, {
    name: "feishu_bitable_list_fields",
    label: "Feishu Bitable List Fields",
    description: "List all fields (columns) in a Bitable table with their types and properties",
    parameters: ListFieldsSchema,
    run: (client, { app_token, table_id }) => listFields(client, app_token, table_id),
  });

  registerBitableTool<ListRecordsParams>(api, getClient, {
    name: "feishu_bitable_list_records",
    label: "Feishu Bitable List Records",
    description: "List records (rows) from a Bitable table with pagination support",
    parameters: ListRecordsSchema,
    run: (client, { app_token, table_id, page_size, page_token }) =>
      listRecords(client, app_token, table_id, page_size, page_token),
  });

  registerBitableTool<CreateFieldParams>(api, getClient, {
    name: "feishu_bitable_create_field",
    label: "Feishu Bitable Create Field",
    description: "Create a new field (column) in a Bitable table",
    parameters: CreateFieldSchema,
    run: (client, { app_token, table_id, field_name, type, property, description, ui_type }) =>
      createField(client, app_token, table_id, {
        field_name,
        type,
        property,
        description,
        ui_type,
      }),
  });

  registerBitableTool<UpdateFieldParams>(api, getClient, {
    name: "feishu_bitable_update_field",
    label: "Feishu Bitable Update Field",
    description: "Update an existing field (column) in a Bitable table",
    parameters: UpdateFieldSchema,
    run: (client, { app_token, table_id, field_id, field_name, type, property, description, ui_type }) =>
      updateField(client, app_token, table_id, field_id, {
        field_name,
        type,
        property,
        description,
        ui_type,
      }),
  });

  registerBitableTool<DeleteFieldParams>(api, getClient, {
    name: "feishu_bitable_delete_field",
    label: "Feishu Bitable Delete Field",
    description: "Delete a field (column) from a Bitable table",
    parameters: DeleteFieldSchema,
    run: (client, { app_token, table_id, field_id }) => deleteField(client, app_token, table_id, field_id),
  });

  registerBitableTool<GetRecordParams>(api, getClient, {
    name: "feishu_bitable_get_record",
    label: "Feishu Bitable Get Record",
    description: "Get a single record by ID from a Bitable table",
    parameters: GetRecordSchema,
    run: (client, { app_token, table_id, record_id }) => getRecord(client, app_token, table_id, record_id),
  });

  registerBitableTool<CreateRecordParams>(api, getClient, {
    name: "feishu_bitable_create_record",
    label: "Feishu Bitable Create Record",
    description: "Create a new record (row) in a Bitable table",
    parameters: CreateRecordSchema,
    run: (client, { app_token, table_id, fields }) => createRecord(client, app_token, table_id, fields),
  });

  registerBitableTool<UpdateRecordParams>(api, getClient, {
    name: "feishu_bitable_update_record",
    label: "Feishu Bitable Update Record",
    description: "Update an existing record (row) in a Bitable table",
    parameters: UpdateRecordSchema,
    run: (client, { app_token, table_id, record_id, fields }) =>
      updateRecord(client, app_token, table_id, record_id, fields),
  });

  registerBitableTool<DeleteRecordParams>(api, getClient, {
    name: "feishu_bitable_delete_record",
    label: "Feishu Bitable Delete Record",
    description: "Delete a single record (row) from a Bitable table",
    parameters: DeleteRecordSchema,
    run: (client, { app_token, table_id, record_id }) => deleteRecord(client, app_token, table_id, record_id),
  });

  registerBitableTool<BatchDeleteRecordsParams>(api, getClient, {
    name: "feishu_bitable_batch_delete_records",
    label: "Feishu Bitable Batch Delete Records",
    description: "Delete multiple records (rows) from a Bitable table in one request",
    parameters: BatchDeleteRecordsSchema,
    run: (client, { app_token, table_id, record_ids }) =>
      batchDeleteRecords(client, app_token, table_id, record_ids),
  });

  api.logger.info?.("feishu_bitable: Registered 11 bitable tools");
}
