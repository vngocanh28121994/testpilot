import { ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { StageList } from '@/components/StageList';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppState } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';
import { FARM_IDLE_STAGES } from '@/lib/stages';
import type { ReportView } from '@core/ui/contracts.js';

export default function FarmDetailPanel({ runId }: { runId: string }) {
  const state = useAppState((store) => ({ runs: store.runs, reports: store.reports }));
  const run = state.data?.runs.find((item) => item.id === runId);

  if (!run) {
    return (
      <AppShell title="Device Farm" description="Theo dõi kết quả chạy trên thiết bị thật.">
        <section className="max-w-4xl space-y-6">
          <Button asChild variant="outline" size="sm">
            <Link to="/farm"><ArrowLeft /> Quay lại Device Farm</Link>
          </Button>
          <Card>
            <CardContent className="text-muted-foreground p-6 text-sm">
              {state.isPending ? 'Đang tải lần chạy…' : 'Không tìm thấy lần chạy.'}
            </CardContent>
          </Card>
        </section>
      </AppShell>
    );
  }

  const reports = (state.data?.reports ?? []).filter((item): item is ReportView => (
    typeof item === 'object'
    && item !== null
    && 'id' in item
    && Boolean(run.runDirs?.includes(String((item as { id: unknown }).id)))
  ));

  return (
    <AppShell title="Device Farm" description="Theo dõi kết quả chạy trên thiết bị thật.">
      <section className="max-w-4xl space-y-6" aria-label="Chi tiết Device Farm">
        <Button asChild variant="outline" size="sm">
          <Link to="/farm"><ArrowLeft /> Quay lại Device Farm</Link>
        </Button>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{run.feature}</CardTitle>
              <StatusPill status={run.status} />
            </div>
            <CardDescription>{when(run.startedAt)}</CardDescription>
          </CardHeader>
          {run.error && (
            <CardContent>
              <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
                {run.error}
              </p>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tiến trình</CardTitle>
            <CardDescription>Các bước chuẩn bị và chạy kiểm thử trên Device Farm.</CardDescription>
          </CardHeader>
          <CardContent>
            <StageList stages={run.stages} idle={FARM_IDLE_STAGES} />
          </CardContent>
        </Card>

        {reports.map((report) => <ReportCard key={report.id} report={report} />)}

        {run.log.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Log ({run.log.length} dòng)</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                {run.log.join('\n')}
              </pre>
            </CardContent>
          </Card>
        )}
      </section>
    </AppShell>
  );
}

function ReportCard({ report }: { report: ReportView }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{report.device ?? report.id}</CardTitle>
          <StatusPill status={report.status} />
        </div>
        {report.counters && (
          <CardDescription>{report.counters.passed} passed · {report.counters.failed} failed</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <a className="inline-block text-sm underline" href={report.url} target="_blank" rel="noreferrer">
          Mở báo cáo
        </a>
        {report.videoUrls?.map((url) => (
          <video key={url} className="max-w-full rounded-lg" controls preload="metadata" src={url} />
        ))}
        {report.log && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Log</summary>
            <pre className="bg-muted mt-2 max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {report.log}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
