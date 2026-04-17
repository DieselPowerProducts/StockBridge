import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNote,
  deleteNote,
  getProductDetails,
  getNotes,
  updateProductFollowUp,
  updateNote
} from "../../services/api";
import type { Note, ProductDetails } from "../../types";

type NotesModalProps = {
  sku: string;
  onClose: () => void;
  onFollowUpSaved: () => void;
};

function formatFollowUpDate(value: string) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Date(year, month - 1, day).toLocaleDateString();
}

export function NotesModal({
  sku,
  onClose,
  onFollowUpSaved
}: NotesModalProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(
    null
  );
  const [newNote, setNewNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notesError, setNotesError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [isFollowUpPickerOpen, setIsFollowUpPickerOpen] = useState(false);
  const [isFollowUpSaving, setIsFollowUpSaving] = useState(false);
  const [isProductDetailsLoading, setIsProductDetailsLoading] = useState(false);
  const followUpInputRef = useRef<HTMLInputElement | null>(null);

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
      setFollowUpDate(result.followUpDate || "");
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to load product vendors."
      );
      setProductDetails(null);
      setFollowUpDate("");
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

  useEffect(() => {
    if (!isFollowUpPickerOpen) {
      return;
    }

    followUpInputRef.current?.focus();
    try {
      followUpInputRef.current?.showPicker?.();
    } catch {
      // Some browsers only allow showPicker during the direct click event.
    }
  }, [isFollowUpPickerOpen]);

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

  async function handleFollowUpDateChange(value: string) {
    setFollowUpDate(value);
    setFollowUpMessage("");
    setDetailsError("");
    setIsFollowUpSaving(true);

    try {
      const result = await updateProductFollowUp({
        sku,
        followUpDate: value
      });

      setFollowUpDate(result.followUpDate || "");
      setFollowUpMessage(
        result.followUpDate ? "Follow-up date saved." : "Follow-up date cleared."
      );
      setProductDetails((current) =>
        current
          ? {
              ...current,
              followUpDate: result.followUpDate || ""
            }
          : current
      );
      onFollowUpSaved();
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to save follow-up date."
      );
    } finally {
      setIsFollowUpSaving(false);
    }
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
            <div className="notes-panel-header">
              <div>
                <h3>Notes</h3>
                {followUpDate && (
                  <p className="follow-up-current">
                    Follow up: {formatFollowUpDate(followUpDate)}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="follow-up-button"
                onClick={() => setIsFollowUpPickerOpen((isOpen) => !isOpen)}
              >
                Follow Up
              </button>
            </div>

            {isFollowUpPickerOpen && (
              <div className="follow-up-picker">
                <input
                  ref={followUpInputRef}
                  type="date"
                  value={followUpDate}
                  aria-label="Follow-up date"
                  onChange={(event) => handleFollowUpDateChange(event.target.value)}
                />
                {isFollowUpSaving && (
                  <span className="follow-up-status">Saving...</span>
                )}
                {!isFollowUpSaving && followUpMessage && (
                  <span className="follow-up-status">{followUpMessage}</span>
                )}
              </div>
            )}

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
