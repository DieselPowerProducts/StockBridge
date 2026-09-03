const crypto = require("crypto");
const { getSql } = require("../db/neon");
const catalogService = require("./catalog.service");
const importsService = require("./vendorAutoInventoryImports.service");
const productUpdatesService = require("./vendorAutoInventoryProductUpdates.service");

const terminalStatuses = new Set(["applied", "rejected"]);
const maximumManualRetries = 3;
const defaultPageSize = 25;
const maximumPageSize = 100;
let schemaReady;

function normalizeText(value, maximumLength = 10000) {
  return String(value || "").trim().slice(0, maximumLength);
}

function normalizePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value || ""), 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function createAuditId(vendorId, attachmentHash) {
  const digest = crypto
    .createHash("sha256")
    .update(`${normalizeText(vendorId, 500)}\n${normalizeText(attachmentHash, 500)}`)
    .digest("hex");

  return `inventory-sheet-${digest}`;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function mapAuditRow(row) {
  return {
    id: normalizeText(row?.id),
    vendorId: normalizeText(row?.vendor_id),
    vendorName: normalizeText(row?.vendor_name || row?.vendor_id),
    messageUid: normalizeText(row?.message_uid),
    messageId: normalizeText(row?.message_id),
    senderEmail: normalizeText(row?.sender_email),
    subject: normalizeText(row?.subject),
    attachmentFilename: normalizeText(row?.attachment_filename),
    attachmentHash: normalizeText(row?.attachment_hash),
    status: normalizeText(row?.status),
    mapping: parseJson(row?.mapping, {}),
    availableHeaders: parseJson(row?.available_headers, []),
    previewRows: parseJson(row?.preview_rows, []),
    totalRows: Number(row?.total_rows || 0),
    matchedRows: Number(row?.matched_rows || 0),
    changedRows: Number(row?.changed_rows || 0),
    selectedChangedRows: Number(row?.selected_changed_rows || 0),
    unmatchedRows: Number(row?.unmatched_rows || 0),
    missingSkuRows: Number(row?.missing_sku_rows || 0),
    invalidRows: Number(row?.invalid_rows || 0),
    exceptionRows: Number(row?.exception_rows || 0),
    appliedCount: Number(row?.applied_count || 0),
    skippedCount: Number(row?.skipped_count || 0),
    errorCount: Number(row?.error_count || 0),
    errorMessage: normalizeText(row?.error_message),
    manualRetryCount: Number(row?.manual_retry_count || 0),
    reviewedByEmail: normalizeText(row?.reviewed_by_email),
    reviewedByName: normalizeText(row?.reviewed_by_name),
    reviewedAt: row?.reviewed_at || "",
    createdAt: row?.created_at || "",
    updatedAt: row?.updated_at || "",
    isLegacy: Boolean(row?.is_legacy)
  };
}

function mapMissingSkuRow(row) {
  return {
    vendorProductId: normalizeText(row?.vendor_product_id),
    productId: normalizeText(row?.product_id),
    productSku: normalizeText(row?.product_sku),
    vendorSku: normalizeText(row?.vendor_sku),
    resolved: Boolean(row?.resolved),
    resolvedAt: row?.resolved_at || ""
  };
}

function mapProposalRow(row) {
  return {
    rowNumber: Number(row?.row_number || 0),
    vendorProductId: normalizeText(row?.vendor_product_id),
    productId: normalizeText(row?.product_id),
    productSku: normalizeText(row?.product_sku),
    vendorSku: normalizeText(row?.vendor_sku),
    sheetSku: normalizeText(row?.sheet_sku),
    inventoryValue: normalizeText(row?.inventory_value),
    subtractiveValue: normalizeText(row?.subtractive_value),
    currentQuantity: Number(row?.current_quantity || 0),
    proposedQuantity: Number(row?.proposed_quantity || 0),
    previousSheetQuantity:
      row?.previous_sheet_quantity === null ||
      row?.previous_sheet_quantity === undefined
        ? null
        : Number(row.previous_sheet_quantity),
    sheetQuantity:
      row?.sheet_quantity === null || row?.sheet_quantity === undefined
        ? null
        : Number(row.sheet_quantity),
    changeRequired: Boolean(row?.change_required),
    selected: row?.selected !== false,
    status: normalizeText(row?.status),
    errorMessage: normalizeText(row?.error_message)
  };
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await Promise.all([
        catalogService.initializeCatalogSchema(),
        importsService.initializeSchema(),
        productUpdatesService.initializeSchema()
      ]);
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS vendor_auto_inventory_audits (
          id TEXT PRIMARY KEY,
          vendor_id TEXT NOT NULL DEFAULT '',
          message_uid TEXT NOT NULL DEFAULT '',
          message_id TEXT NOT NULL DEFAULT '',
          sender_email TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          attachment_filename TEXT NOT NULL DEFAULT '',
          attachment_hash TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'ready_for_review',
          mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
          available_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
          preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
          total_rows INTEGER NOT NULL DEFAULT 0,
          matched_rows INTEGER NOT NULL DEFAULT 0,
          changed_rows INTEGER NOT NULL DEFAULT 0,
          selected_changed_rows INTEGER NOT NULL DEFAULT 0,
          unmatched_rows INTEGER NOT NULL DEFAULT 0,
          missing_sku_rows INTEGER NOT NULL DEFAULT 0,
          invalid_rows INTEGER NOT NULL DEFAULT 0,
          exception_rows INTEGER NOT NULL DEFAULT 0,
          applied_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          error_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT NOT NULL DEFAULT '',
          manual_retry_count INTEGER NOT NULL DEFAULT 0,
          reviewed_by_email TEXT NOT NULL DEFAULT '',
          reviewed_by_name TEXT NOT NULL DEFAULT '',
          reviewed_at TIMESTAMPTZ,
          is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (vendor_id, attachment_hash)
        )
      `;
      await sql`
        ALTER TABLE vendor_auto_inventory_audits
        ADD COLUMN IF NOT EXISTS missing_sku_rows INTEGER NOT NULL DEFAULT 0
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS vendor_auto_inventory_audit_missing_skus (
          audit_id TEXT NOT NULL REFERENCES vendor_auto_inventory_audits(id) ON DELETE CASCADE,
          vendor_product_id TEXT NOT NULL,
          product_id TEXT NOT NULL DEFAULT '',
          product_sku TEXT NOT NULL DEFAULT '',
          vendor_sku TEXT NOT NULL DEFAULT '',
          resolved BOOLEAN NOT NULL DEFAULT FALSE,
          resolved_at TIMESTAMPTZ,
          PRIMARY KEY (audit_id, vendor_product_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS vendor_auto_inventory_audit_rows (
          audit_id TEXT NOT NULL REFERENCES vendor_auto_inventory_audits(id) ON DELETE CASCADE,
          row_number INTEGER NOT NULL,
          vendor_product_id TEXT NOT NULL DEFAULT '',
          product_id TEXT NOT NULL DEFAULT '',
          product_sku TEXT NOT NULL DEFAULT '',
          vendor_sku TEXT NOT NULL DEFAULT '',
          sheet_sku TEXT NOT NULL DEFAULT '',
          inventory_value TEXT NOT NULL DEFAULT '',
          subtractive_value TEXT NOT NULL DEFAULT '',
          current_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
          proposed_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
          previous_sheet_quantity DOUBLE PRECISION,
          sheet_quantity DOUBLE PRECISION,
          change_required BOOLEAN NOT NULL DEFAULT FALSE,
          selected BOOLEAN NOT NULL DEFAULT TRUE,
          status TEXT NOT NULL DEFAULT 'matched',
          error_message TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (audit_id, row_number)
        )
      `;
      await sql`
        ALTER TABLE vendor_auto_inventory_audits
        ADD COLUMN IF NOT EXISTS selected_changed_rows INTEGER NOT NULL DEFAULT 0
      `;
      await sql`
        ALTER TABLE vendor_auto_inventory_audits
        ADD COLUMN IF NOT EXISTS preview_rows JSONB NOT NULL DEFAULT '[]'::jsonb
      `;
      await sql`
        ALTER TABLE vendor_auto_inventory_audit_rows
        ADD COLUMN IF NOT EXISTS selected BOOLEAN NOT NULL DEFAULT TRUE
      `;
      await sql`
        ALTER TABLE vendor_auto_inventory_audit_rows
        ADD COLUMN IF NOT EXISTS previous_sheet_quantity DOUBLE PRECISION
      `;
      await sql`
        UPDATE vendor_auto_inventory_audit_rows AS proposal
        SET previous_sheet_quantity = previous.quantity
        FROM vendor_auto_inventory_audits AS audit,
          vendor_auto_inventory_product_updates AS previous
        WHERE proposal.audit_id = audit.id
          AND proposal.vendor_product_id = previous.vendor_product_id
          AND proposal.previous_sheet_quantity IS NULL
          AND audit.is_legacy = FALSE
          AND audit.status IN ('ready_for_review', 'needs_mapping', 'failed', 'retrying')
      `;
      await sql`
        UPDATE vendor_auto_inventory_audits AS audit
        SET selected_changed_rows = counts.selected_count
        FROM (
          SELECT
            audit_id,
            COUNT(*) FILTER (
              WHERE change_required = TRUE AND selected = TRUE
            )::integer AS selected_count
          FROM vendor_auto_inventory_audit_rows
          GROUP BY audit_id
        ) AS counts
        WHERE audit.id = counts.audit_id
          AND audit.is_legacy = FALSE
          AND audit.status IN ('ready_for_review', 'needs_mapping', 'failed', 'retrying')
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS vendor_auto_inventory_audits_status_idx
        ON vendor_auto_inventory_audits (status, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS vendor_auto_inventory_audit_rows_change_idx
        ON vendor_auto_inventory_audit_rows (audit_id, change_required, row_number)
      `;

      // Preserve the summary-level history that existed before sheet review.
      await sql`
        INSERT INTO vendor_auto_inventory_audits (
          id,
          vendor_id,
          message_uid,
          message_id,
          sender_email,
          attachment_filename,
          attachment_hash,
          status,
          applied_count,
          skipped_count,
          error_count,
          error_message,
          reviewed_at,
          is_legacy,
          created_at,
          updated_at
        )
        SELECT
          'legacy-inventory-import-' || legacy.id::text,
          legacy.vendor_id,
          legacy.message_uid,
          legacy.message_id,
          legacy.sender_email,
          legacy.attachment_filename,
          legacy.attachment_hash,
          CASE
            WHEN legacy.status = 'failed' THEN 'failed'
            ELSE 'applied'
          END,
          legacy.imported_count,
          legacy.skipped_count,
          legacy.error_count,
          legacy.error_message,
          COALESCE(legacy.last_seen_at, legacy.created_at),
          TRUE,
          legacy.created_at,
          COALESCE(legacy.last_seen_at, legacy.created_at)
        FROM vendor_auto_inventory_imports AS legacy
        ON CONFLICT DO NOTHING
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

async function getAuditRecord(auditId) {
  await initializeSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT audit.*, COALESCE(NULLIF(vendor.name, ''), NULLIF(vendor.label, ''), audit.vendor_id) AS vendor_name
    FROM vendor_auto_inventory_audits AS audit
    LEFT JOIN catalog_vendors AS vendor ON vendor.vendor_id = audit.vendor_id
    WHERE audit.id = ${normalizeText(auditId, 500)}
    LIMIT 1
  `;

  return rows[0] ? mapAuditRow(rows[0]) : null;
}

async function getAuditByAttachment(vendorId, attachmentHash) {
  await initializeSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT audit.*, COALESCE(NULLIF(vendor.name, ''), NULLIF(vendor.label, ''), audit.vendor_id) AS vendor_name
    FROM vendor_auto_inventory_audits AS audit
    LEFT JOIN catalog_vendors AS vendor ON vendor.vendor_id = audit.vendor_id
    WHERE audit.vendor_id = ${normalizeText(vendorId, 500)}
      AND audit.attachment_hash = ${normalizeText(attachmentHash, 500)}
    LIMIT 1
  `;

  return rows[0] ? mapAuditRow(rows[0]) : null;
}

async function stageAudit(input, proposalRows = [], missingSkuRows = []) {
  await initializeSchema();
  const sql = getSql();
  const vendorId = normalizeText(input?.vendorId, 500);
  const attachmentHash = normalizeText(input?.attachmentHash, 500);
  const generatedAuditId = createAuditId(vendorId, attachmentHash);
  const existing = await getAuditByAttachment(vendorId, attachmentHash);
  const auditId = existing?.id || generatedAuditId;

  if (existing && terminalStatuses.has(existing.status)) {
    return { ...existing, duplicate: true };
  }

  const status = normalizeText(input?.status, 100) || "ready_for_review";
  const rows = await sql`
    INSERT INTO vendor_auto_inventory_audits (
      id,
      vendor_id,
      message_uid,
      message_id,
      sender_email,
      subject,
      attachment_filename,
      attachment_hash,
      status,
      mapping,
      available_headers,
      preview_rows,
      total_rows,
      matched_rows,
      changed_rows,
      selected_changed_rows,
      unmatched_rows,
      missing_sku_rows,
      invalid_rows,
      exception_rows,
      error_count,
      error_message,
      updated_at
    )
    VALUES (
      ${auditId},
      ${vendorId},
      ${normalizeText(input?.messageUid, 1000)},
      ${normalizeText(input?.messageId, 1000)},
      ${normalizeText(input?.senderEmail, 1000).toLowerCase()},
      ${normalizeText(input?.subject)},
      ${normalizeText(input?.attachmentFilename, 2000)},
      ${attachmentHash},
      ${status},
      ${JSON.stringify(input?.mapping || {})}::jsonb,
      ${JSON.stringify(input?.availableHeaders || [])}::jsonb,
      ${JSON.stringify(input?.previewRows || [])}::jsonb,
      ${Math.max(Number(input?.totalRows || 0), 0)},
      ${Math.max(Number(input?.matchedRows || 0), 0)},
      ${Math.max(Number(input?.changedRows || 0), 0)},
      ${Math.max(Number(input?.selectedChangedRows ?? input?.changedRows ?? 0), 0)},
      ${Math.max(Number(input?.unmatchedRows || 0), 0)},
      ${Math.max(Number(input?.missingSkuRows ?? missingSkuRows.length), 0)},
      ${Math.max(Number(input?.invalidRows || 0), 0)},
      ${Math.max(Number(input?.exceptionRows || 0), 0)},
      ${Math.max(Number(input?.errorCount || 0), 0)},
      ${normalizeText(input?.errorMessage)},
      now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      message_uid = EXCLUDED.message_uid,
      message_id = EXCLUDED.message_id,
      sender_email = EXCLUDED.sender_email,
      subject = EXCLUDED.subject,
      attachment_filename = EXCLUDED.attachment_filename,
      status = EXCLUDED.status,
      mapping = EXCLUDED.mapping,
      available_headers = EXCLUDED.available_headers,
      preview_rows = EXCLUDED.preview_rows,
      total_rows = EXCLUDED.total_rows,
      matched_rows = EXCLUDED.matched_rows,
      changed_rows = EXCLUDED.changed_rows,
      selected_changed_rows = EXCLUDED.selected_changed_rows,
      unmatched_rows = EXCLUDED.unmatched_rows,
      missing_sku_rows = EXCLUDED.missing_sku_rows,
      invalid_rows = EXCLUDED.invalid_rows,
      exception_rows = EXCLUDED.exception_rows,
      error_count = EXCLUDED.error_count,
      error_message = EXCLUDED.error_message,
      is_legacy = FALSE,
      updated_at = now()
    RETURNING *
  `;

  await sql`DELETE FROM vendor_auto_inventory_audit_rows WHERE audit_id = ${auditId}`;
  await sql`DELETE FROM vendor_auto_inventory_audit_missing_skus WHERE audit_id = ${auditId}`;

  if (proposalRows.length > 0) {
    const normalizedRows = proposalRows.map((row, index) => ({
      row_number: Math.max(Number(row?.rowNumber || index + 1), 1),
      vendor_product_id: normalizeText(row?.vendorProductId, 1000),
      product_id: normalizeText(row?.productId, 1000),
      product_sku: normalizeText(row?.productSku, 1000),
      vendor_sku: normalizeText(row?.vendorSku, 1000),
      sheet_sku: normalizeText(row?.sheetSku, 1000),
      inventory_value: normalizeText(row?.inventoryValue, 2000),
      subtractive_value: normalizeText(row?.subtractiveValue, 2000),
      current_quantity: Number(row?.currentQuantity || 0),
      proposed_quantity: Number(row?.proposedQuantity || 0),
      previous_sheet_quantity:
        row?.previousSheetQuantity === null ||
        row?.previousSheetQuantity === undefined
          ? null
          : Number(row.previousSheetQuantity),
      sheet_quantity:
        row?.sheetQuantity === null || row?.sheetQuantity === undefined
          ? null
          : Number(row.sheetQuantity),
      change_required: Boolean(row?.changeRequired),
      selected: row?.selected !== false,
      status: normalizeText(row?.status, 100) || "matched",
      error_message: normalizeText(row?.errorMessage)
    }));

    await sql.query(
      `
        INSERT INTO vendor_auto_inventory_audit_rows (
          audit_id,
          row_number,
          vendor_product_id,
          product_id,
          product_sku,
          vendor_sku,
          sheet_sku,
          inventory_value,
          subtractive_value,
          current_quantity,
          proposed_quantity,
          previous_sheet_quantity,
          sheet_quantity,
          change_required,
          selected,
          status,
          error_message
        )
        SELECT
          $1,
          proposal.row_number,
          proposal.vendor_product_id,
          proposal.product_id,
          proposal.product_sku,
          proposal.vendor_sku,
          proposal.sheet_sku,
          proposal.inventory_value,
          proposal.subtractive_value,
          proposal.current_quantity,
          proposal.proposed_quantity,
          proposal.previous_sheet_quantity,
          proposal.sheet_quantity,
          proposal.change_required,
          proposal.selected,
          proposal.status,
          proposal.error_message
        FROM jsonb_to_recordset($2::jsonb) AS proposal(
          row_number integer,
          vendor_product_id text,
          product_id text,
          product_sku text,
          vendor_sku text,
          sheet_sku text,
          inventory_value text,
          subtractive_value text,
          current_quantity double precision,
          proposed_quantity double precision,
          previous_sheet_quantity double precision,
          sheet_quantity double precision,
          change_required boolean,
          selected boolean,
          status text,
          error_message text
        )
      `,
      [auditId, JSON.stringify(normalizedRows)]
    );
  }

  if (missingSkuRows.length > 0) {
    const normalizedMissingRows = missingSkuRows.map((row) => ({
      vendor_product_id: normalizeText(row?.vendorProductId, 1000),
      product_id: normalizeText(row?.productId, 1000),
      product_sku: normalizeText(row?.productSku, 1000),
      vendor_sku: normalizeText(row?.vendorSku, 1000)
    }));

    await sql.query(
      `
        INSERT INTO vendor_auto_inventory_audit_missing_skus (
          audit_id,
          vendor_product_id,
          product_id,
          product_sku,
          vendor_sku
        )
        SELECT
          $1,
          missing.vendor_product_id,
          missing.product_id,
          missing.product_sku,
          missing.vendor_sku
        FROM jsonb_to_recordset($2::jsonb) AS missing(
          vendor_product_id text,
          product_id text,
          product_sku text,
          vendor_sku text
        )
      `,
      [auditId, JSON.stringify(normalizedMissingRows)]
    );
  }

  return {
    ...mapAuditRow(rows[0]),
    duplicate: Boolean(existing)
  };
}

async function listAudits({ page, limit, search, view = "pending" } = {}) {
  await initializeSchema();
  const sql = getSql();
  const safePage = normalizePositiveInteger(page, 1);
  const safeLimit = normalizePositiveInteger(limit, defaultPageSize, maximumPageSize);
  const offset = (safePage - 1) * safeLimit;
  const safeSearch = normalizeText(search, 500);
  const searchPattern = `%${safeSearch}%`;
  const safeView = ["pending", "history", "all"].includes(view) ? view : "pending";
  const rows = await sql.query(
    `
      SELECT
        audit.*,
        COALESCE(NULLIF(vendor.name, ''), NULLIF(vendor.label, ''), audit.vendor_id) AS vendor_name,
        COUNT(*) OVER()::int AS total_count
      FROM vendor_auto_inventory_audits AS audit
      LEFT JOIN catalog_vendors AS vendor ON vendor.vendor_id = audit.vendor_id
      WHERE (
        $1 = 'all'
        OR (
          $1 = 'pending'
          AND audit.is_legacy = FALSE
          AND (
            audit.status IN ('ready_for_review', 'needs_mapping', 'retrying')
            OR (audit.status = 'failed' AND audit.manual_retry_count < ${maximumManualRetries})
          )
        )
        OR (
          $1 = 'history'
          AND (
            audit.is_legacy = TRUE
            OR audit.status IN ('applied', 'rejected')
            OR (audit.status = 'failed' AND audit.manual_retry_count >= ${maximumManualRetries})
          )
        )
      )
      AND (
        $2 = ''
        OR audit.vendor_id ILIKE $3
        OR vendor.name ILIKE $3
        OR vendor.label ILIKE $3
        OR audit.sender_email ILIKE $3
        OR audit.subject ILIKE $3
        OR audit.attachment_filename ILIKE $3
        OR audit.status ILIKE $3
      )
      ORDER BY audit.updated_at DESC, audit.id DESC
      LIMIT $4 OFFSET $5
    `,
    [safeView, safeSearch, searchPattern, safeLimit, offset]
  );
  const total = Number(rows[0]?.total_count || 0);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    data: rows.map(mapAuditRow),
    total,
    totalPages,
    isLastPage: safePage >= totalPages
  };
}

async function getAuditDetails(auditId, { rowPage, rowLimit } = {}) {
  const audit = await getAuditRecord(auditId);

  if (!audit) {
    const error = new Error("Inventory sheet audit not found.");
    error.statusCode = 404;
    throw error;
  }

  const safePage = normalizePositiveInteger(rowPage, 1);
  const safeLimit = normalizePositiveInteger(rowLimit, 100, 500);
  const offset = (safePage - 1) * safeLimit;
  const sql = getSql();

  if (
    !audit.isLegacy &&
    ["ready_for_review", "needs_mapping", "failed", "retrying"].includes(
      audit.status
    )
  ) {
    await sql`
      UPDATE vendor_auto_inventory_audit_rows AS proposal
      SET previous_sheet_quantity = previous.quantity
      FROM vendor_auto_inventory_product_updates AS previous
      WHERE proposal.audit_id = ${audit.id}
        AND proposal.vendor_product_id = previous.vendor_product_id
        AND proposal.previous_sheet_quantity IS NULL
    `;
    await sql`
      UPDATE vendor_auto_inventory_audit_rows
      SET previous_sheet_quantity = current_quantity
      WHERE audit_id = ${audit.id}
        AND previous_sheet_quantity IS NULL
    `;
  }

  const rows = await sql.query(
    `
      SELECT proposal.*, COUNT(*) OVER()::int AS total_count
      FROM vendor_auto_inventory_audit_rows AS proposal
      WHERE proposal.audit_id = $1
      ORDER BY proposal.change_required DESC, proposal.selected DESC, proposal.row_number ASC
      LIMIT $2 OFFSET $3
    `,
    [audit.id, safeLimit, offset]
  );
  const totalRows = Number(rows[0]?.total_count || 0);
  const missingSkuRows = audit.isLegacy
    ? []
    : await sql`
        SELECT *
        FROM vendor_auto_inventory_audit_missing_skus
        WHERE audit_id = ${audit.id}
          AND resolved = FALSE
        ORDER BY product_sku ASC, vendor_sku ASC
      `;

  return {
    ...audit,
    missingSkus: missingSkuRows.map(mapMissingSkuRow),
    rows: rows.map(mapProposalRow),
    rowPage: safePage,
    rowTotal: totalRows,
    rowTotalPages: Math.max(1, Math.ceil(totalRows / safeLimit))
  };
}

async function getProposalRows(auditId) {
  await initializeSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT *
    FROM vendor_auto_inventory_audit_rows
    WHERE audit_id = ${normalizeText(auditId, 500)}
    ORDER BY row_number ASC
  `;

  return rows.map(mapProposalRow);
}

async function saveAuditPreview(auditId, availableHeaders, previewRows) {
  await initializeSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE vendor_auto_inventory_audits
    SET
      available_headers = ${JSON.stringify(availableHeaders || [])}::jsonb,
      preview_rows = ${JSON.stringify(previewRows || [])}::jsonb
    WHERE id = ${normalizeText(auditId, 500)}
      AND is_legacy = FALSE
    RETURNING *
  `;

  if (!rows[0]) {
    const error = new Error("Inventory sheet audit not found.");
    error.statusCode = 404;
    throw error;
  }

  return mapAuditRow(rows[0]);
}

async function updateAuditMapping(auditId, mapping) {
  const audit = await getAuditRecord(auditId);

  if (
    !audit ||
    audit.isLegacy ||
    !["ready_for_review", "needs_mapping", "failed"].includes(audit.status)
  ) {
    const error = new Error(
      audit
        ? "This inventory sheet mapping cannot be changed now."
        : "Inventory sheet audit not found."
    );
    error.statusCode = audit ? 409 : 404;
    throw error;
  }

  const nextMapping = {
    ...audit.mapping,
    skuHeader: normalizeText(mapping?.skuHeader, 1000),
    inventoryHeader: normalizeText(mapping?.inventoryHeader, 1000),
    subtractiveColumn: normalizeText(mapping?.subtractiveColumn, 1000)
  };
  const sql = getSql();
  const rows = await sql`
    WITH updated AS (
      UPDATE vendor_auto_inventory_audits
      SET
        mapping = ${JSON.stringify(nextMapping)}::jsonb,
        status = 'retrying',
        total_rows = 0,
        matched_rows = 0,
        changed_rows = 0,
        selected_changed_rows = 0,
        unmatched_rows = 0,
        missing_sku_rows = 0,
        invalid_rows = 0,
        exception_rows = 0,
        applied_count = 0,
        skipped_count = 0,
        error_count = 0,
        error_message = '',
        updated_at = now()
      WHERE id = ${audit.id}
        AND status IN ('ready_for_review', 'needs_mapping', 'failed')
        AND is_legacy = FALSE
      RETURNING id
    ), deleted AS (
      DELETE FROM vendor_auto_inventory_audit_rows
      WHERE audit_id IN (SELECT id FROM updated)
      RETURNING audit_id
    ), deleted_missing AS (
      DELETE FROM vendor_auto_inventory_audit_missing_skus
      WHERE audit_id IN (SELECT id FROM updated)
      RETURNING audit_id
    )
    SELECT id FROM updated
  `;

  if (!rows[0]) {
    const error = new Error("This inventory sheet mapping changed elsewhere.");
    error.statusCode = 409;
    throw error;
  }

  return getAuditRecord(audit.id);
}

async function resolveMissingSku(auditId, vendorProductId) {
  await initializeSchema();
  const sql = getSql();
  const safeAuditId = normalizeText(auditId, 500);
  const safeVendorProductId = normalizeText(vendorProductId, 1000);
  const rows = await sql`
    UPDATE vendor_auto_inventory_audit_missing_skus AS missing
    SET resolved = TRUE, resolved_at = now()
    FROM vendor_auto_inventory_audits AS audit
    WHERE missing.audit_id = ${safeAuditId}
      AND missing.vendor_product_id = ${safeVendorProductId}
      AND audit.id = missing.audit_id
      AND audit.status = 'ready_for_review'
      AND audit.is_legacy = FALSE
    RETURNING missing.*
  `;

  if (!rows[0]) {
    const error = new Error("This missing SKU is no longer available for review.");
    error.statusCode = 409;
    throw error;
  }

  await sql`
    UPDATE vendor_auto_inventory_audits
    SET
      missing_sku_rows = (
        SELECT COUNT(*)::integer
        FROM vendor_auto_inventory_audit_missing_skus
        WHERE audit_id = ${safeAuditId}
          AND resolved = FALSE
      ),
      updated_at = now()
    WHERE id = ${safeAuditId}
  `;

  return mapMissingSkuRow(rows[0]);
}

async function getUnresolvedMissingSkus(auditId) {
  await initializeSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT missing.*
    FROM vendor_auto_inventory_audit_missing_skus AS missing
    JOIN vendor_auto_inventory_audits AS audit ON audit.id = missing.audit_id
    WHERE missing.audit_id = ${normalizeText(auditId, 500)}
      AND missing.resolved = FALSE
      AND audit.status = 'ready_for_review'
      AND audit.is_legacy = FALSE
    ORDER BY missing.product_sku ASC, missing.vendor_sku ASC
  `;

  return rows.map(mapMissingSkuRow);
}

async function resolveAllMissingSkus(auditId) {
  await initializeSchema();
  const sql = getSql();
  const safeAuditId = normalizeText(auditId, 500);
  const rows = await sql`
    UPDATE vendor_auto_inventory_audit_missing_skus AS missing
    SET resolved = TRUE, resolved_at = now()
    FROM vendor_auto_inventory_audits AS audit
    WHERE missing.audit_id = ${safeAuditId}
      AND missing.resolved = FALSE
      AND audit.id = missing.audit_id
      AND audit.status = 'ready_for_review'
      AND audit.is_legacy = FALSE
    RETURNING missing.*
  `;

  if (rows.length === 0) {
    const error = new Error("There are no unresolved missing SKUs to approve.");
    error.statusCode = 409;
    throw error;
  }

  await sql`
    UPDATE vendor_auto_inventory_audits
    SET missing_sku_rows = 0, updated_at = now()
    WHERE id = ${safeAuditId}
  `;

  return rows.map(mapMissingSkuRow);
}

async function updateProposalSelection(auditId, rowNumber, selected) {
  await initializeSchema();
  const safeAuditId = normalizeText(auditId, 500);
  const safeRowNumber = Number.parseInt(String(rowNumber || ""), 10);

  if (!Number.isFinite(safeRowNumber) || safeRowNumber < 1) {
    const error = new Error("A valid sheet row is required.");
    error.statusCode = 400;
    throw error;
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE vendor_auto_inventory_audit_rows AS proposal
    SET
      selected = ${Boolean(selected)},
      status = ${selected ? "matched" : "excluded"}
    FROM vendor_auto_inventory_audits AS audit
    WHERE proposal.audit_id = ${safeAuditId}
      AND proposal.row_number = ${safeRowNumber}
      AND audit.id = proposal.audit_id
      AND audit.status = 'ready_for_review'
      AND audit.is_legacy = FALSE
    RETURNING proposal.*
  `;

  if (!rows[0]) {
    const audit = await getAuditRecord(safeAuditId);
    const error = new Error(
      audit
        ? "This row cannot be changed after the sheet leaves review."
        : "Inventory sheet audit not found."
    );
    error.statusCode = audit ? 409 : 404;
    throw error;
  }

  await sql`
    UPDATE vendor_auto_inventory_audits
    SET
      selected_changed_rows = (
        SELECT COUNT(*)::integer
        FROM vendor_auto_inventory_audit_rows
        WHERE audit_id = ${safeAuditId}
          AND change_required = TRUE
          AND selected = TRUE
      ),
      updated_at = now()
    WHERE id = ${safeAuditId}
  `;

  return {
    audit: await getAuditRecord(safeAuditId),
    row: mapProposalRow(rows[0])
  };
}

function formatReviewer(user) {
  return {
    email: normalizeText(user?.email, 1000).toLowerCase(),
    name: normalizeText(user?.name || user?.email, 1000)
  };
}

async function setStatus(auditId, status, fields = {}) {
  await initializeSchema();
  const sql = getSql();
  const reviewer = formatReviewer(fields.reviewer);
  const hasAppliedCount = fields.appliedCount !== undefined;
  const hasSkippedCount = fields.skippedCount !== undefined;
  const hasErrorCount = fields.errorCount !== undefined;
  const hasErrorMessage = fields.errorMessage !== undefined;
  const rows = await sql`
    UPDATE vendor_auto_inventory_audits
    SET
      status = ${normalizeText(status, 100)},
      applied_count = CASE
        WHEN ${hasAppliedCount}
        THEN ${Math.max(Number(fields.appliedCount || 0), 0)}
        ELSE applied_count
      END,
      skipped_count = CASE
        WHEN ${hasSkippedCount}
        THEN ${Math.max(Number(fields.skippedCount || 0), 0)}
        ELSE skipped_count
      END,
      error_count = CASE
        WHEN ${hasErrorCount}
        THEN ${Math.max(Number(fields.errorCount || 0), 0)}
        ELSE error_count
      END,
      error_message = CASE
        WHEN ${hasErrorMessage}
        THEN ${normalizeText(fields.errorMessage)}
        ELSE error_message
      END,
      reviewed_by_email = CASE
        WHEN ${reviewer.email} <> '' THEN ${reviewer.email}
        ELSE reviewed_by_email
      END,
      reviewed_by_name = CASE
        WHEN ${reviewer.name} <> '' THEN ${reviewer.name}
        ELSE reviewed_by_name
      END,
      reviewed_at = CASE
        WHEN ${Boolean(fields.reviewed)} THEN now()
        ELSE reviewed_at
      END,
      updated_at = now()
    WHERE id = ${normalizeText(auditId, 500)}
    RETURNING *
  `;

  if (!rows[0]) {
    const error = new Error("Inventory sheet audit not found.");
    error.statusCode = 404;
    throw error;
  }

  return mapAuditRow(rows[0]);
}

async function approveAudit(auditId, reviewer, { allowErrors = false } = {}) {
  await initializeSchema();
  const sql = getSql();
  const safeAuditId = normalizeText(auditId, 500);
  const formattedReviewer = formatReviewer(reviewer);
  const rows = await sql`
    UPDATE vendor_auto_inventory_audits
    SET
      status = 'approved',
      error_count = 0,
      error_message = '',
      reviewed_by_email = ${formattedReviewer.email},
      reviewed_by_name = ${formattedReviewer.name},
      reviewed_at = now(),
      updated_at = now()
    WHERE id = ${safeAuditId}
      AND (
        status = 'ready_for_review'
        OR (
          ${Boolean(allowErrors)}
          AND status IN ('needs_mapping', 'failed')
        )
      )
      AND (
        NOT ${Boolean(allowErrors)}
        OR matched_rows > 0
      )
      AND is_legacy = FALSE
    RETURNING id
  `;

  if (!rows[0]) {
    const current = await getAuditRecord(safeAuditId);
    const error = new Error(
      current
        ? allowErrors && Number(current.matchedRows || 0) === 0
          ? "This inventory sheet has no matched rows to submit."
          : "This inventory sheet is not ready to be approved."
        : "Inventory sheet audit not found."
    );
    error.statusCode = current ? 409 : 404;
    throw error;
  }

  return getAuditRecord(safeAuditId);
}

async function rejectAudit(auditId, reviewer) {
  await initializeSchema();
  const sql = getSql();
  const safeAuditId = normalizeText(auditId, 500);
  const formattedReviewer = formatReviewer(reviewer);
  const rows = await sql`
    UPDATE vendor_auto_inventory_audits
    SET
      status = 'rejected',
      reviewed_by_email = ${formattedReviewer.email},
      reviewed_by_name = ${formattedReviewer.name},
      reviewed_at = now(),
      updated_at = now()
    WHERE id = ${safeAuditId}
      AND status IN ('ready_for_review', 'needs_mapping', 'failed')
      AND is_legacy = FALSE
    RETURNING id
  `;

  if (!rows[0]) {
    const current = await getAuditRecord(safeAuditId);
    const error = new Error(
      current
        ? "This inventory sheet cannot be rejected now."
        : "Inventory sheet audit not found."
    );
    error.statusCode = current ? 409 : 404;
    throw error;
  }

  return getAuditRecord(safeAuditId);
}

async function requestManualRetry(auditId) {
  await initializeSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE vendor_auto_inventory_audits
    SET
      manual_retry_count = manual_retry_count + 1,
      status = 'retrying',
      error_message = '',
      updated_at = now()
    WHERE id = ${normalizeText(auditId, 500)}
      AND status IN ('ready_for_review', 'needs_mapping', 'failed')
      AND is_legacy = FALSE
      AND manual_retry_count < ${maximumManualRetries}
    RETURNING *
  `;

  if (!rows[0]) {
    const current = await getAuditRecord(auditId);
    const error = new Error(
      current?.manualRetryCount >= maximumManualRetries
        ? `This import has reached the ${maximumManualRetries}-retry limit.`
        : "This inventory sheet cannot be retried."
    );
    error.statusCode = 409;
    throw error;
  }

  return mapAuditRow(rows[0]);
}

module.exports = {
  approveAudit,
  createAuditId,
  getAuditDetails,
  getAuditByAttachment,
  getAuditRecord,
  getProposalRows,
  getUnresolvedMissingSkus,
  initializeSchema,
  listAudits,
  maximumManualRetries,
  rejectAudit,
  requestManualRetry,
  resolveAllMissingSkus,
  resolveMissingSku,
  saveAuditPreview,
  setStatus,
  stageAudit,
  updateAuditMapping,
  updateProposalSelection,
  _test: {
    createAuditId,
    mapAuditRow,
    mapMissingSkuRow,
    mapProposalRow
  }
};
