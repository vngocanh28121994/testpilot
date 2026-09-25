import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, MonitorSmartphone, Search } from 'lucide-react';
import type { ControlDeviceView, DeviceLeaseView, JobView } from '@core/ui/contracts.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dropdown } from '@/components/Dropdown';
import { Pagination } from '@/components/Pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  filterRows,
  groupRows,
  inventory,
  machinesOf,
  pageOf,
  STATUS_LABEL,
  summarize,
  type DeviceStatus,
  type InventoryFilter,
  type InventoryRow,
} from '@/lib/deviceInventory';

const STATUS_TONE: Record<DeviceStatus, string> = {
  free: 'bg-(--tint-pass) text-status-pass',
  held: 'bg-(--tint-warn) text-status-flaky',
  testing: 'bg-primary/10 text-primary',
  offline: 'bg-muted text-muted-foreground',
};

const ALL = '__all__';

/**
 * Danh sách thiết bị cho NHIỀU máy: tổng quan bấm được, lọc, nhóm theo máy
 * tính, trang. Logic ở [lib/deviceInventory.ts](../../lib/deviceInventory.ts).
 */
export function DeviceInventory({
  devices,
  leases,
  jobById,
  secondsLeft,
  renderReclaim,
}: {
  devices: ControlDeviceView[];
  leases: DeviceLeaseView[];
  jobById: (id: string) => JobView | undefined;
  secondsLeft: (lease: DeviceLeaseView) => number;
  /** Nút / ô thu hồi của một lượt giữ — giữ nguyên logic cũ ở màn cha. */
  renderReclaim: (lease: DeviceLeaseView) => React.ReactNode;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InventoryFilter>({});
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo(() => inventory(devices, leases), [devices, leases]);
  const summary = useMemo(() => summarize(rows), [rows]);
  const machines = useMemo(() => machinesOf(rows), [rows]);
  const groups = useMemo(() => groupRows(filterRows(rows, filter)), [rows, filter]);
  const paged = pageOf(groups, page);

  // Đổi bộ lọc thì về trang 1: đứng ở trang 3 của một danh sách vừa thu còn
  // một trang là nhìn một bảng trống.
  const setFilterAndReset = (next: InventoryFilter) => { setFilter(next); setPage(1); };
  const filtering = Boolean(filter.status || filter.platform || filter.machine !== undefined || filter.query);

  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Tổng quan — bấm để lọc theo trạng thái. Câu hỏi đầu tiên ai cũng hỏi
          là "còn máy nào rảnh không", và nó phải trả lời được mà không đọc bảng. */}
      <div role="group" aria-label="Tổng quan thiết bị" className="flex flex-wrap gap-2">
        <SummaryChip
          label="Tổng"
          count={summary.total}
          active={!filter.status}
          onClick={() => setFilterAndReset({ ...filter, status: undefined })}
        />
        {(['free', 'held', 'testing', 'offline'] as const).map((status) => (
          <SummaryChip
            key={status}
            label={STATUS_LABEL[status]}
            count={summary[status]}
            tone={STATUS_TONE[status]}
            active={filter.status === status}
            onClick={() => setFilterAndReset({ ...filter, status: filter.status === status ? undefined : status })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
          <Input
            aria-label="Tìm thiết bị"
            placeholder="Tìm theo tên máy, udid, máy tính…"
            className="pl-8"
            value={filter.query ?? ''}
            onChange={(event) => setFilterAndReset({ ...filter, query: event.target.value })}
          />
        </div>
        <Dropdown
          aria-label="Lọc theo nền tảng"
          className="mt-0 w-36"
          value={filter.platform ?? ALL}
          onChange={(value) => setFilterAndReset({
            ...filter, platform: value === ALL ? undefined : value as 'android' | 'ios',
          })}
          options={[
            { value: ALL, label: 'Mọi nền tảng' },
            { value: 'android', label: 'Android' },
            { value: 'ios', label: 'iOS' },
          ]}
        />
        {machines.length > 1 && (
          <Dropdown
            aria-label="Lọc theo máy tính"
            className="mt-0 w-56"
            value={filter.machine ?? ALL}
            onChange={(value) => setFilterAndReset({ ...filter, machine: value === ALL ? undefined : value })}
            options={[
              { value: ALL, label: 'Mọi máy tính' },
              ...machines.map((name) => ({ value: name, label: name || 'chưa rõ máy' })),
            ]}
          />
        )}
        {filtering && (
          <Button size="sm" variant="ghost" onClick={() => setFilterAndReset({})}>Bỏ lọc</Button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          Không có máy nào khớp bộ lọc.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Máy</TableHead>
                <TableHead>Trạng thái</TableHead>
                {/* "Ai đang giữ" chứ không phải "Đang bận vì": cột này trả lời
                    cả khi máy KHÔNG bận. */}
                <TableHead>Ai đang giữ</TableHead>
                <TableHead>Còn lại</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.groups.map((group) => {
                const closed = collapsed.has(group.key);
                return (
                  <GroupRows
                    key={group.key}
                    title={group.mine ? `${group.title} · máy của bạn` : group.title}
                    free={group.free}
                    total={groups.find((g) => g.key === group.key)?.list.length ?? group.list.length}
                    closed={closed}
                    onToggle={() => toggle(group.key)}
                  >
                    {!closed && group.list.map((row) => (
                      <DeviceRow
                        key={row.device.udid}
                        row={row}
                        job={row.lease?.holder.kind === 'job' ? jobById(row.lease.holder.jobId) : undefined}
                        secondsLeft={secondsLeft}
                        reclaim={row.lease ? renderReclaim(row.lease) : null}
                        onControl={() => void navigate({ to: '/control', search: { device: row.device.udid } })}
                      />
                    ))}
                  </GroupRows>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={Math.min(page, paged.pageCount)} pageCount={paged.pageCount} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, count, active, tone, onClick }: {
  label: string; count: number; active: boolean; tone?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
        active ? 'border-primary ring-primary/30 ring-2' : 'hover:bg-muted/50',
      )}
    >
      <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', tone ?? 'bg-muted')}>
        {count}
      </span>
      {label}
    </button>
  );
}

function GroupRows({ title, free, total, closed, onToggle, children }: {
  title: string; free: number; total: number; closed: boolean; onToggle: () => void;
  children: React.ReactNode;
}) {
  const Icon = closed ? ChevronRight : ChevronDown;
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={5} className="py-1.5">
          <button
            type="button"
            aria-expanded={!closed}
            onClick={onToggle}
            className="flex items-center gap-1.5 text-sm font-medium"
          >
            <Icon className="size-4" aria-hidden />
            {title}
            <span className="text-muted-foreground font-normal">· {free}/{total} rảnh</span>
          </button>
        </TableCell>
      </TableRow>
      {children}
    </>
  );
}

function DeviceRow({ row, job, secondsLeft, reclaim, onControl }: {
  row: InventoryRow;
  job: JobView | undefined;
  secondsLeft: (lease: DeviceLeaseView) => number;
  reclaim: React.ReactNode;
  onControl: () => void;
}) {
  const { device, lease, status } = row;
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
            {device.platform === 'ios' ? 'iOS' : 'Android'}
          </span>
          <span>{device.label}</span>
        </div>
        <div className="text-muted-foreground text-xs">{device.udid}</div>
      </TableCell>
      <TableCell>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_TONE[status])}>
          {STATUS_LABEL[status]}
        </span>
      </TableCell>
      <TableCell>
        {!lease && <span className="text-muted-foreground">không ai</span>}
        {lease?.holder.kind === 'human' && (
          // Tên đọc được do máy chủ tra — không phải mã người dùng.
          <span>
            <b>{lease.holderLabel ?? 'một người dùng khác'}</b> đang điều khiển
          </span>
        )}
        {lease?.holder.kind === 'job' && (
          <span>
            job đang chạy
            {job?.tag ? <> · <code>{job.tag}</code></> : null}
            {job?.platform ? ` · ${job.platform}` : ''}
          </span>
        )}
      </TableCell>
      <TableCell>{lease ? `${Math.max(0, secondsLeft(lease))}s` : '—'}</TableCell>
      <TableCell className="text-right">
        {status === 'free' && (
          // Máy rảnh: một cú bấm là tới màn Điều khiển với đúng máy này.
          <Button size="sm" variant="outline" onClick={onControl}>
            <MonitorSmartphone className="size-4" aria-hidden /> Điều khiển
          </Button>
        )}
        {reclaim}
      </TableCell>
    </TableRow>
  );
}
