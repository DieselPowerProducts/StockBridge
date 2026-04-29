# AGENTS.md

Project guidance for coding agents working on StockBridge.

## Project Overview

StockBridge is a Vite + React frontend with an Express API deployed on Vercel.
It helps Diesel Power Products manage product availability, vendor stock checks,
follow-up dates, product notes, and SKU Nexus catalog/vendor data.

The GitHub repo is `DieselPowerProducts/StockBridge`. The main working branch is
usually `main`.

## Stack And Layout

- Frontend: React 19, TypeScript, Vite.
- Backend: Express 5 server under `server/`, exposed through Vercel functions.
- API entrypoint: `api/index.js`.
- Scheduled sync entrypoint: `api/cron/catalog-full-sync.js`.
- Database: Neon Postgres via `@neondatabase/serverless`.
- External systems: SKU Nexus, Shopify, Gmail SMTP.
- Main frontend code:
  - `src/App.tsx`
  - `src/components/notes/NotesModal.tsx`
  - `src/components/products/StockCheckPage.tsx`
  - `src/components/products/ProductsPage.tsx`
  - `src/services/api.ts`
  - `src/types.ts`
  - `src/styles.css`
- Main backend code:
  - `server/app.js`
  - `server/routes/*.routes.js`
  - `server/controllers/*.controller.js`
  - `server/services/*.service.js`
  - `server/services/catalog.service.js`

## Commands

- Install dependencies: `npm install`
- Run dev frontend + API: `npm run dev`
- Frontend only: `npm run dev:web`
- API only: `npm run dev:api`
- Type check: `npm run check`
- Build: `npm run build`
- Test/syntax check suite: `npm test`

Before committing code changes, run at least `npm run check`. For frontend or API
behavior changes, prefer `npm run build` and `npm test` as well.

## Environment Variables

Use `.env.example` as the source of truth for required variables. Do not commit
real secrets.

Important env vars:

- `DATABASE_URL`: Neon database connection string.
- `SKU_NEXUS_BASE_URL`, `SKU_NEXUS_EMAIL`, `SKU_NEXUS_PASSWORD`: SKU Nexus API.
- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`,
  `SHOPIFY_API_VERSION`: Shopify order resolve integration.
- `GMAIL_USER`, `GMAIL_APP_PASSWORD`: Gmail SMTP auth. Use a Gmail app password,
  not the normal account password.
- `GMAIL_FROM_EMAIL`: should be the StockBridge mailbox, currently expected to be
  `stockcheck@dieselpowerproducts.com`.
- `GMAIL_FROM_NAME`: defaults to `StockBridge`.
- `GMAIL_SMTP_HOST`, `GMAIL_SMTP_PORT`, `GMAIL_SMTP_SECURE`: SMTP settings.
- `GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD`: optional mailbox credentials for
  reading vendor inventory CSV emails. If unset, the importer falls back to
  `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
- `GMAIL_IMAP_HOST`, `GMAIL_IMAP_PORT`, `GMAIL_IMAP_SECURE`: IMAP settings.
- `AUTO_INVENTORY_LOOKBACK_DAYS`: how many days of inbox messages the auto
  inventory cron scans.
- `AUTO_INVENTORY_FAILURE_RECIPIENT`: StockBridge notification recipient for
  auto inventory parser/import failures. Defaults to `cade@dieselpowerproducts.com`.
- `AUTO_INVENTORY_GMAIL_LABEL`: Gmail label to apply to vendor inventory CSV
  emails before archiving them from Inbox. Defaults to `Vendor Inventory`.

On Vercel, set env vars in the Vercel project settings for the correct
environment. Redeploy after changing env vars.

## Data And Sync Notes

Catalog data is cached in Neon tables:

- `catalog_products`
- `catalog_product_components`
- `catalog_vendors`
- `catalog_vendor_products`
- `catalog_warehouse_stock`
- `catalog_sync_state`

Vercel cron runs `/api/cron/catalog-full-sync` hourly. The catalog service decides
whether to run a full sync or warehouse sync based on local time in
`CATALOG_SYNC_TIMEZONE` or `America/Los_Angeles`.

Do not scrape all of SKU Nexus for a one-off fix unless the user explicitly asks.
Prefer code changes that allow the scheduled cron to correct data later, or use a
targeted product refresh path for a single SKU.

Inactive SKU Nexus products should not show on the site. Product queries filter
`state` to active locally; sync code stores `state`.

## Product Availability Rules

Key logic lives in `server/services/catalog.service.js`.

- Product availability combines cached DPP warehouse stock quantity and active
  vendor product quantity. Do not use SKU Nexus product-level `qty_available` as
  the availability source when warehouse stock rows are available separately.
- A product with no active vendor can still map to `Available` when quantity is
  zero. This is intentional for products without vendor assignments.
- Built-to-order vendors make unavailable products show `Built to Order`.
- Stock Check excludes `Built to Order` products.
- Kits calculate availability from component availability. Components without a
  vendor assignment should not force the kit to backorder.
- The Notes modal must keep the product table and Stock Check table in sync after
  vendor stock changes and after loading fresh product details. Vendor stock
  changes call a targeted product refresh before emitting `onProductStockChanged`.

When changing availability behavior, check:

