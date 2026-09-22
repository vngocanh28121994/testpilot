import { Link, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusPill } from '@/components/StatusPill';
import { useRecentRuns } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';
import { isWorkflowHistoryRun } from '@/lib/workflowHistory';
import { cn } from '@/lib/utils';

const SHOWN = 5;

const LABEL: Record<string, string> = {
  running: 'đang chạy',
  waiting_review: 'chờ duyệt',
  waiting_input: 'chờ trả lời',
  passed: 'passed',
  failed: 'failed',
};

/**
 * Lịch sử workflow gần đây, ngay trên trang đã khởi động chúng.
 *
 * Bản cũ đặt bảng này trong chính trang App Studio, và đúng: người ta mở Studio
 * để chạy workflow, nên "lần trước chạy ra sao" thuộc về đúng chỗ đó. Bản React
 * có sẵn một trang lịch sử đầy đủ nhưng KHÔNG có lối nào dẫn tới — không mục
 * menu, không link — nên cách duy nhất vào là gõ URL.
 *
 * Bấm một hàng thì đi tới nơi tương ứng với trạng thái của nó: lượt đang chờ
 * người thì vào màn duyệt (đó là việc phải làm), còn lại thì vào trang lịch sử.
 * Bản cũ ghi rõ lý do: đưa một lượt chờ-trả-lời vào trang lịch sử là đặt câu hỏi
 * ở chỗ người vận hành không có lý do gì để nhìn vào.
 */
export function RecentWorkflows() {
  const runs = useRecentRuns();
  const navigate = useNavigate();
  const all = (runs.data ?? []).filter(isWorkflowHistoryRun);

  if (all.length === 0) return null;

  return (
    <Card aria-labelledby="recent-workflows-title">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle id="recent-workflows-title">Lịch sử workflow gần đây</CardTitle>
            <CardDescription>Bấm một dòng để mở lượt chạy đó.</CardDescription>
          </div>
          {all.length > SHOWN && (
            <Link
              to="/scenarios/history"
              search={{ focusId: undefined }}
              className="text-primary text-sm underline"
            >
              Xem tất cả ({all.length})
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chức năng</TableHead>
                <TableHead>Thời gian</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Bước</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {all.slice(0, SHOWN).map((run) => {
                const waiting =
                  run.status === 'waiting_review' || run.status === 'waiting_input';
                return (
                  <TableRow
                    key={run.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Mở lượt chạy ${run.feature ?? run.id}`}
                    className={cn('hover:bg-muted/50 cursor-pointer border-t')}
                    onClick={() =>
                      void navigate(
                        waiting
                          ? { to: '/scenarios', search: { file: run.generatedFile, status: 'pending' } }
                          : { to: '/scenarios/history', search: { focusId: run.id } },
                      )
                    }
                  >
                    <TableCell>{run.feature ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{when(run.startedAt)}</TableCell>
                    <TableCell>
                      <StatusPill status={LABEL[run.status] ?? run.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.stagesDone}/{run.stages?.length ?? 0}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
