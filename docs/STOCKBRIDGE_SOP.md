# StockBridge Standard Operating Procedure

**Audience:** Diesel Power Products processing and inventory staff
**Last reviewed against the app:** October 8, 2026
**Purpose:** Use StockBridge to review product availability, follow up with vendors, process inventory sheets, and investigate packing lists. StockBridge is an operational view of SKU Nexus, Shopify, the DPP warehouse, and vendor communications. It is not a substitute for checking the underlying order or vendor portal when a result looks inconsistent.

## Before You Start

1. Open the production StockBridge site and sign in with your authorized Google account.
2. Use the left sidebar to open **Products**, **Stock Check**, **Packing Lists**, **Vendors**, **Audit**, or **Sheet Imports**. Browser middle-click or Ctrl-click opens a sidebar page in another tab.
3. Confirm the SKU, vendor, and warehouse quantity before changing availability. A product may have more than one active vendor.
4. Treat availability buttons, vendor stock controls, sheet **Submit**, price-audit **Confirm**, and email **Send** as live actions. They can write to SKU Nexus, Shopify, or the vendor mailbox.
5. If a page has been open during a deployment, it may reload automatically when the new version is detected. Recheck any unsaved entry afterward.

## Recommended Daily Routine

1. Review **Sheet Imports > Pending**. Resolve imports that need a mapping, have missing SKUs, or have parser errors. Clean sheets normally apply automatically.
2. Review **Stock Check** for due follow-ups, then send vendor inquiries or update the product's follow-up date and notes.
3. Review **Audit > Inventory Audit** for vendor replies. Use the response to update the product; do not assume receiving a reply changes availability by itself.
4. Review **Packing Lists** when new manufacturer receipts arrive. Open the linked SKU Nexus orders before changing fulfillment or tracking there.
5. Use **Products** or **Vendors** to investigate individual SKUs and vendor assignments.

## Products and the Notes Window

### Find and inspect a product

1. On **Products**, search by product SKU or name and select the SKU. A SKU elsewhere in StockBridge can also open the same Notes window.
2. Read the product availability, warehouse row, active assigned vendor rows, notes, and follow-up date together. Product availability is an aggregate; a vendor's stock state is only that vendor's state.
3. Use **Refresh** in the Notes window when SKU Nexus was just changed and StockBridge has not caught up. This refreshes the individual product. The normal catalog sync also refreshes data on its schedule.
4. For kits, review **Kit inventory** and component quantities. Kit parents are excluded from Stock Check, but components can appear there. The **Kit Component** button on a component shows its parent kits.

### Record a follow-up or note

1. Select **Follow Up**, choose the date, and wait for the save to finish. The date controls when the SKU appears in the date-based Stock Check views.
2. Record the vendor's answer, ETA, or reason for a decision in **Notes**. Use `@` to mention a teammate when needed.
3. Changing a follow-up date clears the sent-email indicator for that SKU. A saved follow-up or No ETA change also clears a pending Inventory Audit reply for that SKU; capture any useful information from the reply first.
4. **No ETA** applies to a backordered item with a follow-up date. It suppresses the Shopify availability date, not the need to monitor the item. It is unavailable while an active assigned vendor has BTO enabled for that product. Turn that product's vendor BTO off only when the exception is intentional.

### Change availability carefully

| Control | Operational meaning / check |
| --- | --- |
| **In Stock** | Marks the product in stock and clears Shopify availability dates and BTO message. Check the actual warehouse/vendor source before using it. |
| **Backordered** | Marks the product backordered, removes vendor stock, and uses the follow-up date in Shopify unless No ETA is set. It is blocked when DPP warehouse stock exists. |
| **BTO** | Sets Built to Order and its lead-time message when eligible. At least one vendor must be assigned and every assigned vendor and warehouse source must be out of stock. It does not itself turn vendor stock off. |
| **Remove ATC** | Sets Out of Stock and disables Shopify's continue-selling policy for the matching variant. Use only when the item should not be purchasable. |
| **Discontinued** | Read-only in StockBridge. Set or remove Discontinued in Shopify, not here. StockBridge should not overwrite a Shopify Discontinued availability value. |

Shopify updates can be queued after follow-up, stock, or lead-time edits. A brief delay is normal. If the app reports a failed Shopify update, do not assume the storefront changed: verify in Shopify, then retry or escalate. A product can show **Backorder** instead of **Built to Order** when it has an explicit backorder override, another source still has stock, or the BTO requirements are not met.

### Work with vendor assignments

