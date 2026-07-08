# CBP Job Map

Live map of Cooley Brothers Painting jobs, pulled straight from the "Job Board - Current" board on Monday.com. Pick a month and a status filter; pins show crew leader, contact info, address, customer, job type, dates, and crew size.

## How it works

- `src/lib/monday.ts` queries Monday's GraphQL API for board `736219870` (override with `MONDAY_BOARD_ID`).
- `src/app/api/jobs/route.ts` filters jobs to the requested month + status, geocodes addresses, and attaches crew size.
- `src/lib/geocode.ts` geocodes addresses via OpenStreetMap's Nominatim, caching results in `data/geocode-cache.json` (committed) so repeat lookups are instant. New addresses get geocoded live on first request.
- `data/crew-sizes.json` is a manually-maintained lookup of crew leader name → typical crew size, since Monday doesn't track headcount. Edit this file whenever a crew's size changes.
- `src/components/JobMap.tsx` renders the Leaflet map and per-job popups.

## Setup

```bash
cp .env.example .env.local
# fill in MONDAY_API_TOKEN (Monday.com -> Avatar -> Admin -> API)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Updating crew sizes

Edit `data/crew-sizes.json` — keys must exactly match the crew leader name as it appears in the "Owner" column on the Job Board.

## Deploying

Deployed on Vercel. Set `MONDAY_API_TOKEN` (and optionally `MONDAY_BOARD_ID`) as environment variables in the Vercel project settings — they are not read from `.env.local` in production.
