const database = require("../db/database");

function getNotesForSku(sku) {
  return database.all(
    "SELECT * FROM notes_log WHERE sku = ? ORDER BY created_at DESC",
    [sku]
  );
}

function addNote({ sku, note }) {
  return database.run(
    "INSERT INTO notes_log (sku, note) VALUES (?, ?)",
    [sku, note]
  );
}

function deleteNote(id) {
  return database.run("DELETE FROM notes_log WHERE id = ?", [id]);
}

function updateNote(id, note) {
  return database.run(
    "UPDATE notes_log SET note = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
    [note, id]
  );
}

module.exports = {
  getNotesForSku,
  addNote,
  deleteNote,
  updateNote
};
