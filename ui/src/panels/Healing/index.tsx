import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { navTitle } from '@/lib/nav';
import { Dropdown } from '@/components/Dropdown';
import { useHealing, useReviewHealing } from './hooks/useHealing';
import {
  PLATFORM_OPTIONS,
  STATUS_OPTIONS,
  useFilteredRecords,
  type PlatformFilter,
  type StatusFilter,
} from './hooks/useHealingFilters';
import { HealingRow } from './HealingRow';
import { DuplicateElements } from './DuplicateElements';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/Pagination';
import { Clock, CircleCheckBig, CircleSlash, Eye } from 'lucide-react';
import { Field } from '@/components/Field';
import { StatTile } from '@/components/StatTile';
import { TINTS } from '@/lib/tints';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const HEADERS = [
  'Element',
  'Platform',
  'Primary hiện tại',
  'Locator đã fail',
  'Locator phục hồi',
  'Heals',
  'Runs',
  'Máy',
  'Lần cuối',
  'Trạng thái',
  '',
];

const PAGE_DESCRIPTION = 'Locator được Playwright/Appium phục hồi qua nhiều lần chạy.';
const PAGE_SIZE = 20;

/** Bốn ô tổng hợp. Nhãn là hợp đồng với HealingPanel.test.tsx. */
const STATS = [
  { key: 'proposed', label: 'Chờ duyệt', icon: Clock, tint: TINTS.amber },
  { key: 'watching', label: 'Đang theo dõi', icon: Eye, tint: TINTS.sky },
  { key: 'applied', label: 'Đã áp dụng', icon: CircleCheckBig, tint: TINTS.emerald },
  { key: 'rejected', label: 'Đã từ chối', icon: CircleSlash, tint: TINTS.slate },
] as const;

export default function HealingPanel() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [page, setPage] = useState(1);
  // Bản ghi nào đang chờ xác nhận bước hai. Chỉ một tại một thời điểm, giống
  // biến `healingPending` của bản cũ (app.js:1078).
  const [pending, setPending] = useState<{ id: string; action: 'apply' | 'reject' } | null>(null);

  const query = useHealing();
  const review = useReviewHealing();
  const records = useFilteredRecords(query.data?.records, status, platform);
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRecords = records.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const summary = query.data?.summary;
  const policy = query.data?.policy;
  const duplicates = query.data?.duplicates ?? [];
  const [tab, setTab] = useState('records');

  return (
    <AppShell title={navTitle('healing-center')} description={PAGE_DESCRIPTION}>
      <section aria-label="Healing Center" className="flex flex-1 flex-col gap-6">
        {query.isError && (
          <p role="alert" className="text-destructive text-sm">
            {(query.error as Error).message}
          </p>
        )}

        {/* Hai bảng, hai tab. Trùng vai là phát hiện BẢO TRÌ registry, còn
            bản ghi healing là chuyện của locator qua các lượt chạy — hai câu
            hỏi khác nhau, và người ta tới trang này để trả lời một trong hai
            chứ không phải cả hai cùng lúc.
            
            Xếp chồng thì số cặp trùng vai tăng theo số feature được soạn, và
            mười cặp là đủ đẩy bảng healing ra khỏi màn hình. Số ngay trên nhãn
            tab để biết bên kia có gì mà không phải bấm sang xem. */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="records">
              Bản ghi healing
              <TabCount value={query.data?.records.length ?? 0} />
            </TabsTrigger>
            <TabsTrigger value="duplicates">
              Element trùng vai
              <TabCount value={duplicates.length} />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="records" className="gap-6">
        {/* Nhóm lại để test (và trình đọc màn hình) phân biệt được ô thống kê
            "Chờ duyệt" với option cùng tên trong bộ lọc và với pill trong bảng. */}
        <div
          role="group"
          aria-label="Tổng hợp healing"
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {STATS.map(({ key, label, icon, tint }) => (
            <StatTile
              key={key}
              label={label}
              value={summary?.[key] ?? 0}
              icon={icon}
              tint={tint}
              loading={query.isPending}
            />
          ))}
        </div>

        <Card aria-labelledby="records-title">
          <CardHeader>
            <CardTitle id="records-title">Bản ghi healing</CardTitle>
            <CardDescription>
              Chỉ locator đủ bằng chứng mới được áp dụng làm primary.
            </CardDescription>
            {/* Câu policy đứng riêng một element: gộp vào CardDescription thì
                nó thành một mẩu trong câu dài hơn và không còn tra cứu được
                bằng đúng chuỗi đó nữa — cả cho test lẫn cho Ctrl+F. */}
            {policy && (
              <CardAction className="text-muted-foreground self-center text-xs">
                Đề xuất khi ≥ {policy.minSuccesses} lần heal qua ≥ {policy.minRuns} run
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
              <Field label="Trạng thái">
                <Dropdown
                  aria-label="Trạng thái"
                  className="mt-0"
                  value={status}
                  onChange={(next) => {
                    setStatus(next as StatusFilter);
                    setPage(1);
                  }}
                  options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </Field>
              <Field label="Platform">
                <Dropdown
                  aria-label="Platform"
                  className="mt-0"
                  value={platform}
                  onChange={(next) => {
                    setPlatform(next as PlatformFilter);
                    setPage(1);
                  }}
                  options={PLATFORM_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </Field>
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    {HEADERS.map((h, i) => (
                      <TableHead
                        key={h || i}
                        className={`px-2 py-2 font-medium ${i >= 5 && i <= 7 ? 'text-right' : ''}`}
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.isPending && (
                    <TableRow>
                      <TableCell
                        colSpan={HEADERS.length} className="text-muted-foreground px-2 py-6 text-center"
                      >
                        Đang tải healing telemetry…
                      </TableCell>
                    </TableRow>
                  )}
                  {!query.isPending && records.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={HEADERS.length} className="text-muted-foreground px-2 py-6 text-center"
                      >
                        Không có healing record khớp bộ lọc.
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleRecords.map((r) => (
                    <HealingRow
                      key={r.id}
                      record={r}
                      pending={pending?.id === r.id ? pending.action : null}
                      busy={review.isPending && review.variables?.id === r.id}
                      onRequest={(action) => setPending({ id: r.id, action })}
                      onCancel={() => setPending(null)}
                      onConfirm={(action) =>
                        review.mutate({ id: r.id, action }, { onSuccess: () => setPending(null) })
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="duplicates">
            <Card aria-labelledby="duplicates-title">
              <CardHeader>
                <CardTitle id="duplicates-title">Element trùng vai</CardTitle>
                <CardDescription>
                  Hai bản ghi cùng thắng bằng một locator riêng biệt, nên nhiều khả năng
                  chúng trỏ vào cùng một control. Bản mới luôn bắt đầu lại từ locator yếu.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DuplicateElements items={duplicates} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </AppShell>
  );
}

/**
 * Số bên cạnh nhãn tab.
 *
 * Không phải trang trí: người ta tới trang này để trả lời một trong hai câu
 * hỏi, và nếu không thấy bên kia có gì thì tab kia coi như không tồn tại. Số 0
 * cũng được hiện, vì "đã sạch" là một câu trả lời.
 */
function TabCount({ value }: { value: number }) {
  return (
    <span className="bg-muted-foreground/15 rounded px-1.5 py-0.5 text-[11px] tabular-nums">
      {value}
    </span>
  );
}
