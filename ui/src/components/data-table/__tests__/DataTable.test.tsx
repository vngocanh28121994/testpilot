import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';

interface Row {
  ten: string;
  so: number;
}

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'ten', header: 'Tên' },
  { accessorKey: 'so', header: 'Số', meta: { align: 'right' } },
];

const data: Row[] = [
  { ten: 'bê', so: 2 },
  { ten: 'a', so: 30 },
  { ten: 'xê', so: 1 },
];

const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('DataTable', () => {
  it('render dữ liệu', () => {
    render(<DataTable data={data} columns={columns} empty="rỗng" />);
    expect(bodyRows()).toHaveLength(3);
  });

  it('phân biệt "đang tải" với "rỗng" — hai tình huống khác nhau', () => {
    const { rerender } = render(<DataTable data={[]} columns={columns} empty="rỗng" loading />);
    expect(screen.getByText('Đang tải…')).toBeInTheDocument();
    expect(screen.queryByText('rỗng')).toBeNull();

    rerender(<DataTable data={[]} columns={columns} empty="rỗng" />);
    expect(screen.getByText('rỗng')).toBeInTheDocument();
  });

  /**
   * Cột SỐ sắp giảm dần ở cú bấm ĐẦU TIÊN — mặc định `sortDescFirst` của
   * TanStack, và ở đây là mặc định đúng: mọi cột số trong app này đều là số
   * đếm (scenario, step, heal, lần thất bại), và câu hỏi đầu tiên người ta hỏi
   * một cột như thế luôn là "cái nào nhiều nhất". Cột chữ thì ngược lại, tăng
   * dần trước. Giữ nguyên hành vi thư viện, nhưng khẳng định nó ở đây để lần
   * sau không ai coi đó là lỗi.
   */
  it('cột số sắp giảm dần trước, và báo hướng qua aria-sort', async () => {
    const user = userEvent.setup();
    render(<DataTable data={data} columns={columns} empty="rỗng" />);
    const nums = () => bodyRows().map((r) => within(r).getAllByRole('cell')[1]?.textContent);

    await user.click(screen.getByRole('button', { name: /Số/ }));
    expect(nums()).toEqual(['30', '2', '1']);
    expect(screen.getByRole('columnheader', { name: /Số/ })).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: /Số/ }));
    expect(nums()).toEqual(['1', '2', '30']);
    expect(screen.getByRole('columnheader', { name: /Số/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('cột chữ sắp tăng dần trước', async () => {
    const user = userEvent.setup();
    render(<DataTable data={data} columns={columns} empty="rỗng" />);
    await user.click(screen.getByRole('button', { name: /Tên/ }));
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['a', 'bê', 'xê']);
  });

  it('nhận sắp xếp ban đầu', () => {
    render(<DataTable data={data} columns={columns} empty="rỗng" initialSorting={[{ id: 'ten', desc: false }]} />);
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['a', 'bê', 'xê']);
  });
});
