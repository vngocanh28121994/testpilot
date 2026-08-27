import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * Bảng dùng chung, dựng trên TanStack Table 8.
 *
 * Cố ý mỏng. Bản cũ dựng bảng bằng tay ở bốn chỗ (Scenario Review, Healing,
 * Builds, History) và mỗi chỗ tự phát minh lại sắp xếp với hàng-rỗng theo một
 * kiểu hơi khác nhau. Cái này chỉ gom đúng phần lặp lại đó: sắp xếp, hàng
 * rỗng, canh lề cột. Lọc và phân trang KHÔNG nằm ở đây — mỗi trang có luật
 * lọc riêng và nhét vào đây sẽ thành một API đầy cờ.
 */
export interface DataTableProps<T> {
  data: T[];
  // `unknown` cho tham số giá trị: mỗi cột có kiểu accessor riêng, và ColumnDef
  // biến thiên theo tham số đó nên không có một kiểu chung nào khít cả. Đây là
  // đúng chỗ mà `any` của TanStack là hợp lý — nhưng `unknown` giữ được kỷ luật
  // "không any" mà vẫn nhận mọi cột.
  columns: ColumnDef<T, unknown>[];
  /** Hiện khi mảng rỗng. Câu chữ thuộc về trang, không phải bảng. */
  empty: string;
  /** Hiện thay cho `empty` khi còn đang tải — hai tình huống khác nhau. */
  loading?: boolean;
  loadingLabel?: string;
  initialSorting?: SortingState;
  caption?: string;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  empty,
  loading = false,
  loadingLabel = 'Đang tải…',
  initialSorting = [],
  caption,
  className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const colCount = table.getAllLeafColumns().length;

  return (
    <div className={cn('overflow-x-auto rounded-lg border', className)}>
      <Table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                const align = (header.column.columnDef.meta as { align?: 'right' } | undefined)?.align;
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    className={cn(align === 'right' && 'text-right')}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="hover:text-foreground inline-flex items-center gap-1"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === 'asc' ? (
                          <ChevronUp className="size-3" />
                        ) : dir === 'desc' ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={colCount} className="text-muted-foreground py-6 text-center">
                {loadingLabel}
              </TableCell>
            </TableRow>
          )}
          {!loading && data.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="text-muted-foreground py-6 text-center">
                {empty}
              </TableCell>
            </TableRow>
          )}
          {!loading &&
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const align = (cell.column.columnDef.meta as { align?: 'right' } | undefined)?.align;
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(align === 'right' && 'text-right tabular-nums')}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
