const backorders = [];
const notesLog = [];

let nextBackorderId = 1;
let nextNoteId = 1;

function now() {
  return new Date().toISOString();
}

function normalize(sql) {
  return sql.replace(/\s+/g, " ").trim().toUpperCase();
}

function matchesLike(value, pattern) {
  const needle = String(pattern || "").replaceAll("%", "").toLowerCase();
  return String(value || "").toLowerCase().includes(needle);
}

async function run(sql, params = []) {
  const normalized = normalize(sql);

  if (normalized.startsWith("CREATE TABLE")) {
    return { id: 0, changes: 0 };
  }

  if (normalized.startsWith("INSERT INTO BACKORDERS")) {
    const [sku, vendor] = params;
    const existing = backorders.find((item) => item.sku === sku);

    if (existing) {
      existing.vendor = vendor;
      existing.updated_at = now();
      return { id: existing.id, changes: 1 };
    }

    const item = {
      id: nextBackorderId,
      sku,
      vendor,
      notes: "",
      status: "Pending",
      updated_at: now()
    };

    nextBackorderId += 1;
    backorders.push(item);

    return { id: item.id, changes: 1 };
  }

  if (normalized.startsWith("UPDATE BACKORDERS SET STATUS")) {
    const [status, id] = params;
    const item = backorders.find((entry) => entry.id === Number(id));

    if (!item) {
      return { id: Number(id), changes: 0 };
    }

    item.status = status;
    item.updated_at = now();

    return { id: item.id, changes: 1 };
  }

  if (normalized.startsWith("INSERT INTO NOTES_LOG")) {
    const [sku, note] = params;
    const item = {
      id: nextNoteId,
      sku,
      note,
      created_at: now()
    };

    nextNoteId += 1;
    notesLog.push(item);

    return { id: item.id, changes: 1 };
  }

  if (normalized.startsWith("DELETE FROM NOTES_LOG")) {
    const [id] = params;
    const index = notesLog.findIndex((entry) => entry.id === Number(id));

    if (index === -1) {
      return { id: Number(id), changes: 0 };
    }

    notesLog.splice(index, 1);

    return { id: Number(id), changes: 1 };
  }

  if (normalized.startsWith("UPDATE NOTES_LOG SET NOTE")) {
    const [note, id] = params;
    const item = notesLog.find((entry) => entry.id === Number(id));

    if (!item) {
      return { id: Number(id), changes: 0 };
    }

    item.note = note;
    item.created_at = now();

    return { id: item.id, changes: 1 };
  }

  throw new Error(`Unsupported in-memory query: ${normalized}`);
}

async function get(sql, params = []) {
  const normalized = normalize(sql);

  if (normalized.startsWith("SELECT COUNT(*) AS COUNT FROM BACKORDERS")) {
    const [searchPattern] = params;
    return {
      count: backorders.filter((item) => matchesLike(item.sku, searchPattern)).length
    };
  }

  throw new Error(`Unsupported in-memory query: ${normalized}`);
}

async function all(sql, params = []) {
  const normalized = normalize(sql);

  if (normalized.startsWith("SELECT * FROM BACKORDERS")) {
    const [searchPattern, limit, offset] = params;

    return backorders
      .filter((item) => matchesLike(item.sku, searchPattern))
      .slice(Number(offset), Number(offset) + Number(limit));
  }

  if (normalized.startsWith("SELECT * FROM NOTES_LOG")) {
    const [sku] = params;

    return notesLog
      .filter((item) => item.sku === sku)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  if (normalized.startsWith("SELECT VENDOR, COUNT(*) AS PRODUCTCOUNT")) {
    const byVendor = new Map();

    for (const item of backorders) {
      const vendor = item.vendor?.trim();

      if (!vendor) {
        continue;
      }

      const summary = byVendor.get(vendor) || {
        vendor,
        productCount: 0,
        availableCount: 0,
        backorderedCount: 0
      };

      summary.productCount += 1;
      summary.availableCount += item.status === "Available" ? 1 : 0;
      summary.backorderedCount += item.status === "Backordered" ? 1 : 0;
      byVendor.set(vendor, summary);
    }

    return Array.from(byVendor.values()).sort((a, b) =>
      a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" })
    );
  }

  if (normalized.startsWith("SELECT ID, SKU, VENDOR, STATUS, UPDATED_AT")) {
    const [vendor] = params;

    return backorders
      .filter((item) => item.vendor === vendor)
      .map(({ id, sku, vendor: itemVendor, status, updated_at }) => ({
        id,
        sku,
        vendor: itemVendor,
        status,
        updated_at
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { sensitivity: "base" }));
  }

  throw new Error(`Unsupported in-memory query: ${normalized}`);
}

module.exports = {
  db: null,
  run,
  get,
  all
};
