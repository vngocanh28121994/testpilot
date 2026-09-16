import {
  buildShotEvidence,
  EVIDENCE_GROUPS,
  KNOWN_ISSUE_GROUP,
  sortEvidenceTimeline,
  type EvidenceKind,
} from '@evidence';
import type { ReportView } from '@core/ui/contracts.js';
import { ChevronRight } from 'lucide-react';

/**
 * Ảnh chụp màn hình của một lượt chạy.
 *
 * Tách ra dùng chung vì màn lịch sử local đã có lưới này từ lâu, còn màn chi
 * tiết farm thì không — cùng một lượt chạy, xem ở hai chỗ thì thấy hai lượng
 * thông tin khác nhau, và chỗ thiếu lại đúng là chỗ khó dựng lại nhất: máy nằm
 * ở AWS, không cắm vào đâu để xem lại.
 *
 * Ảnh chụp lúc hỏng là thứ trả lời nhanh nhất câu "màn hình đang ở đâu khi nó
 * đỏ" — hôm nay chính nó cho thấy app đã đăng nhập và vào tới Bảng giá, trong
 * khi log chỉ nói "bấm lỗi".
 */
export function RunShots({ report }: { report: Pick<ReportView, 'shotUrls' | 'chapters'> }) {
  if (!report.shotUrls?.length) return null;
  const items = buildShotEvidence(report.shotUrls, report.chapters ?? []);
  const groups = [EVIDENCE_GROUPS[0], KNOWN_ISSUE_GROUP, ...EVIDENCE_GROUPS.slice(1)].map((group) => ({
    ...group,
    items: sortEvidenceTimeline(
      items.filter((item) => item.kind === group.kind),
      (item) => item.at,
    ),
  }));
  const hasFailures = groups[0]!.items.length > 0;

  return (
    <section className="mt-4 flex flex-col gap-3" aria-label="Ảnh theo kết quả testcase">
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <details
          key={group.kind}
          open={group.kind === 'failed' || group.kind === 'known' || (!hasFailures && group.kind === 'passed')}
          className="group rounded-lg"
        >
          <summary
            aria-label={`${group.title}: ${group.items.length} ảnh — xem hoặc ẩn chi tiết`}
            className="border-border bg-card hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none group-open:rounded-b-none group-open:bg-muted/50"
          >
            <StatusBadge kind={group.kind} text={group.badge} />
            <span>{group.title}</span>
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-normal">
              {group.items.length} ảnh
            </span>
            <span className="text-primary ms-auto inline-flex items-center gap-1 text-xs font-medium">
              <span className="hidden sm:inline">Xem/ẩn chi tiết</span>
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
            </span>
          </summary>
          <div className="border-border grid grid-cols-1 gap-3 rounded-b-lg border border-t-0 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map(({ shot, label, kind }) => (
              <a
                key={shot.url}
                href={shot.url}
                target="_blank"
                rel="noreferrer"
                className={cardClass(kind)}
              >
                <div className="flex items-start gap-2 px-3 py-2">
                  <StatusBadge kind={kind} text={kind === 'failed' ? 'FAIL' : kind === 'known' ? 'KNOWN ISSUE' : kind === 'passed' ? 'PASS' : 'INFO'} />
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-xs font-medium">
                      {label.scenario || (kind === 'failed' ? 'Ảnh tại bước lỗi' : 'Ảnh bổ sung')}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-[0.6875rem]">{label.detail}</div>
                    {shot.error && (
                      <div
                        className="text-status-fail mt-1 line-clamp-2 text-[0.6875rem]"
                        title={shot.error}
                      >
                        {shot.error}
                      </div>
                    )}
                    {shot.knownIssue && (
                      <div className="text-status-flaky mt-1 text-[0.6875rem]">
                        Lý do: {shot.knownIssue}
                      </div>
                    )}
                  </div>
                </div>
                <img
                  className="border-border block w-full border-t object-contain"
                  src={shot.url}
                  loading="lazy"
                  // alt là toàn bộ thông tin còn lại khi ảnh không tải được.
                  alt={[label.scenario, label.detail].filter(Boolean).join(' — ')}
                />
              </a>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

function StatusBadge({ kind, text }: { kind: EvidenceKind; text: string }) {
  const tone = kind === 'failed'
    ? 'bg-status-fail/10 text-status-fail'
    : kind === 'known'
      ? 'bg-status-flaky/10 text-status-flaky'
    : kind === 'passed'
      ? 'bg-status-pass/10 text-status-pass'
      : 'bg-muted text-muted-foreground';
  return <span className={`${tone} shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-semibold`}>{text}</span>;
}

function cardClass(kind: EvidenceKind): string {
  const tone = kind === 'failed'
    ? 'border-status-fail/40 bg-(--tint-fail)'
    : kind === 'known'
      ? 'border-status-flaky/40 bg-(--tint-warn)'
    : kind === 'passed'
      ? 'border-status-pass/30 bg-card'
      : 'border-border bg-card';
  return `${tone} flex flex-col overflow-hidden rounded-lg border transition-shadow hover:shadow-md`;
}
