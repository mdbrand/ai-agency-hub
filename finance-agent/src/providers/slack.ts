/**
 * Slack delivery via an Incoming Webhook.
 * One-way POST to a single (private) channel. No bot token, no scopes.
 */

export async function sendSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook error: ${res.status} ${res.statusText} ${body}`.trim());
  }
}