1. Use **Add Vendor** only after confirming the product really belongs to that vendor. An inactive SKU Nexus assignment should not be offered as an active stock source.
2. On a non-warehouse vendor row, the pencil menu can edit the SKU Nexus vendor SKU and product cost. **Save** writes those fields; it is not an inventory update.
3. The pencil menu's **BTO On/Off** switch overrides that vendor's BTO setting for this product only. If the vendor has a default build time, **Lead time** can set a product-specific time; clearing it returns to the vendor default.
4. Vendor stock controls change that vendor assignment. Auto-inventory-managed stock rows are read-only; use the **Auto Inventory** control in the pencil menu to make an intentional per-product exception before manually controlling stock.
5. The envelope on a vendor row opens a single-SKU stock-check email. Select an available contact, verify the recipient, subject, and message, then send. The vendor's configured default contact is selected when available. StockBridge excludes `shipping@dieselpowerproducts.com` from vendor contact choices.

## Stock Check

Stock Check shows qualifying backordered products and products with follow-up dates. It excludes discontinued products, Shopify Collective-managed products, kit parents, and BTO-vendor products that have no follow-up date. A SKU with no assigned vendor can still be listed; check its sources before taking action.

### Sort by SKU

1. Choose **SKU** under **Sort by**.
2. Use **Show** for **Yesterday**, **Today**, **Tomorrow**, **No follow up**, or **All**. Date filters are based on the product's follow-up date, not the date of the last email.
3. Open a SKU to record a note, set a new follow-up date, or email its vendor. The email icon indicates a stock-check email was sent for that SKU since its follow-up date was last changed.

### Sort by Brand and send one email

1. Choose **Brand**, search for the group, and expand it. Here, a “brand” group represents an **active assigned vendor**. A SKU assigned to multiple active vendors can appear in more than one group. **Unassigned** items cannot be bulk-emailed from this view.
2. Set **From** and **Through** for that vendor. Use **No follow-up date** to include undated SKUs; choosing a date turns that checkbox off until you turn it back on.
3. Check the displayed SKUs and select **Email N SKUs**. Choose the contact, verify the subject and message, and send. One email contains the listed SKUs; StockBridge records the send against each SKU.
4. If the list changed while the composer was open, StockBridge stops the send and asks for a refresh. Reopen the group and review the current list.
5. For replies to a bulk email, ask the vendor to put each SKU next to its answer. StockBridge can attach clearly SKU-specific reply lines to Inventory Audit; a generic “all available” reply may not be attributed automatically. Check the mailbox when a reply seems missing.

## Sheet Imports and Auto Inventory

### Understand the tabs

- **Pending:** Sheets requiring attention because of a mapping, parse, missing-SKU, or application issue.
- **History:** Completed/rejected imports and their recorded results. Download the original sheet here when available.
- **Vendors:** Vendors configured for auto inventory. Select one to edit settings; use **+** to add another vendor.

The importer looks for attachments from each configured sender. Clean sheets are staged and applied automatically. Extra SKUs on a vendor sheet that DPP does not sell are skipped; they are not errors. Sheet-specific errors appear in **Pending**, not as StockBridge notifications.

### Resolve a pending sheet

1. Select the import and confirm the vendor, sender, filename, row counts, and error text.
2. Search the original sheet above its table. Use **Download spreadsheet** when you need the complete attachment. The Pending table focuses on the sheet's SKU and inventory columns; the full download is the source document.
3. If the columns are wrong, select **Change column mapping**. Choose the sheet SKU column and stock value column. Use **Quantity to subtract** only for an allocated/committed quantity that must be deducted. Save as the vendor default only if future sheets will use that layout.
4. If a DPP SKU is listed under **Missing SKUs**, search the original sheet and compare the product SKU with its vendor SKU before accepting the exception. If the row really is absent, use the green check beside that SKU, or **OK to all** only after checking the entire list. This creates **missing-from-sheet exceptions** for those vendor products.
5. When the final missing SKU is resolved and there are no other blocking row errors, the sheet should begin applying automatically. Its card can briefly change state or disappear from Pending. Confirm it in **History** before retrying.
6. Use **Retry** to reparse the original attachment after correcting settings or when a transient failure needs another attempt. Manual retries are limited.
7. Use **Submit** only with approval to import usable rows **despite remaining errors**. Rows that could not be parsed or matched are skipped. **Reject** discards the sheet without applying its stock changes.

### Exceptions and quantity quirks

- A **missing-from-sheet exception** means an assigned DPP vendor product was not found on this sheet. Auto inventory stays off for that vendor product until its product SKU or vendor SKU appears on a later sheet, when the exception is removed automatically.
- A **manual exception** means the sheet's availability is not trustworthy for that product. It keeps manual control. If a later sheet's in-stock/out-of-stock state matches that vendor product's manually set state, the manual exception can clear automatically and auto inventory resumes. Recheck intentional exceptions after each new sheet.
- A sheet's stock state is **vendor-specific**, not the combined product availability. Numerical sheets treat positive quantity as in stock; zero and blank stock cells are out of stock for matched rows. Alphabetical sheets use that vendor's configured in-stock/out-of-stock phrases.
- Vendor stock rows managed by auto inventory are read-only in Notes. Their displayed update time helps identify which sheet last controlled them.
- If a sheet looks wrong, verify the sender, headers, stock column, subtractive column, and SKU format before forcing it through.

