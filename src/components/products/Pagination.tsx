type PaginationProps = {
  currentPage: number;
  limit: number;
  totalItems: number;
  onPageChange: (page: number) => void;
};

export function Pagination({
  currentPage,
  limit,
  totalItems,
  onPageChange
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / limit);

  if (totalPages <= 1) {
    return null;
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

  const pages = Array.from(
    { length: end - start + 1 },
    (_, index) => start + index
  );

  return (
    <div id="pagination" aria-label="Pagination">
      {currentPage > 1 && (
        <button type="button" onClick={() => onPageChange(currentPage - 1)}>
          Prev
        </button>
      )}

      {pages.map((page) => (
        <button
          key={page}
          type="button"
          className={page === currentPage ? "active" : ""}
          aria-current={page === currentPage ? "page" : undefined}
          onClick={() => onPageChange(page)}
        >
          {page}
        </button>
      ))}

      {currentPage < totalPages && (
        <button type="button" onClick={() => onPageChange(currentPage + 1)}>
          Next
        </button>
      )}
    </div>
  );
}
