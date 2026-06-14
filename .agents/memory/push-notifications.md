---
name: Push Notifications (Web Push)
description: Architecture of the Web Push alert system for favourite asset monitoring
---

## Setup

- VAPID keys stored as env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Keys generated with `web-push` library's `generateVAPIDKeys()`
- Service worker: `artifacts/ewater-app/public/sw.js` (must be at root of BASE_URL)
- SW registration in `artifacts/ewater-app/src/main.tsx` using `${BASE}/sw.js` with `scope: ${BASE}/`

## DB Tables

- `asset_favourites` — starred assets (assetId unique)
- `push_subscriptions` — browser push subscriptions (endpoint unique)
- `alert_rules` — single-row config for all thresholds
- `alert_sent_log` — cooldown tracking per asset+alertType

## Server Routes (monitor.ts)

- `GET/POST /api/ewater/favourites`, `DELETE /api/ewater/favourites/:assetId`
- `GET/PUT /api/ewater/alert-rules`
- `GET /api/ewater/push/vapid-key`, `POST/DELETE /api/ewater/push/subscribe`
- `POST /api/ewater/check-alerts` — manual trigger

## Alert checker

Runs every 5 min via `setInterval` in `artifacts/api-server/src/index.ts`.
Checks: offline/no-comms, low battery, low tank %, low daily flow, high flow anomaly, stuck valve.
Tank height fetched from eWater `/api/Asset/GetESenseChartDataForAsset`.

**Why:** No webhook support in eWater API — must poll.

## Client

- `FavouritesContext` — optimistic-update pattern, wraps the app in App.tsx
- `usePushNotifications` hook — manages SW registration + subscribe/unsubscribe lifecycle
- Alert rules default: offline 48h on, battery 3.5V on, tank 20% on, flow rules off
