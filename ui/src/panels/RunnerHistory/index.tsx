import { useRef, useState } from 'react';
import { api } from '@/api/client';
import { DropdownSelect } from '@/components/DropdownSelect';
import { AppShell } from '@/components/layout/AppShell';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppState } from '@/hooks/useAppState';
import { when } from '@/lib/datetime';
import type { ReportView } from '@core/ui/contracts.js';

const PLATFORMS = ['web', 'android', 'ios'] as const;

export default function RunnerHistoryPanel({ runId }: { runId?: string }) {
  const state = useAppState((s) => s.reports);
  const reports = state.data?.filter((report): report is ReportView => (
    typeof report === 'object' && report !== null && 'id' in report
  )) ?? [];
  const [platform, setPlatform] = useState(
    reports.find((report) => report.id === runId)?.platform
      ?? PLATFORMS.find((item) => reports.some((report) => report.platform === item))
      ?? 'web',
  );
  const [week, setWeek] = useState('all');
  const [device, setDevice] = useState('all');
  const [picked, setPicked] = useState(runId ?? '');
  const available = reports
    .filter((report) => report.platform === platform)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const weeks = [...new Set(available.map((report) => weekKey(report.startedAt)).filter(Boolean))];
  const devices = [...new Set(available.map((report) => report.device).filter((value): value is string => Boolean(value)))];
  const filtered = available.filter((report) => (
    (week === 'all' || weekKey(report.startedAt) === week)
    && (device === 'all' || report.device === device)
  ));
  const report = filtered.find((item) => item.id === picked) ?? filtered[0];

  function choosePlatform(next: string) {
    setPlatform(next);
    setWeek('all');
    setDevice('all');
    setPicked('');
  }

  return (
    <AppShell title="E2E History" description="Lọc report theo platform, tuần và thiết bị.">
      <section className="flex flex-col gap-6" aria-label="E2E History">
        <div role="tablist" aria-label="Platform report" className="flex flex-wrap gap-2">
          {PLATFORMS.map((item) => (
            <Button
              key={item}
              size="sm"
              role="tab"
              variant={platform === item ? 'default' : 'outline'}
              disabled={!reports.some((report) => report.platform === item)}
              onClick={() => choosePlatform(item)}
            >
              {item} ({reports.filter((report) => report.platform === item).length})
            </Button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bộ lọc lượt chạy</CardTitle>
            <CardDescription>Chọn khoảng tuần và thiết bị để thu hẹp kết quả.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <label className="min-w-56 text-sm font-medium">
              Tuần
              <DropdownSelect
                ariaLabel="Tuần"
                className="mt-1"
                value={week}
                onValueChange={(value) => {
                  setWeek(value);
                  setPicked('');
                }}
                options={[
                  { value: 'all', label: `Tất cả (${available.length})` },
                  ...weeks.map((item) => ({
                    value: item,
                    label: `${weekLabel(item)} — ${available.filter((report) => weekKey(report.startedAt) === item).length}`,
                  })),
                ]}
              />
            </label>
            <label className="min-w-56 text-sm font-medium">
              Thiết bị
              <DropdownSelect
                ariaLabel="Thiết bị"
                className="mt-1"
                value={device}
                disabled={devices.length < 2}
                onValueChange={(value) => {
                  setDevice(value);
                  setPicked('');
                }}
                options={[
                  { value: 'all', label: `Tất cả (${devices.length || 1})` },
                  ...devices.map((item) => ({ value: item, label: item })),
                ]}
              />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lượt chạy ({filtered.length})</CardTitle>
            <CardDescription>Chọn một dòng để xem report và tư liệu đính kèm.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-border overflow-x-auto rounded-lg border bg-white dark:bg-card">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Thời gian</th>
                    <th className="px-4 py-3 font-medium">Kết quả</th>
                    <th className="px-4 py-3 font-medium">Pass</th>
                    <th className="px-4 py-3 font-medium">Fail</th>
                    <th className="px-4 py-3 font-medium">Thời lượng</th>
                    <th className="px-4 py-3 font-medium">Tag</th>
                    <th className="px-4 py-3 font-medium">Thiết bị</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`cursor-pointer border-t transition-colors hover:bg-muted/50 ${report?.id === item.id ? 'bg-muted' : ''}`}
                      onClick={() => setPicked(item.id)}
                    >
                      <td className="px-4 py-3">{when(item.startedAt)}</td>
                      <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                      <td className="px-4 py-3">{item.counters?.passed ?? '—'}</td>
                      <td className="px-4 py-3">{item.counters?.failed ?? '—'}</td>
                      <td className="px-4 py-3">{duration(item)}</td>
                      <td className="px-4 py-3">{item.tag ?? '—'}</td>
                      <td className="px-4 py-3">{item.device ?? '—'}</td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={7} className="text-muted-foreground px-4 py-8 text-center">
                        Không có lượt chạy khớp bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {report && <ReportDetail report={report} />}
      </section>
    </AppShell>
  );
}

function ReportDetail({ report }: { report: ReportView }) {
  const [network, setNetwork] = useState<string | null>(null);

  return (
    <section className="space-y-4" aria-label="Chi tiết report">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Báo cáo đã chọn</CardTitle>
            <StatusPill status={report.status} />
          </div>
          <CardDescription>{when(report.startedAt)}</CardDescription>
        </CardHeader>
        <CardContent>
          <a href={report.url} target="_blank" rel="noreferrer" className="text-sm underline">
            Mở report trong tab mới
          </a>
          <iframe title={`Report ${report.id}`} src={report.url} className="border-border mt-4 h-[550px] w-full rounded-lg border bg-white" />
        </CardContent>
      </Card>

      {report.wholeVideoUrls?.map((url) => <VideoWithChapters key={url} url={url} report={report} />)}
      {report.videoUrls?.filter((url) => !report.wholeVideoUrls?.includes(url)).map((url) => (
        <Card key={url}>
          <CardContent className="p-4">
            <video controls preload="metadata" className="max-h-[420px] w-full rounded-lg" src={url} />
          </CardContent>
        </Card>
      ))}
      {report.shotUrls && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ảnh chụp</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {report.shotUrls.map((shot) => (
              <a key={shot.url} href={shot.url} target="_blank" rel="noreferrer">
                <img className="border-border rounded-lg border" src={shot.url} alt={shot.name} />
                <span className="mt-1 block text-xs">{shot.onFailure ? 'Khi fail' : shot.name}</span>
              </a>
            ))}
          </CardContent>
        </Card>
      )}
      {report.networkLogUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Network log</CardTitle>
          </CardHeader>
          <CardContent>
            <details
              onToggle={(event) => {
                if ((event.currentTarget as HTMLDetailsElement).open && network === null) {
                  void api.getText(report.networkLogUrl!)
                    .then(setNetwork)
                    .catch((error: Error) => setNetwork(`Không đọc được log: ${error.message}`));
                }
              }}
            >
              <summary className="cursor-pointer text-sm font-medium">Xem log kết nối</summary>
              <NetworkLog text={network} />
            </details>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function VideoWithChapters({ url, report }: { url: string; report: ReportView }) {
  const video = useRef<HTMLVideoElement>(null);
  const [skip, setSkip] = useState(0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Video chạy kiểm thử</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <video
          ref={video}
          controls
          preload="metadata"
          className="max-h-[460px] w-full rounded-lg"
          src={url}
          onLoadedMetadata={(event) => {
            const videoDuration = event.currentTarget.duration;
            if (report.testSeconds && Number.isFinite(videoDuration)) {
              const value = Math.max(0, videoDuration - report.testSeconds - 2);
              setSkip(value);
              if (value >= 1) event.currentTarget.currentTime = value;
            }
          }}
        />
        {skip >= 1 && (
          <p className="text-muted-foreground text-xs">
            Bắt đầu ở {skip.toFixed(0)}s, bỏ qua phần cài app/tạo session.
          </p>
        )}
        {(report.chapters?.length ?? 0) > 1 && (
          <ol className="flex flex-wrap gap-2">
            {report.chapters!.map((chapter) => (
              <li key={`${chapter.name}-${chapter.at}`}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (video.current) {
                      video.current.currentTime = skip + chapter.at;
                      void video.current.play();
                    }
                  }}
                >
                  {formatSeconds(skip + chapter.at)} {chapter.name}
                </Button>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function NetworkLog({ text }: { text: string | null }) {
  if (text === null) return <pre className="bg-muted mt-2 rounded-md p-3 text-xs">Đang tải…</pre>;

  return (
    <pre className="bg-muted mt-2 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
      {text.split('\n').filter(Boolean).map((line, index) => (
        <span
          key={index}
          className={/ FAILED |\s[45]\d{2}\s/.test(line)
            ? 'text-destructive'
            : /\s[34]\d{2}\s/.test(line)
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-status-pass'}
        >
          {line}{'\n'}
        </span>
      ))}
    </pre>
  );
}

function weekKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.toISOString().slice(0, 10);
}

function weekLabel(key: string) {
  return `Tuần ${new Date(`${key}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`;
}

function duration(report: ReportView) {
  const from = Date.parse(report.startedAt);
  const to = Date.parse(report.finishedAt ?? '');
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '—';
  const seconds = Math.round((to - from) / 1000);
  return seconds < 90 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatSeconds(value: number) {
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}
