import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { StatusPill } from '@/components/StatusPill';
import { Card, CardContent } from '@/components/ui/card';
import { useAppState } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { LazyLog } from '@/components/LazyLog';
import { ROUTES } from '@/api/routes';
import { RunShots } from '@/components/RunShots';
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
  const wanted = picked ?? runId;
  const report = reports.find((r) => r.id === wanted) ?? (wanted ? undefined : reports[0]);
  /**
   * Được chỉ đích danh một lượt chạy mà không tìm thấy report của nó.
   *
   * Rơi về report mới nhất là cách âm thầm nhất để nói dối: người dùng bấm "Xem
   * report" của lượt vừa chạy và nhận về một lượt khác, trông y như thật. Xảy ra
   * thật khi lượt chạy chết trước lúc kịp ghi report.
   */
  const missing = Boolean(wanted) && !report;

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
      {/*
        Danh sách nằm trong Card, như mọi bảng khác trong app. Không phải để cho
        đẹp: nền chấm động của AppShell vẽ xuyên qua bất cứ gì không có màu nền
        riêng, và ở đây từng dòng chỉ có viền — nên chữ và cả cái viền đều chìm
        vào hoa văn phía sau.
      */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <div className="text-muted-foreground text-sm">{reports.length} lượt chạy</div>
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
        </CardContent>
      </Card>
      {missing && (
        <p className="text-muted-foreground mt-4">
          Lượt chạy này chưa có report — nhiều khả năng nó dừng giữa chừng trước khi kịp ghi.
          Chọn một lượt khác ở trên để xem.
        </p>
      )}
      {!report && !missing && <p className="text-muted-foreground mt-4">Chưa có report.</p>}
      {report && <ReportDetail report={report} />}
    </AppShell>
  );
}

function ReportDetail({ report }: { report: ReportView }) { return <section className="mt-4"><div className="flex gap-2"><StatusPill status={report.status}/><a href={report.url} target="_blank" rel="noreferrer" className="text-sm underline">Mở report</a></div><iframe title={`Report ${report.id}`} src={report.url} className="border-border mt-3 h-[550px] w-full rounded border"/><RunShots report={report}/>{report.networkLogUrl && <LazyLog url={report.networkLogUrl} summary="Network log" label="Network log" className="max-h-72"/>}{report.hasLog && <LazyLog url={`${ROUTES.runLog}?id=${encodeURIComponent(report.id)}`} label="Log lượt chạy" className="max-h-72"/>}</section>; }
