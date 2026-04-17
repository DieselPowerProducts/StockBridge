import { useCallback, useEffect, useState } from "react";
import {
  createNote,
  deleteNote,
  getProductDetails,
  getNotes,
  updateNote
} from "../../services/api";
import type { Note, ProductDetails } from "../../types";

type NotesModalProps = {
  sku: string;
  onClose: () => void;
};

export function NotesModal({ sku, onClose }: NotesModalProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(
    null
  );
  const [newNote, setNewNote] = useState("");
  const [notesError, setNotesError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [isProductDetailsLoading, setIsProductDetailsLoading] = useState(false);

  const loadNotes = useCallback(async () => {
    setNotesError("");

    try {
      const result = await getNotes(sku);
      setNotes(result);
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : "Unable to load notes.");
    }
  }, [sku]);

  const loadProductDetails = useCallback(async () => {
    setDetailsError("");
    setIsProductDetailsLoading(true);

    try {
      const result = await getProductDetails(sku);
      setProductDetails(result);
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to load product vendors."
      );
      setProductDetails(null);
    } finally {
      setIsProductDetailsLoading(false);
    }
  }, [sku]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    loadProductDetails();
  }, [loadProductDetails]);

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

  const title = productDetails?.name || sku;
  const vendors = productDetails?.vendors || [];

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div className="modal-content notes-modal-content">
        <header className="notes-modal-header">
          <h2 id="modalTitle">{title}</h2>
          <button id="closeModalButton" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {detailsError && (
          <p className="status-message error-message">{detailsError}</p>
        )}
        {notesError && <p className="status-message error-message">{notesError}</p>}

        <div className="notes-modal-grid">
          <aside className="assigned-vendors-panel" aria-labelledby="assignedVendorsHeading">
            <h3 id="assignedVendorsHeading">Assigned vendors</h3>

            {isProductDetailsLoading ? (
              <p className="status-message">Loading vendors...</p>
            ) : vendors.length === 0 ? (
              <p className="status-message">No vendors assigned.</p>
            ) : (
              <ul className="assigned-vendors-list">
                {vendors.map((vendor) => (
                  <li key={vendor.id}>{vendor.name}</li>
                ))}
              </ul>
            )}
          </aside>

          <section className="notes-panel" aria-label="Notes">
            <h3>Notes</h3>

            <div id="notesList" className="notes-list">
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
                      <button
                        type="button"
                        onClick={() => handleDeleteNote(note.id)}
                      >
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
          </section>
        </div>
      </div>
    </div>
  );
}
