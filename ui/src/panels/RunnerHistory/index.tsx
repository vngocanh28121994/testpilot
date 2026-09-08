import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { LogView } from '@/components/LogView';
import { StatusPill } from '@/components/StatusPill';
import { useAppState } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { api } from '@/api/client';
import type { ReportView } from '@core/ui/contracts.js';

export default function RunnerHistoryPanel({ runId }: { runId?: string }) {
  const state = useAppState((s) => s.reports);
  const reports = state.data?.filter((r): r is ReportView => typeof r === 'object' && r !== null && 'id' in r) ?? [];
  // `runId` KHÔNG được dùng làm giá trị khởi tạo useState: lúc render đầu tiên
  // danh sách report còn rỗng (nó đến từ một truy vấn), nên giá trị khởi tạo
  // luôn là chuỗi rỗng và trang rơi về report mới nhất — bấm "Chi tiết" ở lượt
  // chạy nào cũng mở đúng một lượt. Chỉ coi đây là lựa chọn của người dùng khi
  // họ thật sự bấm; còn lại thì URL là nguồn sự thật.
  const [picked, setPicked] = useState<string | null>(null);
  const report =
    reports.find((r) => r.id === (picked ?? runId)) ?? (picked ? undefined : reports[0]);

  return (
    <AppShell title="Chi tiết lượt chạy local">
      {/*
        Mỗi lượt chạy phải TỰ NHẬN DẠNG ĐƯỢC.

        Trước đây mỗi nút chỉ ghi "android · 8/9/2026", nên bốn lượt chạy trong
        cùng một ngày trên cùng một máy cho ra bốn cái nút giống hệt nhau: không
        có cách nào biết mình đang chọn cái nào, kể cả sau khi đã bấm. Giờ mỗi
        nút mang giờ chạy — thứ duy nhất thật sự khác nhau — cộng kết quả và tag.
      */}
      {/*
        Danh sách dài ra theo từng ngày làm việc, nên nó phải cuộn trong chính
        nó thay vì đẩy phần chi tiết — thứ người ta mở trang này để xem — xuống
        dưới màn hình. Con số tổng đứng ngay trên để "cuộn mãi không hết" không
        biến thành "không biết còn bao nhiêu".
      */}
      <div className="text-muted-foreground mb-2 text-sm">{reports.length} lượt chạy</div>
      <ul
        aria-label="Các lượt chạy"
        className="flex max-h-64 flex-col gap-1.5 overflow-auto pe-1"
      >
        {reports.map((item) => {
          const active = report?.id === item.id;
          const pass = item.counters?.passed ?? 0;
          const fail = item.counters?.failed ?? 0;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={active}
                // Lượt đang chọn có thể nằm ngoài vùng nhìn thấy khi danh sách
                // dài — nhất là khi vào thẳng bằng link từ bảng lịch sử.
                ref={(node) => {
                  if (active) node?.scrollIntoView({ block: 'nearest' });
                }}
                onClick={() => setPicked(item.id)}
                className={cn(
                  'flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left text-sm',
                  active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                )}
              >
                <span className="font-medium tabular-nums">{when(item.startedAt)}</span>
                <StatusPill status={item.status} />
                <span className="text-muted-foreground">{item.platform}</span>
                <span className="text-muted-foreground truncate">{item.tag ?? 'tất cả tag'}</span>
                <span className="ms-auto tabular-nums">
                  <span className={pass > 0 ? 'text-status-pass' : 'text-muted-foreground'}>
                    {pass}✓
                  </span>{' '}
                  <span className={fail > 0 ? 'text-status-fail' : 'text-muted-foreground'}>
                    {fail}✗
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!report && <p className="text-muted-foreground mt-4">Chưa có report.</p>}
      {report && <ReportDetail report={report} />}
    </AppShell>
  );
}

function ReportDetail({ report }: { report: ReportView }) { const [network, setNetwork] = useState<string | null>(null); return <section className="mt-4"><div className="flex gap-2"><StatusPill status={report.status}/><a href={report.url} target="_blank" rel="noreferrer" className="text-sm underline">Mở report</a></div><iframe title={`Report ${report.id}`} src={report.url} className="border-border mt-3 h-[550px] w-full rounded border"/>{report.shotUrls && <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{report.shotUrls.map((shot) => <a key={shot.url} href={shot.url} target="_blank" rel="noreferrer"><img className="border-border rounded border" src={shot.url} alt={shot.name}/><span className="text-xs">{shot.onFailure ? 'khi fail' : shot.name}</span></a>)}</div>}{report.networkLogUrl && <details className="mt-4" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && network === null) void api.getText(report.networkLogUrl!).then(setNetwork).catch((err: Error) => setNetwork(`Không đọc được log: ${err.message}`)); }}><summary>Network log</summary><LogView logs={network ?? 'Đang tải…'} className="mt-2 max-h-72" label="Network log" /></details>}{report.log && <details className="mt-4"><summary>Log</summary><LogView logs={report.log} className="mt-2 max-h-72" label="Log lượt chạy" /></details>}</section>; }