- `mapAvailability`
- `getEffectiveQtyAvailable`
- `getEffectiveAvailability`
- `mapProduct`
- `getProductDetails`
- `listStockCheckProducts`
- `src/components/notes/NotesModal.tsx`
- `src/components/products/productStockUpdates.ts`

## Stock Check Behavior

Stock Check is backed by `GET /products/stock-check`.

- It shows backordered products and products with follow-up dates.
- It hides built-to-order products.
- It can show an email icon next to SKUs that have had a vendor stock-check email
  sent.
- The email icon is cleared when the product follow-up date is updated.

Related services:

- `server/services/stockCheckEmails.service.js`
- `server/services/followUps.service.js`
- `server/services/products.service.js`

## Notes Modal

The Notes modal is the main operational UI for a product.

It includes:

- Notes and mentions.
- Follow-up date controls.
- Vendor stock on/off controls.
- Kit/component modal.
- Vendor stock-check email composer.

The modal exists both as an in-app modal and as a route/popup view. Make sure
changes work in both uses.

## Vendor Email Feature

Vendor email code is split across:

- Frontend: `src/components/notes/NotesModal.tsx`
- API client: `src/services/api.ts`
- Routes/controller: `server/routes/email.routes.js`,
  `server/controllers/email.controller.js`
- SMTP: `server/services/email.service.js`
- Templates: `server/services/emailTemplates.service.js`
- Vendor contacts/defaults:
  - `server/services/vendors.service.js`
  - `server/services/vendorDefaultContacts.service.js`
  - `server/routes/vendors.routes.js`
  - `server/controllers/vendors.controller.js`

Vendor contacts are pulled from SKU Nexus `vendorContact`. Always filter out
`shipping@dieselpowerproducts.com`.

Email templates support `{SKU}` replacement in subject and body.

Default vendor contacts are stored in `vendor_default_contacts`. The contacts
endpoint annotates contacts with `isDefault`; the email composer auto-selects
the default contact and shows a "Default contact" badge.

## Vendor Auto Inventory Feature

Vendor auto inventory settings are configured on each vendor page. The button
under the built-to-order controls reads "Add auto inventory" until enabled, then
"Auto inventory settings".

Related code:

- UI: `src/components/vendors/VendorsPage.tsx`,
  `src/components/vendors/VendorProductsTable.tsx`
- Settings table/service: `vendor_auto_inventory_settings`,
  `server/services/vendorAutoInventorySettings.service.js`
- Import history/dedupe: `vendor_auto_inventory_imports`,
  `server/services/vendorAutoInventoryImports.service.js`
- Mailbox/CSV importer: `server/services/autoInventory.service.js`
- Cron: `/api/cron/auto-inventory`

The importer reads CSV attachments from the configured sender email. It maps the
configured SKU header and inventory header. Numerical mode treats any value above
zero as `999999` and zero/blank/unparseable rows are skipped or set to zero as
appropriate. Alphabetical mode uses colon-separated phrases for in-stock and
out-of-stock messages; matching in-stock phrases write `999999`, out-of-stock
phrases write `0`. Commas are tolerated by the parser for convenience, but the UI
should show colon-separated examples.

Parser/import failures notify the configured failure recipient in StockBridge.
Failures include missing configured headers, empty/unreadable CSVs, unrecognized
alphabetical stock phrases, rows with missing SKUs, and SKU Nexus update errors.
Vendor sheets often include SKUs DPP does not sell; unmatched vendor SKUs should
be skipped quietly and should not notify as failures.
The importer adds the Gmail label configured by `AUTO_INVENTORY_GMAIL_LABEL` to
all matching vendor emails with CSV attachments found during the cron run, then
archives them from Inbox so they live under that Gmail label. If multiple
matching emails from the same configured sender are present during one cron run,
only the newest email is imported for that vendor.

## UI Guidance

Keep the app operational and dense rather than marketing-like. It is a work tool.

- Match the existing dark UI.
- Keep controls compact and readable.
- Avoid layout shifts in tables and modal controls.
- For icon buttons, use existing inline SVG style unless the app adopts an icon
  library later.
- Keep dropdowns dark; native select options are styled in `src/styles.css`.

## Coding Conventions

- Prefer existing service/controller/route patterns.
- Keep changes scoped.
- Do not commit generated logs or secrets.
- Use TypeScript types from `src/types.ts`.
- Use server services for persistence and external API logic; controllers should
  stay thin.
- New database-backed services should create their own table lazily with
  `CREATE TABLE IF NOT EXISTS`, following existing services.
- When adding a server service, add it to the `npm test` syntax/require checks if
  appropriate.

## Git Workflow

- Check `git status --short --branch` before edits and before commits.
- Do not revert unrelated user changes.
- The user often wants changes pushed to `main` for Vercel testing. If they ask
  to push, commit intentionally and push `origin main`.
- Good commit messages are short and specific, for example:
  - `Add default vendor contact selection`
  - `Refresh product after vendor stock changes`

## Recent Important Decisions

- Gmail should use an app password.
- Gmail Reply-To is set to `GMAIL_FROM_EMAIL` so replies go back to the StockBridge
  mailbox rather than another authenticated account.
- SKU Nexus inactive products are hidden via code and should be corrected by cron
  over time.
- Vendor stock changes in Notes should refresh the single SKU before updating the
  table to avoid stale availability.
