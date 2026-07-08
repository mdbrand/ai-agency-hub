/**
 * Report formatting. Pure functions, no I/O — easy to eyeball and test.
 */

import type { AccountBalance } from "./providers/mercury.js";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function money(amount: number | null): string {
  return amount === null ? "n/a" : usd.format(amount);
}

function dateLabel(timezone: string): string {
  // e.g. "6/22"
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
  }).format(new Date());
}

export interface Section {
  /** Section heading, e.g. "Mercury". */
  source: string;
  accounts: AccountBalance[];
  /** Set when the provider failed; the section renders a warning instead. */
  error?: string;
}

/**
 * Builds the Slack message. Resilient by design: a failed section shows a
 * warning line rather than aborting the whole report, and the total only
 * sums the balances we actually retrieved.
 */
export function formatReport(sections: Section[], timezone: string): string {
  const lines: string[] = [`☀️ Cash ${dateLabel(timezone)}`];

  let total = 0;
  let totalIsComplete = true;

  for (const section of sections) {
    if (section.error) {
      lines.push(`⚠️ ${section.source}: unavailable`);
      totalIsComplete = false;
      continue;
    }

    for (const acct of section.accounts) {
      lines.push(`${acct.label}: ${money(acct.available)}`);
      if (acct.available === null) {
        totalIsComplete = false;
      } else {
        total += acct.available;
      }
    }
  }

  lines.push(`Total${totalIsComplete ? "" : " (partial)"}: ${money(total)}`);

  return lines.join("\n");
}
