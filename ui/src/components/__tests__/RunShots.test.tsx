import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunShots } from '../RunShots';

const report = {
  shotUrls: [
    { name: 'case-pass-a1-pass', url: '/pass.png', onFailure: false },
    { name: 'case-fail-a1-l7-fail', url: '/fail.png', onFailure: true },
    {
      name: 'case-known-a1-l42-fail', url: '/known.png', onFailure: true,
      scenario: 'Tiểu khoản đích không có ở nguồn',
      detail: 'known issue · dòng 42',
      error: 'TK Ký Quỹ vẫn nằm trong danh sách',
      knownIssue: 'Sản phẩm chưa hỗ trợ chiều ngược lại',
    },
    { name: 'tap-declined-123', url: '/declined.png', onFailure: false },
    { name: 'anh-tu-dat', url: '/other.png', onFailure: false },
  ],
};

describe('RunShots', () => {
  it('tách ảnh fail, pass và ảnh bổ sung thành các nhóm rõ ràng', () => {
    render(<RunShots report={report} />);

    expect(screen.getByText('Case fail')).toBeInTheDocument();
    expect(screen.getByText('Known issue')).toBeInTheDocument();
    expect(screen.getByText('Case pass')).toBeInTheDocument();
    expect(screen.getAllByText('Ảnh bổ sung')).not.toHaveLength(0);
    expect(screen.getAllByText('FAIL')).toHaveLength(3);
    expect(screen.getAllByText('PASS')).toHaveLength(2);
    expect(screen.getAllByText('INFO')).toHaveLength(2);
    expect(screen.getAllByText('KNOWN ISSUE')).toHaveLength(2);
  });

  it('không xếp ảnh known issue vào nhóm case fail', () => {
    render(<RunShots report={report} />);
    const failGroup = screen.getByText('Case fail').closest('details')!;
    const knownGroup = screen.getByText('Known issue').closest('details')!;

    expect(failGroup).not.toHaveTextContent('Tiểu khoản đích không có ở nguồn');
    expect(knownGroup).toHaveTextContent('Tiểu khoản đích không có ở nguồn');
    expect(knownGroup).toHaveTextContent('Lý do: Sản phẩm chưa hỗ trợ chiều ngược lại');
  });

  it('mở fail và known issue, nhưng thu gọn nhóm pass khi có lỗi thật', () => {
    render(<RunShots report={report} />);
    const groups = screen.getByLabelText('Ảnh theo kết quả testcase').querySelectorAll('details');
    expect(groups[0]).toHaveAttribute('open');
    expect(groups[1]).toHaveAttribute('open');
    expect(groups[2]).not.toHaveAttribute('open');
  });

  it('header nhóm ảnh thể hiện rõ có thể bấm để xem chi tiết', () => {
    render(<RunShots report={report} />);

    const summaries = screen.getAllByText('Xem/ẩn chi tiết');
    expect(summaries).toHaveLength(4);
    expect(
      screen.getByLabelText('Known issue: 1 ảnh — xem hoặc ẩn chi tiết'),
    ).toHaveClass('cursor-pointer', 'border', 'shadow-sm');
  });

  it('hiện tên testcase đã đọc được thay vì filename kỹ thuật', () => {
    render(<RunShots report={{ shotUrls: [report.shotUrls[0]!] }} />);
    expect(screen.getByText('case pass')).toBeInTheDocument();
    expect(screen.queryByText('case-pass-a1-pass')).not.toBeInTheDocument();
  });

  it('hiện đúng case, bước và lỗi của ảnh tap-declined khi API có report context', () => {
    render(<RunShots report={{ shotUrls: [{
      name: 'tap-declined-123',
      url: '/declined.png',
      onFailure: true,
      scenario: 'Chọn tiểu khoản nguồn và đích',
      detail: 'lúc fail · dòng 7 · And I open feature "Chuyển tiền" from search',
      error: 'locator.click: Timeout 5000ms exceeded.',
    }] }} />);

    expect(screen.getByText('Chọn tiểu khoản nguồn và đích')).toBeInTheDocument();
    expect(screen.getByText(/dòng 7.*open feature/)).toBeInTheDocument();
    expect(screen.getByText('locator.click: Timeout 5000ms exceeded.')).toBeInTheDocument();
    expect(screen.queryByText('Ảnh tại bước lỗi')).not.toBeInTheDocument();
  });

  it('dùng tên testcase có dấu từ chapter và xếp ảnh theo timeline', () => {
    render(<RunShots report={{
      chapters: [
        { name: 'Kịch bản đến sau', status: 'passed', at: 30 },
        { name: 'Kịch bản đến trước', status: 'passed', at: 10 },
      ],
      shotUrls: [
        { name: 'feature-kich-ban-den-sau-a1-pass', url: '/later.png', onFailure: false },
        { name: 'feature-kich-ban-den-truoc-a1-pass', url: '/earlier.png', onFailure: false },
      ],
    }} />);

    const names = [...screen.getByText('Case pass').closest('details')!.querySelectorAll('a .font-medium')]
      .map((node) => node.textContent);
    expect(names).toEqual(['Kịch bản đến trước', 'Kịch bản đến sau']);
  });
});
