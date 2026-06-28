interface Props {
  page: number
  pageSize: number
  total: number
  onPage: (next: number) => void
}

/** Numbered Prev/Next pager. Hidden when everything fits on one page. */
export function Pager({ page, pageSize, total, onPage }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        type="button"
        className="btn pager__btn"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
      >
        ◀ Prev
      </button>
      <span className="pager__status">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className="btn pager__btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= pages}
      >
        Next ▶
      </button>
    </nav>
  )
}
