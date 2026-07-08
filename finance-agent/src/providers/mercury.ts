/**
 * Mercury balances via the official read-only API.
 * Docs: https://docs.mercury.com/reference/accounts
 *
 * We only ever READ. The token should be scoped read-only in Mercury.
 */

const MERCURY_BASE_URL = "https://api.mercury.com/api/v1";

export interface AccountBalance {
  /** Human-readable account label, e.g. "Mercury Checking ••1234". */
  label: string;
  /** Available balance in USD. Null if Mercury did not return one. */
  available: number | null;
}

interface MercuryAccount {
  id: string;
  name: string;
  accountNumber?: string;
  status?: string;
  kind?: string;
  availableBalance?: number | null;
  currentBalance?: number | null;
}

interface MercuryAccountsResponse {
  accounts: MercuryAccount[];
}

/** Last 4 of the account number, when present, for a friendly label. */
function maskTail(accountNumber?: string): string {
  if (!accountNumber || accountNumber.length < 4) return "";
  return ` ••${accountNumber.slice(-4)}`;
}

export async function getMercuryBalances(token: string): Promise<AccountBalance[]> {
  const res = await fetch(`${MERCURY_BASE_URL}/accounts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    // Avoid leaking the token; surface status only.
    throw new Error(`Mercury API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as MercuryAccountsResponse;

  return (data.accounts ?? [])
    // Skip closed/archived accounts so the report stays clean.
    .filter((a) => (a.status ?? "active").toLowerCase() === "active")
    .map((a) => ({
      label: `${a.name}${maskTail(a.accountNumber)}`,
      available: a.availableBalance ?? a.currentBalance ?? null,
    }));
}
