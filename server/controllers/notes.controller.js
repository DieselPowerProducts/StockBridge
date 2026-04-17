const notesService = require("../services/notes.service");

async function listNotes(req, res, next) {
  try {
    const notes = await notesService.getNotesForSku(req.params.sku);
    res.send(notes);
  } catch (err) {
    next(err);
  }
}

async function createNote(req, res, next) {
  try {
    const result = await notesService.addNote(req.body, req.user);
    res.send({ id: result.id });
  } catch (err) {
    next(err);
  }
}

async function deleteNote(req, res, next) {
  try {
    const result = await notesService.deleteNote(req.params.id);
    res.send({ deleted: result.changes });
  } catch (err) {
    next(err);
  }
}

async function updateNote(req, res, next) {
  try {
    const result = await notesService.updateNote(req.params.id, req.body.note);
    res.send({ updated: result.changes });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNotes,
  createNote,
  deleteNote,
  updateNote
};
