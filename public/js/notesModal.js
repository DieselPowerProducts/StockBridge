import * as api from "./api.js";
import { state } from "./state.js";

export function setupNotesModal() {
  document.getElementById("addNoteButton").addEventListener("click", addNote);
  document.getElementById("closeModalButton").addEventListener("click", closeModal);

  document.getElementById("newNote").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addNote();
    }
  });
}

export async function openModal(sku) {
  state.currentSKU = sku;

  document.getElementById("modal").classList.remove("hidden");
  document.getElementById("modalTitle").textContent = sku;

  const notes = await api.getNotes(sku);
  renderNotes(notes);
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

async function addNote() {
  const input = document.getElementById("newNote");
  const note = input.value.trim();

  if (!note) {
    return;
  }

  await api.createNote({
    sku: state.currentSKU,
    note
  });

  input.value = "";
  openModal(state.currentSKU);
}

function renderNotes(notes) {
  const notesList = document.getElementById("notesList");
  notesList.innerHTML = "";

  notes.forEach((note) => {
    const item = document.createElement("div");
    const content = document.createElement("div");
    const date = document.createElement("small");
    const noteText = document.createElement("span");
    const actions = document.createElement("div");
    const editButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    item.className = "note-item";
    content.className = "note-content";
    actions.className = "note-actions";
    noteText.id = `note-text-${note.id}`;

    date.textContent = note.created_at;
    noteText.textContent = note.note;
    editButton.type = "button";
    editButton.textContent = "Edit";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";

    editButton.addEventListener("click", () => editNote(note.id));
    deleteButton.addEventListener("click", () => deleteNote(note.id));

    content.append(date, document.createElement("br"), noteText);
    actions.append(editButton, deleteButton);
    item.append(content, actions);
    notesList.appendChild(item);
  });
}

async function deleteNote(id) {
  await api.deleteNote(id);
  openModal(state.currentSKU);
}

async function editNote(id) {
  const currentText = document.getElementById(`note-text-${id}`).textContent;
  const newText = prompt("Edit note:", currentText);

  if (newText === null) {
    return;
  }

  await api.updateNote(id, newText);
  openModal(state.currentSKU);
}