## Vendors

1. Search **Vendors** and open a vendor to view its assigned products.
2. The vendor-level **Built to Order** toggle and build time affect eligible products assigned to that vendor. A product may override BTO or its time in its Notes pencil menu.
3. Changing a vendor to BTO can clear conflicting No ETA flags on its products. Confirm the intended lead time and spot-check affected products after a broad vendor change.
4. Auto-inventory configuration is under **Sheet Imports > Vendors**, not on this page.

## Packing Lists

1. Enter one or more **stock purchase order numbers**. Separate them with slashes, commas, spaces, semicolons, or line breaks, for example `0075835 / 0080586 / 0095082`.
2. Set **Received from** and **Received through** to the actual receipt window. A PO can have multiple receipt dates, so include the dates relevant to the packing lists in hand.
3. Select **Create report**. Review **Receipts** first to ensure the POs and vendors resolved correctly, then expand **Received parts** to check quantities and source POs. The same SKU from multiple POs is combined while retaining its source PO breakdown.
4. Review the four order groups. Open the linked order or PO in SKU Nexus before making any fulfillment decision. Use **Download CSV** to share or work through the report.

| Group | Meaning |
| --- | --- |
| **Warehouse Fulfillment** | An assigned warehouse fulfillment is still open, including Pick, Pack, or Dispatch. Warehouse tracking is not the deciding factor; Fulfilled is closed. |
| **Vendor Backorder** | An active vendor fulfillment has no tracking and its **assigned fulfillment vendor** currently has no stock, or SKU Nexus has an active backorder when vendor stock cannot be resolved. This may be a different vendor from the one that supplied the packing-list PO. |
| **Missing Tracking** | An active vendor fulfillment has no tracking and was not classified as vendor backorder. |
| **Undecided** | A matching quantity has not been assigned to a warehouse or vendor fulfillment. An order can be “In Fulfillment” overall while one line remains undecided. |

Canceled quantities and completed fulfillment quantities are excluded. Vendor fulfillments with tracking are excluded from the open-problem groups; a missing delivery confirmation is a separate follow-up in SKU Nexus. The report is a snapshot, so recreate it after processing orders or entering tracking.

## Audit and Notifications

- **Audit > Inventory Audit** shows matched vendor stock-check replies with SKU, vendor, and response. Open the SKU, act on the information, and set a follow-up or No ETA as appropriate. Use the row's **X** only to dismiss an irrelevant or already-handled response; it does not update the product.
- **Audit > Price Audit** compares vendor cost proposals. **Confirm** requires a new cost and writes it; **Deny** dismisses the proposal. Verify the source and currency before confirming.
- Notifications are for other system events. Inventory-sheet parse and import problems are handled in **Sheet Imports > Pending**.

## Troubleshooting and Escalation

| Symptom | First checks / action |
| --- | --- |
| Product or vendor assignment looks stale | Use the product's **Refresh**, then check SKU Nexus product state and whether the vendor assignment is active. Nightly sync may not have run yet. |
| SKU keeps appearing in Stock Check | Check whether its follow-up date is due, whether it is still backordered, and whether a recent email indicator was cleared by a date change. A product with no follow-up date may appear under **No follow up**. |
| BTO button will not update Shopify | Check for an assigned vendor, zero stock across every vendor and DPP warehouse source, and any explicit backorder override. Read the error shown in Notes. |
| No ETA is disabled | An active assigned vendor has effective BTO enabled for this product, or no follow-up date is set. |
| Shopify still says Backorder after changing BTO/No ETA | Allow the queued update to run, refresh the product, and verify the Shopify metafield directly. Escalate if the app reports a push failure. |
| Sheet has no detected rows or wrong SKUs | Download the original, check headers and mapping, then **Retry**. Do not use **Submit** to conceal a bad mapping. |
| Missing SKU is visibly on the sheet | Compare the product SKU and vendor SKU, including formatting. Keep the import pending and escalate a likely parser mismatch rather than adding a permanent exception. |
| Sheet remains in Pending after resolving SKUs | Refresh and check whether another parse error remains. Look in History for an applying/completed sheet before retrying. |
| Bulk email reply does not appear in Inventory Audit | Check whether the reply names individual SKUs and whether it matched the original email thread; inspect the stock-check mailbox. |
| Packing List order looks misclassified | Open the order in SKU Nexus and inspect the specific line's decision, fulfillment state, assigned vendor, and tracking. Recreate the report after changes. |

When escalating, include the SKU or PO/order number, the screen and action, the current versus expected state, the exact error text, and whether Shopify or SKU Nexus already shows the change. Do not send passwords, API keys, or customer address details in a StockBridge note.
