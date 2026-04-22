const { getSql } = require("../db/neon");

let schemaReady;

function normalizeUser(user) {
  if (!user?.sub || !user?.email) {
    return null;
  }

  const email = String(user.email).trim().toLowerCase();

  if (!email) {
    return null;
  }

  return {
    sub: String(user.sub).trim(),
    email,
    name: String(user.name || email).trim() || email,
    picture: String(user.picture || "").trim(),
    hd: String(user.hd || "").trim()
  };
}

function formatUser(row) {
  return normalizeUser({
    sub: row.sub,
    email: row.email,
    name: row.name,
    picture: row.picture,
    hd: row.hd
  });
}

async function initializeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS app_users (
          sub TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          picture TEXT,
          hd TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS app_users_name_idx
        ON app_users (name)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS app_users_last_seen_idx
        ON app_users (last_seen_at DESC)
      `;
    })();
  }

  return schemaReady;
}

async function upsertUser(user) {
  const safeUser = normalizeUser(user);

  if (!safeUser) {
    return null;
  }

  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    INSERT INTO app_users (sub, email, name, picture, hd)
    VALUES (
      ${safeUser.sub},
      ${safeUser.email},
      ${safeUser.name},
      ${safeUser.picture || null},
      ${safeUser.hd || null}
    )
    ON CONFLICT (sub) DO UPDATE
    SET email = EXCLUDED.email,
        name = EXCLUDED.name,
        picture = EXCLUDED.picture,
        hd = EXCLUDED.hd,
        updated_at = now(),
        last_seen_at = now()
    RETURNING sub, email, name, picture, hd
  `;

  return formatUser(rows[0]);
}

async function listUsers() {
  await initializeSchema();

  const sql = getSql();
  const rows = await sql`
    SELECT sub, email, name, picture, hd
    FROM app_users
    ORDER BY lower(name) ASC, lower(email) ASC
  `;

  return rows.map(formatUser).filter(Boolean);
}

module.exports = {
  listUsers,
  upsertUser
};
