/**
 * Màn quản lý thiết bị: ai đang giữ máy nào, và hàng đợi có gì.
 *
 * Đây là lần đầu ba thứ dựng ở P3 nhìn thấy được cùng lúc — thiết bị, chỗ
 * giữ, hàng đợi — và chúng được GHÉP với nhau, không xếp cạnh nhau. Một danh
 * sách máy không nói ai đang cầm, cạnh một danh sách job không nói chạy trên
 * máy nào, thì người đọc phải tự nối bằng mắt; và câu hỏi thật của một phòng
 * máy chỉ có một: "chiếc này đang bận vì ai".
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  ControlTargetsResponse,
  DeviceLeasesResponse,
  DeviceLeaseView,
  JobsResponse,
  JobView,
} from '@core/ui/contracts.js';

/** Nhịp hỏi lại. Lease sống 60 giây, nên 5 giây là đủ nhanh để thấy đổi tay. */
const REFRESH_MS = 5_000;

const STATE_LABEL: Record<JobView['state'], string> = {
  queued: 'đang chờ',
  assigned: 'đã giao',
  running: 'đang chạy',
  succeeded: 'xong',
  failed: 'hỏng',
  cancelled: 'đã huỷ',
  interrupted: 'bỏ dở',
};

function when(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('vi-VN', { hour12: false });
}

/** Còn bao nhiêu giây nữa thì lease hết hạn. Số âm nghĩa là nó đã quá hạn. */
function secondsLeft(lease: DeviceLeaseView): number {
  return Math.round((Date.parse(lease.expiresAt) - Date.now()) / 1000);
}

