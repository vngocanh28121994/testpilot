interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

/** Pagination nhỏ dùng cho các danh sách server-state chưa có API phân trang. */
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Phân trang" className="mt-4 flex items-center gap-2 text-sm">
      <button
        className="button"
        type="button"
        aria-label="Trang trước"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Trước
      </button>
      <span className="text-muted-foreground">
        Trang {page}/{pageCount}
      </span>
      <button
        className="button"
        type="button"
        aria-label="Trang sau"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Sau →
      </button>
    </nav>
  );
}
