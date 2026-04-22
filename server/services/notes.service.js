const { getSql } = require("../db/neon");
const notificationsService = require("./notifications.service");

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isNoteOwnedByUser(note, user = {}) {
  const safeUserSub = String(user?.sub || "").trim();
  const safeUserEmail = normalizeEmail(user?.email);
  const noteAuthorSub = String(note?.author_sub || "").trim();
  const noteAuthorEmail = normalizeEmail(note?.author_email);

  if (noteAuthorSub && safeUserSub) {
    return noteAuthorSub === safeUserSub;
  }

  if (noteAuthorEmail && safeUserEmail) {
    return noteAuthorEmail === safeUserEmail;
  }

  return false;
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

async function getOwnedNoteRecord(id, user = {}) {
  await initializeSchema();

  const safeId = getSafeId(id);
  const sql = getSql();
  const rows = await sql`
    SELECT
      id::text,
      sku,
      author_sub,
      author_email
    FROM product_notes
    WHERE id = ${safeId}
    LIMIT 1
  `;

  const note = rows[0];

  if (!note) {
    const error = new Error("Note not found.");
    error.statusCode = 404;
    throw error;
  }

  if (!isNoteOwnedByUser(note, user)) {
    const error = new Error("Only the note author can edit or delete this note.");
    error.statusCode = 403;
    throw error;
  }

  return {
    id: String(note.id || safeId),
    sku: String(note.sku || "")
  };
}

async function addNote({ sku, note, productId = "" }, author = {}) {
  assertNoteInput({ sku, note });
  await initializeSchema();

  const safeSku = String(sku).trim();
  const safeNote = String(note).trim();
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
      ${safeSku},
      ${safeNote},
      ${author.sub || null},
      ${author.email || null},
      ${author.name || author.email || null},
      ${author.picture || null}
    )
    RETURNING id::text, sku
  `;

  const noteId = String(rows[0]?.id || "");
  await notificationsService.syncNoteNotifications({
    noteId,
    sku: rows[0]?.sku || safeSku,
    note: safeNote,
    sender: author
  });

  return {
    id: noteId
  };
}

async function deleteNote(id, author = {}) {
  const ownedNote = await getOwnedNoteRecord(id, author);
  const safeId = getSafeId(id);
  const sql = getSql();
  const rows = await sql`
    DELETE FROM product_notes
    WHERE id = ${safeId}
    RETURNING id::text
  `;

  if (rows.length > 0) {
    await notificationsService.deleteNotificationsForNoteId(String(rows[0].id || safeId));
  }

  return {
    changes: rows.length
  };
}

async function updateNote(id, note, author = {}) {
  if (!String(note || "").trim()) {
    const error = new Error("Note is required.");
    error.statusCode = 400;
    throw error;
  }

  const ownedNote = await getOwnedNoteRecord(id, author);
  const safeId = getSafeId(id);
  const safeNote = String(note).trim();
  const sql = getSql();
  const rows = await sql`
    UPDATE product_notes
    SET note = ${safeNote}, updated_at = now()
    WHERE id = ${safeId}
    RETURNING id::text, sku
  `;

  if (rows.length > 0) {
    await notificationsService.syncNoteNotifications({
      noteId: String(rows[0].id || safeId),
      sku: rows[0].sku || ownedNote.sku,
      note: safeNote,
      sender: author
    });
  }

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
