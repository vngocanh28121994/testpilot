import { Button } from '@/components/ui/button';

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
      <Button
        variant="outline"
        type="button"
        aria-label="Trang trước"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Trước
      </Button>
      <span className="text-muted-foreground">
        Trang {page}/{pageCount}
      </span>
      <Button
        variant="outline"
        type="button"
        aria-label="Trang sau"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Sau →
      </Button>
    </nav>
  );
}