export default function DevicesPanel() {
  const client = useQueryClient();
  const [reclaiming, setReclaiming] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState('');

  const devices = useQuery({
    queryKey: ['device-targets'],
    queryFn: async () => (await api.get<ControlTargetsResponse>(ROUTES.deviceTargets)).devices,
    refetchInterval: REFRESH_MS,
  });
  const leases = useQuery({
    queryKey: ['device-leases'],
    queryFn: async () => (await api.get<DeviceLeasesResponse>(ROUTES.deviceLeases)).leases,
    refetchInterval: REFRESH_MS,
  });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get<JobsResponse>(ROUTES.jobs)).jobs,
    refetchInterval: REFRESH_MS,
  });

  const forceRelease = useMutation({
    mutationFn: (input: { leaseId: string; reason: string }) =>
      api.post(ROUTES.deviceLeaseForceRelease, input),
    onSuccess: async () => {
      setReclaiming(undefined);
      setReason('');
      toast.success('Đã thu hồi thiết bị.');
      await client.invalidateQueries({ queryKey: ['device-leases'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const leaseOf = (udid: string): DeviceLeaseView | undefined =>
    (leases.data ?? []).find((lease) => lease.deviceId === udid);
  const jobById = (id: string): JobView | undefined =>
    (jobs.data ?? []).find((job) => job.id === id);

  const waiting = (jobs.data ?? []).filter((job) => job.state === 'queued');
  const active = (jobs.data ?? []).filter(
    (job) => job.state === 'running' || job.state === 'assigned',
  );
  const recent = (jobs.data ?? []).filter(
    (job) => !['queued', 'running', 'assigned'].includes(job.state),
  ).slice(0, 10);

  return (
    <AppShell
      title="Thiết bị và hàng đợi"
      description="Máy nào đang bận vì ai, và việc gì đang xếp hàng."
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2" aria-labelledby="devices-title">
          <div className="flex items-center gap-3">
            <h2 id="devices-title" className="text-sm font-medium">Thiết bị</h2>
            <Button
              size="sm"
              variant="outline"
              disabled={devices.isFetching}
              onClick={() => void devices.refetch()}
            >
              {devices.isFetching ? 'Đang tìm…' : 'Tìm lại'}
            </Button>
          </div>

          {(devices.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Chưa máy nào cắm vào. Job cần thiết bị sẽ nằm chờ tới khi có máy — không hỏng.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2 font-medium">Máy</th>
                    <th className="p-2 font-medium">Đang bận vì</th>
                    <th className="p-2 font-medium">Còn lại</th>
                    <th className="p-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {(devices.data ?? []).map((device) => {
                    const lease = leaseOf(device.udid);
                    const job = lease?.holder.kind === 'job'
                      ? jobById(lease.holder.jobId) : undefined;
                    return (
                      <tr key={device.udid} className="border-t">
                        <td className="p-2">
                          <div>{device.label}</div>
                          <div className="text-muted-foreground text-xs">{device.udid}</div>
                        </td>
                        <td className="p-2">
                          {!lease && <span className="text-muted-foreground">rảnh</span>}
                          {lease?.holder.kind === 'human' && (
                            <span>người dùng <b>{lease.holder.userId}</b> đang điều khiển</span>
                          )}
                          {lease?.holder.kind === 'job' && (
                            <span>
                              job đang chạy
                              {job?.tag ? <> · <code>{job.tag}</code></> : null}
                              {job?.platform ? ` · ${job.platform}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {lease ? `${Math.max(0, secondsLeft(lease))}s` : '—'}
                        </td>
                        <td className="p-2 text-right">
                          {lease && reclaiming !== lease.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setReclaiming(lease.id); setReason(''); }}
                            >
                              Thu hồi
                            </Button>
                          )}
                          {lease && reclaiming === lease.id && (
                            <div className="flex items-center justify-end gap-2">
                              <Input
                                autoFocus
                                value={reason}
                                placeholder="Lý do thu hồi"
                                aria-label="Lý do thu hồi"
                                className="h-8 max-w-56"
                                onChange={(event) => setReason(event.target.value)}
                              />
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={!reason || forceRelease.isPending}
                                onClick={() => forceRelease.mutate({ leaseId: lease.id, reason })}
                              >
                                Xác nhận
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setReclaiming(undefined)}
                              >
                                Thôi
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Thu hồi lấy máy khỏi tay người đang dùng, nên nó bắt buộc có lý do — người bị lấy sẽ
            hỏi, và câu trả lời phải có sẵn.
          </p>
        </section>

        <JobList title="Đang chạy" jobs={active} empty="Không có job nào đang chạy." />
        <JobList
          title="Đang chờ"
          jobs={waiting}
          empty="Hàng đợi trống."
          note="Job chờ vì máy đang bận hoặc chưa cắm. Nó không hỏng, và sẽ tự chạy khi tới lượt."
        />
        <JobList title="Vừa xong" jobs={recent} empty="Chưa có lượt nào chạy." />
      </div>
    </AppShell>
  );
}

function JobList({ title, jobs, empty, note }: {
  title: string;
  jobs: JobView[];
  empty: string;
  note?: string;
}) {
  const id = `jobs-${title}`;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={id}>
      <h2 id={id} className="text-sm font-medium">{title}</h2>
      {jobs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2 font-medium">Việc</th>
                <th className="p-2 font-medium">Trạng thái</th>
                <th className="p-2 font-medium">Máy</th>
                <th className="p-2 font-medium">Đặt lúc</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t align-top">
                  <td className="p-2">
                    <div>{job.platform ?? job.kind}{job.tag ? ` · ${job.tag}` : ''}</div>
                    {job.error && (
                      <div className="text-muted-foreground text-xs">{job.error}</div>
                    )}
                  </td>
                  <td className="p-2">
                    {STATE_LABEL[job.state]}
                    {job.attempt > 1 ? ` · lần ${job.attempt}` : ''}
                  </td>
                  <td className="p-2">
                    {job.devices.length > 0 ? job.devices.join(', ') : '—'}
                  </td>
                  <td className="p-2">{when(job.requestedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </section>
  );
}
