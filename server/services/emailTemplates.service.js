const { getSql } = require("../db/neon");

let schemaReady;

function normalizeText(value) {
  return String(value || "").trim();
}

function assertTemplateInput({ name, subject, body }) {
  const safeName = normalizeText(name);
  const safeSubject = normalizeText(subject);
  const safeBody = normalizeText(body);

  if (!safeName) {
    const error = new Error("Template name is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!safeSubject) {
    const error = new Error("Template subject is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!safeBody) {
    const error = new Error("Template message is required.");
    error.statusCode = 400;
    throw error;
  }

  if (safeName.length > 120) {
    const error = new Error("Template name must be 120 characters or fewer.");
    error.statusCode = 400;
    throw error;
  }

  return {
    name: safeName,
    subject: safeSubject,
    body: safeBody
  };
}

function formatTemplate(row) {
  return {
    id: String(row?.id || ""),
    name: normalizeText(row?.name),
    subject: String(row?.subject || ""),
    body: String(row?.body || "")
  };
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS stock_check_email_templates (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS stock_check_email_templates_name_idx
        ON stock_check_email_templates (lower(name))
      `;
    })();
  }

  return schemaReady;
}

async function listTemplates() {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT id::text, name, subject, body
    FROM stock_check_email_templates
    ORDER BY lower(name) ASC, id ASC
  `;

  return rows.map(formatTemplate);
}

async function saveTemplate(input) {
  const template = assertTemplateInput(input || {});
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO stock_check_email_templates (name, subject, body)
    VALUES (${template.name}, ${template.subject}, ${template.body})
    ON CONFLICT (name) DO UPDATE
    SET subject = EXCLUDED.subject,
        body = EXCLUDED.body,
        updated_at = now()
    RETURNING id::text, name, subject, body
  `;

  return formatTemplate(rows[0] || {});
}

module.exports = {
  listTemplates,
  saveTemplate
};
