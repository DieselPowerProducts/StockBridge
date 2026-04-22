const { getSql } = require("../db/neon");
const staticUserSeed = require("../data/user-seed");

let schemaReady;
let notesBackfillReady;
let staticSeedReady;
const recentUserTouches = new Map();
const userTouchTtlMs = 5 * 60 * 1000;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildSeedSub(email) {
  return `seed:${normalizeEmail(email)}`;
}

function isMissingRelationError(error, relationName) {
  return (
    error &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes(relationName.toLowerCase())
  );
}

function normalizeUser(user) {
  if (!user?.sub || !user?.email) {
    return null;
  }

  const email = normalizeEmail(user.email);

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

function normalizeSeedUser(user) {
  const email = normalizeEmail(user?.email);
  const name = String(user?.name || "").trim();

  if (!email || !name) {
    return null;
  }

  return normalizeUser({
    sub: buildSeedSub(email),
    email,
    name,
    picture: "",
    hd: email.split("@")[1] || ""
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

async function backfillUsersFromNotes() {
  if (!notesBackfillReady) {
    notesBackfillReady = (async () => {
      await initializeSchema();

      const sql = getSql();

      try {
        const rows = await sql`
          SELECT DISTINCT
            author_sub AS sub,
            author_email AS email,
            author_name AS name,
            author_picture AS picture
          FROM product_notes
          WHERE author_sub IS NOT NULL
            AND author_email IS NOT NULL
        `;

        for (const row of rows) {
          await upsertUser({
            sub: row.sub,
            email: row.email,
            name: row.name,
            picture: row.picture,
            hd: ""
          });
        }
      } catch (error) {
        if (isMissingRelationError(error, "product_notes")) {
          return;
        }

        throw error;
      }
    })();
  }

  return notesBackfillReady;
}

async function updateNotificationRecipients(sql, oldSub, safeUser) {
  try {
    await sql`
      UPDATE product_notifications
      SET
        recipient_sub = ${safeUser.sub},
        recipient_email = ${safeUser.email},
        recipient_name = ${safeUser.name},
        recipient_picture = ${safeUser.picture || null}
      WHERE recipient_sub = ${oldSub}
    `;
  } catch (error) {
    if (isMissingRelationError(error, "product_notifications")) {
      return;
    }

    throw error;
  }
}

async function findUserByEmail(sql, email) {
  const rows = await sql`
    SELECT sub, email, name, picture, hd
    FROM app_users
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `;

  return rows[0] || null;
}

async function upsertSeedUser(user) {
  const safeUser = normalizeSeedUser(user);

  if (!safeUser) {
    return null;
  }

  await initializeSchema();

  const sql = getSql();
  const existingByEmail = await findUserByEmail(sql, safeUser.email);

  if (existingByEmail) {
    if (!String(existingByEmail.sub || "").startsWith("seed:")) {
      return formatUser(existingByEmail);
    }

    const rows = await sql`
      UPDATE app_users
      SET
        name = ${safeUser.name},
        hd = ${safeUser.hd || null},
        updated_at = now()
      WHERE sub = ${existingByEmail.sub}
      RETURNING sub, email, name, picture, hd
    `;

    return formatUser(rows[0]);
  }

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
        hd = EXCLUDED.hd,
        updated_at = now()
    RETURNING sub, email, name, picture, hd
  `;

  return formatUser(rows[0]);
}

async function ensureStaticSeedUsers() {
  if (!staticSeedReady) {
    staticSeedReady = (async () => {
      await initializeSchema();

      for (const user of staticUserSeed) {
        await upsertSeedUser(user);
      }
    })();
  }

  return staticSeedReady;
}

async function upsertUser(user) {
  const safeUser = normalizeUser(user);

  if (!safeUser) {
    return null;
  }

  await initializeSchema();

  const sql = getSql();
  const existingByEmail = await findUserByEmail(sql, safeUser.email);

  if (existingByEmail && existingByEmail.sub !== safeUser.sub) {
    const oldSub = String(existingByEmail.sub || "").trim();
    const existingBySubRows = await sql`
      SELECT sub
      FROM app_users
      WHERE sub = ${safeUser.sub}
      LIMIT 1
    `;

    if (existingBySubRows.length > 0) {
      await updateNotificationRecipients(sql, oldSub, safeUser);
      await sql`
        DELETE FROM app_users
        WHERE sub = ${oldSub}
      `;
    } else {
      const rows = await sql`
        UPDATE app_users
        SET
          sub = ${safeUser.sub},
          email = ${safeUser.email},
          name = ${safeUser.name},
          picture = ${safeUser.picture || null},
          hd = ${safeUser.hd || null},
          updated_at = now(),
          last_seen_at = now()
        WHERE sub = ${oldSub}
        RETURNING sub, email, name, picture, hd
      `;

      await updateNotificationRecipients(sql, oldSub, safeUser);
      return formatUser(rows[0]);
    }
  }

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
  await backfillUsersFromNotes();
  await ensureStaticSeedUsers();

  const sql = getSql();
  const rows = await sql`
    SELECT sub, email, name, picture, hd
    FROM app_users
    ORDER BY lower(name) ASC, lower(email) ASC
  `;

  return rows.map(formatUser).filter(Boolean);
}

async function registerAuthenticatedUser(user) {
  const safeUser = normalizeUser(user);

  if (!safeUser) {
    return null;
  }

  const now = Date.now();
  const lastTouchedAt = recentUserTouches.get(safeUser.sub) || 0;

  if (now - lastTouchedAt < userTouchTtlMs) {
    return safeUser;
  }

  recentUserTouches.set(safeUser.sub, now);

  try {
    await ensureStaticSeedUsers();
    return await upsertUser(safeUser);
  } catch (error) {
    recentUserTouches.delete(safeUser.sub);
    throw error;
  }
}

module.exports = {
  listUsers,
  registerAuthenticatedUser,
  upsertUser
};
