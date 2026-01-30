export function formatFeishuMarkdown(text: string): string {
  if (!text) return "";
  
  // Feishu's lark_md doesn't support standard H1/H2/H3 syntax.
  // We convert headers to bold text to maintain visual hierarchy.
  let formatted = text
    .replace(/^# (.*$)/gm, "**$1**")       // H1 -> Bold
    .replace(/^## (.*$)/gm, "**$1**")      // H2 -> Bold
    .replace(/^### (.*$)/gm, "**$1**");    // H3 -> Bold

  return formatted;
}

export function buildFeishuInteractiveCard(params: {
  text: string;
  title?: string;
  template?: string;
}) {
  const { text, title, template } = params;
  
  return {
    config: {
      enable_forward: true,
      update_multi: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: title || "Js Assistant",
      },
      template: template || "blue",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: formatFeishuMarkdown(text),
        },
      },
    ],
  };
}
