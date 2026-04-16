export function renderPagination({ currentPage, limit, totalItems }, onPageChange) {
  const pagination = document.getElementById("pagination");
  pagination.innerHTML = "";

  const totalPages = Math.ceil(totalItems / limit);

  if (totalPages <= 1) {
    return;
  }

  let start = currentPage - 2;
  let end = currentPage + 2;

  if (currentPage <= 3) {
    start = 1;
    end = Math.min(5, totalPages);
  } else if (currentPage >= totalPages - 2) {
    start = Math.max(1, totalPages - 4);
    end = totalPages;
  }

  if (currentPage > 1) {
    pagination.appendChild(createPageButton("Prev", currentPage - 1, onPageChange));
  }

  for (let page = start; page <= end; page += 1) {
    const button = createPageButton(page, page, onPageChange);

    if (page === currentPage) {
      button.classList.add("active");
    }

    pagination.appendChild(button);
  }

  if (currentPage < totalPages) {
    pagination.appendChild(createPageButton("Next", currentPage + 1, onPageChange));
  }
}

function createPageButton(label, page, onPageChange) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => onPageChange(page));
  return button;
}
