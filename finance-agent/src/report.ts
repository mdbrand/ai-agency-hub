/**
 * MVP-0 entry point: fetch Mercury balances → format → post to Slack.
 *
 * Resilience: if a provider fails, we still send a report with a warning
 * line instead of going silent. Only a missing config or a failed Slack
 * delivery causes a non-zero exit (so the cron surfaces it).
 *
 * Privacy: we never log balances or secrets.
 */

import { config } from "./config.js";
import { getMercuryBalances } from "./providers/mercury.js";
import { sendSlack } from "./providers/slack.js";
import { formatReport, type Section } from "./format.js";

async function buildMercurySection(): Promise<Section> {
  try {
    const accounts = await getMercuryBalances(config.mercuryApiToken);
    return { source: "Mercury", accounts };
  } catch (err) {
    // Log the error type, not the payload — keeps tokens/balances out of logs.
    console.error(`Mercury fetch failed: ${(err as Error).message}`);
    return { source: "Mercury", accounts: [], error: (err as Error).message };
  }
}

async function main(): Promise<void> {
  const sections: Section[] = [await buildMercurySection()];

  const message = formatReport(sections, config.timezone);

  await sendSlack(config.slackWebhookUrl, message);
  console.log("Report sent to Slack.");
}

main().catch((err) => {
  console.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
