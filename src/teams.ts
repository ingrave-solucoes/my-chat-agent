/* Optional Microsoft Teams alert (Workflows "post to a channel when a webhook request is received"),
   the same channel that receives the website contact form. */

export async function notifyTeams(webhookUrl: string | undefined, card: { title: string; facts: [string, string][]; text?: string; url?: string }) {
  if (!webhookUrl) return;
  const content = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      { type: "TextBlock", text: card.title, weight: "Bolder", size: "Medium", color: "Accent", wrap: true },
      { type: "FactSet", facts: card.facts.filter(([, value]) => value).map(([title, value]) => ({ title, value })) },
      ...(card.text ? [{ type: "TextBlock", text: card.text, wrap: true, spacing: "Medium" }] : []),
    ],
    actions: card.url ? [{ type: "Action.OpenUrl", title: "Abrir na Ingrave", url: card.url }] : [],
  };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content }] }),
  });
  if (!response.ok) throw new Error(`teams → ${response.status}`);
}
