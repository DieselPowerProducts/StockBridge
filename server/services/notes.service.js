const { getSql } = require("../db/neon");

let schemaReady;

function getSafeId(id) {
  const safeId = Number.parseInt(id, 10);

  if (!Number.isSafeInteger(safeId) || safeId < 1) {
    const error = new Error("Invalid note id.");
    error.statusCode = 400;
    throw error;
  }

  return safeId;
}

function assertNoteInput({ sku, note }) {
  if (!String(sku || "").trim()) {
    const error = new Error("SKU is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!String(note || "").trim()) {
    const error = new Error("Note is required.");
    error.statusCode = 400;
    throw error;
  }
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS product_notes (
          id BIGSERIAL PRIMARY KEY,
          product_id TEXT,
          sku TEXT NOT NULL,
          note TEXT NOT NULL,
          author_sub TEXT,
          author_email TEXT,
          author_name TEXT,
          author_picture TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        ALTER TABLE product_notes
        ADD COLUMN IF NOT EXISTS author_sub TEXT
      `;
      await sql`
        ALTER TABLE product_notes
        ADD COLUMN IF NOT EXISTS author_email TEXT
      `;
      await sql`
        ALTER TABLE product_notes
        ADD COLUMN IF NOT EXISTS author_name TEXT
      `;
      await sql`
        ALTER TABLE product_notes
        ADD COLUMN IF NOT EXISTS author_picture TEXT
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS product_notes_sku_idx
        ON product_notes (sku)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS product_notes_product_id_idx
        ON product_notes (product_id)
      `;
    })();
  }

  return schemaReady;
}

function formatNote(row) {
  return {
    id: String(row.id),
    productId: row.product_id || "",
    sku: row.sku || "",
    note: row.note || "",
    author: {
      sub: row.author_sub || "",
      email: row.author_email || "",
      name: row.author_name || row.author_email || "StockBridge",
      picture: row.author_picture || ""
    },
    created_at: row.created_at
      ? new Date(row.created_at).toISOString()
      : "",
    updated_at: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : ""
  };
}

async function getNotesForSku(sku) {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT
      id::text,
      product_id,
      sku,
      note,
      author_sub,
      author_email,
      author_name,
      author_picture,
      created_at,
      updated_at
    FROM product_notes
    WHERE sku = ${sku}
    ORDER BY created_at ASC, id ASC
  `;

  return rows.map(formatNote);
}

async function addNote({ sku, note, productId = "" }, author = {}) {
  assertNoteInput({ sku, note });
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO product_notes (
      product_id,
      sku,
      note,
      author_sub,
      author_email,
      author_name,
      author_picture
    )
    VALUES (
      ${productId || null},
      ${String(sku).trim()},
      ${String(note).trim()},
      ${author.sub || null},
      ${author.email || null},
      ${author.name || author.email || null},
      ${author.picture || null}
    )
    RETURNING id::text
  `;

  return {
    id: String(rows[0]?.id || "")
  };
}

async function deleteNote(id) {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    DELETE FROM product_notes
    WHERE id = ${getSafeId(id)}
    RETURNING id
  `;

  return {
    changes: rows.length
  };
}

async function updateNote(id, note) {
  if (!String(note || "").trim()) {
    const error = new Error("Note is required.");
    error.statusCode = 400;
    throw error;
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    UPDATE product_notes
    SET note = ${String(note).trim()}, updated_at = now()
    WHERE id = ${getSafeId(id)}
    RETURNING id
  `;

  return {
    changes: rows.length
  };
}

module.exports = {
  getNotesForSku,
  addNote,
  deleteNote,
  updateNote
};
