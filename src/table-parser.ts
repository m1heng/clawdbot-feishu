/**
 * Parse markdown tables and convert them to Feishu card table components.
 *
 * Feishu's card markdown tag does NOT support standard markdown table syntax.
 * Instead, tables must use the dedicated "table" component in the card JSON.
 *
 * This module:
 * 1. Detects markdown tables in text
 * 2. Splits text into segments (markdown text vs tables)
 * 3. Converts table segments into Feishu card table component JSON
 */

export interface FeishuTableColumn {
  name: string;
  display_name: string;
  data_type: "text";
  width: "auto";
}

export interface FeishuTableComponent {
  tag: "table";
  page_size: number;
  row_height: "low" | "medium" | "high";
  header_style: {
    text_align: "center" | "left" | "right";
    text_size: "normal" | "large";
    background_style: "grey" | "none";
    font_weight: "bold" | "normal";
  };
  columns: FeishuTableColumn[];
  rows: Record<string, string>[];
}

export interface MarkdownSegment {
  type: "markdown";
  content: string;
}

export interface TableSegment {
  type: "table";
  component: FeishuTableComponent;
}

export type CardSegment = MarkdownSegment | TableSegment;

/**
 * Regex to match a complete markdown table block.
 * Matches:
 *   | header1 | header2 |
 *   |---------|---------|
 *   | cell1   | cell2   |
 *   ...
 */
const TABLE_BLOCK_RE =
  /(?:^|\n)((?:\|[^\n]+\|\s*\n)\|[-:| ]+\|\s*\n(?:\|[^\n]+\|\s*\n?)*)/g;

/**
 * Parse a single markdown table string into a Feishu table component.
 */
function parseMarkdownTable(tableStr: string): FeishuTableComponent | null {
  const lines = tableStr.trim().split("\n").map((l) => l.trim());
  if (lines.length < 3) return null; // need header + separator + at least 1 row

  // Parse header
  const headerCells = parsePipeRow(lines[0]);
  if (!headerCells || headerCells.length === 0) return null;

  // Verify separator line
  const sepLine = lines[1];
  if (!/^\|[-:| ]+\|$/.test(sepLine)) return null;

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = parsePipeRow(lines[i]);
    if (!cells) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headerCells.length; j++) {
      row[`col_${j}`] = cells[j] ?? "";
    }
    rows.push(row);
  }

  if (rows.length === 0) return null;

  const columns: FeishuTableColumn[] = headerCells.map((header, i) => ({
    name: `col_${i}`,
    display_name: header,
    data_type: "text" as const,
    width: "auto" as const,
  }));

  return {
    tag: "table",
    page_size: Math.max(rows.length, 5),
    row_height: "low",
    header_style: {
      text_align: "center",
      text_size: "normal",
      background_style: "grey",
      font_weight: "bold",
    },
    columns,
    rows,
  };
}

/**
 * Parse a pipe-delimited row: "| a | b | c |" -> ["a", "b", "c"]
 */
function parsePipeRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  // Remove leading/trailing pipes and split
  const inner = trimmed.slice(1, -1);
  return inner.split("|").map((cell) => cell.trim());
}

/**
 * Check if text contains markdown tables.
 */
export function containsMarkdownTable(text: string): boolean {
  return TABLE_BLOCK_RE.test(text);
}

/**
 * Split text into segments of markdown and table components.
 * Non-table parts remain as markdown segments; tables are converted
 * to Feishu table component segments.
 */
export function splitIntoSegments(text: string): CardSegment[] {
  const segments: CardSegment[] = [];

  // Reset regex state
  TABLE_BLOCK_RE.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TABLE_BLOCK_RE.exec(text)) !== null) {
    const tableStr = match[1];
    const matchStart = match.index + (match[0].startsWith("\n") ? 1 : 0);

    // Add preceding markdown text
    const before = text.slice(lastIndex, matchStart).trim();
    if (before) {
      segments.push({ type: "markdown", content: before });
    }

    // Parse and add table
    const tableComponent = parseMarkdownTable(tableStr);
    if (tableComponent) {
      segments.push({ type: "table", component: tableComponent });
    } else {
      // Failed to parse, keep as markdown
      segments.push({ type: "markdown", content: tableStr });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    segments.push({ type: "markdown", content: remaining });
  }

  // Reset regex state
  TABLE_BLOCK_RE.lastIndex = 0;

  return segments;
}

/**
 * Build card elements array from segments.
 * Returns an array of Feishu card elements (markdown + table mixed).
 */
export function buildCardElements(segments: CardSegment[]): Record<string, unknown>[] {
  return segments.map((seg) => {
    if (seg.type === "markdown") {
      return { tag: "markdown", content: seg.content } as Record<string, unknown>;
    }
    return seg.component as unknown as Record<string, unknown>;
  });
}
