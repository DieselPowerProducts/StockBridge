import { useCallback, useEffect, useState } from "react";
import {
  createNote,
  deleteNote,
  getNotes,
  updateNote
} from "../../services/api";
import type { Note } from "../../types";

type NotesModalProps = {
  sku: string;
  onClose: () => void;
};

export function NotesModal({ sku, onClose }: NotesModalProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [error, setError] = useState("");

  const loadNotes = useCallback(async () => {
    setError("");

    try {
      const result = await getNotes(sku);
      setNotes(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load notes.");
    }
  }, [sku]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  async function handleAddNote() {
    const note = newNote.trim();

    if (!note) {
      return;
    }

    await createNote({ sku, note });
    setNewNote("");
    loadNotes();
  }

  async function handleDeleteNote(id: string) {
    await deleteNote(id);
    loadNotes();
  }

  async function handleEditNote(note: Note) {
    const nextNote = window.prompt("Edit note:", note.note);

    if (nextNote === null) {
      return;
    }

    await updateNote(note.id, nextNote);
    loadNotes();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div className="modal-content">
        <h2 id="modalTitle">{sku}</h2>

        {error && <p className="status-message error-message">{error}</p>}

        <div id="notesList">
          {notes.length === 0 ? (
            <p className="status-message">No notes yet.</p>
          ) : (
            notes.map((note) => (
              <article className="note-item" key={note.id}>
                <div className="note-content">
                  <small>{note.created_at}</small>
                  <br />
                  <span>{note.note}</span>
                </div>
                <div className="note-actions">
                  <button type="button" onClick={() => handleEditNote(note)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDeleteNote(note.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="note-input-container">
          <input
            type="text"
            value={newNote}
            placeholder="Add note..."
            aria-label="Add note"
            onChange={(event) => setNewNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAddNote();
              }
            }}
          />
          <button className="send-btn" type="button" onClick={handleAddNote}>
            Send
          </button>
        </div>

        <button id="closeModalButton" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
