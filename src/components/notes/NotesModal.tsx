import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNote,
  deleteNote,
  getProductDetails,
  getNotes,
  updateProductFollowUp,
  updateProductVendorStock,
  updateNote
} from "../../services/api";
import type { Note, ProductDetails, ProductVendor } from "../../types";

type NotesModalProps = {
  closeLabel?: string;
  mode?: "modal" | "route";
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

function getValidDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatNoteDate(value: string) {
  const date = getValidDate(value);

  if (!date) {
    return "";
  }

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDate(date, today)) {
    return "Today";
  }

  if (isSameDate(date, yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatNoteTime(value: string) {
  const date = getValidDate(value);

  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "SB";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function NotesModal({
  closeLabel = "Close",
  mode = "modal",
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
  const [pendingVendorStock, setPendingVendorStock] = useState<
    Record<string, boolean>
  >({});
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

  async function handleVendorStockChange(
    vendor: ProductVendor,
    enabled: boolean
  ) {
    if (!vendor.canUpdateStock) {
      return;
    }

    const isCurrentlyEnabled = vendor.quantity > 0;

    if (isCurrentlyEnabled === enabled || pendingVendorStock[vendor.vendorProductId]) {
      return;
    }

    setDetailsError("");
    setPendingVendorStock((current) => ({
      ...current,
      [vendor.vendorProductId]: true
    }));

    try {
      const result = await updateProductVendorStock({
        sku,
        vendorId: vendor.id,
        vendorProductId: vendor.vendorProductId,
        enabled
      });

      setProductDetails((current) =>
        current
          ? {
              ...current,
              vendors: current.vendors.map((currentVendor) =>
                currentVendor.vendorProductId === result.vendorProductId
                  ? {
                      ...currentVendor,
                      quantity: result.quantity
                    }
                  : currentVendor
              )
            }
          : current
      );
      onFollowUpSaved();
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to update vendor stock."
      );
    } finally {
      setPendingVendorStock((current) => {
        const next = { ...current };

        delete next[vendor.vendorProductId];

        return next;
      });
    }
  }

  const title = productDetails?.name || sku;
  const vendors = productDetails?.vendors || [];
  const isRouteMode = mode === "route";

  return (
    <div
      className={isRouteMode ? "notes-route-shell" : "modal"}
      role={isRouteMode ? "region" : "dialog"}
      aria-modal={isRouteMode ? undefined : true}
      aria-labelledby="modalTitle"
    >
      <div className="modal-content notes-modal-content">
        <header className="notes-modal-header">
          <h2 id="modalTitle">{title}</h2>
          <button id="closeModalButton" type="button" onClick={onClose}>
            {closeLabel}
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
                {vendors.map((vendor) => {
                  const stockEnabled = vendor.quantity > 0;
                  const isPending = Boolean(
                    pendingVendorStock[vendor.vendorProductId]
                  );

                  return (
                    <li className="assigned-vendor-item" key={vendor.vendorProductId}>
                      <span className="assigned-vendor-name">{vendor.name}</span>

                      <div
                        className={
                          vendor.canUpdateStock
                            ? "vendor-stock-switch"
                            : "vendor-stock-switch readonly"
                        }
                        role="group"
                        aria-label={`${vendor.name} stock ${
                          vendor.canUpdateStock ? "override" : "status"
                        }`}
                        title={`Current quantity: ${vendor.quantity}`}
                      >
                        <button
                          type="button"
                          className={
                            stockEnabled
                              ? "vendor-stock-switch-option active"
                              : "vendor-stock-switch-option"
                          }
                          aria-label={
                            vendor.canUpdateStock
                              ? `Turn on stock for ${vendor.name}`
                              : `${vendor.name} has warehouse stock`
                          }
                          aria-pressed={stockEnabled}
                          disabled={isPending || !vendor.canUpdateStock}
                          onClick={() => handleVendorStockChange(vendor, true)}
                        >
                          I
                        </button>
                        <button
                          type="button"
                          className={
                            stockEnabled
                              ? "vendor-stock-switch-option"
                              : "vendor-stock-switch-option active off"
                          }
                          aria-label={
                            vendor.canUpdateStock
                              ? `Turn off stock for ${vendor.name}`
                              : `${vendor.name} has no warehouse stock`
                          }
                          aria-pressed={!stockEnabled}
                          disabled={isPending || !vendor.canUpdateStock}
                          onClick={() => handleVendorStockChange(vendor, false)}
                        >
                          O
                        </button>
                      </div>
                    </li>
                  );
                })}
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
                notes.map((note, index) => {
                  const authorName = note.author?.name || "StockBridge";
                  const dateLabel = formatNoteDate(note.created_at);
                  const previousDateLabel =
                    index > 0 ? formatNoteDate(notes[index - 1].created_at) : "";
                  const showDateLabel = dateLabel && dateLabel !== previousDateLabel;
                  const noteTime = formatNoteTime(note.created_at);

                  return (
                    <div className="note-group" key={note.id}>
                      {showDateLabel && (
                        <div className="note-date-divider">
                          <span>{dateLabel}</span>
                        </div>
                      )}

                      <article className="note-item">
                        <div className="note-avatar" aria-hidden="true">
                          {note.author?.picture ? (
                            <img src={note.author.picture} alt="" />
                          ) : (
                            <span>{getInitials(authorName)}</span>
                          )}
                        </div>

                        <div className="note-card">
                          <header className="note-card-header">
                            <strong>{authorName}</strong>

                            <div className="note-card-meta">
                              {noteTime && (
                                <time dateTime={note.created_at}>{noteTime}</time>
                              )}

                              <div className="note-icon-actions">
                                <button
                                  type="button"
                                  aria-label="Edit note"
                                  title="Edit note"
                                  onClick={() => handleEditNote(note)}
                                >
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    focusable="false"
                                  >
                                    <path d="M4 16.7V20h3.3L17.1 10.2l-3.3-3.3L4 16.7Zm15.7-9.1c.4-.4.4-1 0-1.4l-1.9-1.9c-.4-.4-1-.4-1.4 0l-1.5 1.5 3.3 3.3 1.5-1.5Z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  aria-label="Delete note"
                                  title="Delete note"
                                  onClick={() => handleDeleteNote(note.id)}
                                >
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    focusable="false"
                                  >
                                    <path d="M8 5V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v1h4v2H4V5h4Zm2 0h4V4h-4v1Zm-3 4h10l-.7 11.1c-.1 1.1-1 1.9-2 1.9H9.7c-1.1 0-1.9-.8-2-1.9L7 9Zm3 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </header>

                          <p className="note-text">{note.note}</p>
                        </div>
                      </article>
                    </div>
                  );
                })
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
