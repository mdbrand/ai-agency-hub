/**
 * Centralized env loading + validation.
 * Fails fast with a clear message if a required secret is missing,
 * so the cron job never silently posts an empty report.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export const config = {
  mercuryApiToken: required("MERCURY_API_TOKEN"),
  slackWebhookUrl: required("SLACK_WEBHOOK_URL"),
  // Optional, with a sensible default.
  timezone: process.env.TIMEZONE?.trim() || "America/Phoenix",
};
