# Ingestion

RSS pollers (trigger: "something new happened") plus the SaferProducts.gov Recall
API enrichment call (full record) that fires per new item. Mirrors spec Section 2:

- Daily: Recalls for Children RSS + All Recalls RSS
- Weekly: Public Calendar RSS + News Releases RSS
- Monthly: Federal Register API, filtered to CPSC

Intended to run as n8n workflows, not standalone scripts — this folder holds any
supporting code (e.g. a Function node's JS) that's easier to version here than
inside n8n's UI.

Not yet implemented.
