import { useMemo, useRef, useState } from 'react';
import type { ReportView } from '@core/ui/contracts.js';

/**
 * Bản ghi màn hình của một lượt chạy, mở ra ở đúng chỗ đáng xem.
 *
 * Hai thứ mà một thẻ `<video>` trần không có, và người dùng đã phải tự mò:
 *
 * 1. Bản ghi bắt đầu từ lúc máy còn đang cài app. Dựng phiên Appium mất khoảng
 *    mười tám giây trên máy thật, và suốt quãng đó màn hình không liên quan gì
 *    tới bài test — thả người xem xuống giây 0 là bắt họ tua tay mỗi lần.
 * 2. Chạy nhiều kịch bản thì tất cả nằm trong MỘT file. Không có mốc thì muốn
 *    xem kịch bản thứ tư phải đoán nó ở phút thứ mấy.
 *
 * Cả hai dữ liệu đều do server tính sẵn và gửi kèm report từ lâu; phần còn
 * thiếu chỉ là dùng chúng.
 *
 * Không cắt file: đoạn cài đặt là đúng chỗ một lỗi cài đặt sẽ lộ ra, nên thanh
 * tua vẫn về được giây 0.
 */
export function RunVideo({
  url,
  report,
}: {
  url: string;
  report: Pick<ReportView, 'chapters' | 'testSeconds' | 'wholeVideoUrls'>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [skipped, setSkipped] = useState<number | null>(null);
  // Chỉ bản ghi CẢ lượt mới có đoạn cài đặt để bỏ qua và nhiều kịch bản để đánh
  // mốc. Clip riêng của một kịch bản vốn đã bắt đầu ở đúng chỗ của nó.
  const whole = report.wholeVideoUrls?.includes(url) ?? false;
  const chapters = useMemo(() => {
    if (!whole) return [];
    // Server normally sends timeline order, but imported/older reports are not
    // guaranteed to. Keep equal timestamps stable so a retry at the same
    // recorded second cannot jump around between renders.
    return (report.chapters ?? [])
      .map((chapter, index) => ({ chapter, index }))
      .sort((left, right) => {
        const leftAt = Number.isFinite(left.chapter.at) ? left.chapter.at : Number.POSITIVE_INFINITY;
        const rightAt = Number.isFinite(right.chapter.at) ? right.chapter.at : Number.POSITIVE_INFINITY;
        return leftAt - rightAt || left.index - right.index;
      })
      .map(({ chapter }) => chapter);
  }, [report.chapters, whole]);

  const seek = (seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, (skipped ?? 0) + seconds);
    void el.play().catch(() => {});
  };

  return (
    <figure className="mt-3 flex flex-col gap-2">
      {/* Bản ghi của điện thoại là khung dọc, nên `max-w-full` cho ra một cột
          cao gần bằng cả màn hình — phần còn lại của báo cáo bị đẩy xuống dưới
          tầm mắt. Giới hạn theo CHIỀU CAO thay vì chiều ngang: video dọc thì
          chiều cao mới là cái tràn. */}
      <video
        ref={video}
        className="max-h-[28rem] max-w-full self-start rounded"
        controls
        preload="metadata"
        src={url}
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          const test = whole ? report.testSeconds : undefined;
          if (!test || !Number.isFinite(el.duration)) return;
          // Chừa lại hai giây dọn dẹp thay vì mạo hiểm nhảy qua mất thứ đầu
          // tiên đáng xem.
          const skip = Math.max(0, el.duration - test - 2);
          if (skip < 1) return;
          el.currentTime = skip;
          setSkipped(skip);
        }}
      />
      {skipped !== null && (
        <figcaption className="text-muted-foreground text-xs">
          Đã bỏ qua {Math.round(skipped)} giây cài đặt — kéo về đầu để xem lại đoạn đó.
        </figcaption>
      )}
      {chapters.length > 1 && (
        <ol className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {chapters.map((chapter, index) => {
            const videoAt = Math.max(0, (skipped ?? 0) + chapter.at);
            return (
              <li key={`${chapter.name}-${chapter.at}-${index}`}>
                <button
                  type="button"
                  className="border-border hover:bg-muted flex h-full w-full items-start gap-2 rounded border px-2 py-1.5 text-left text-xs"
                  onClick={() => seek(chapter.at)}
                >
                  <time
                    className="text-muted-foreground shrink-0 font-mono text-[0.6875rem] leading-5 tabular-nums"
                    dateTime={`PT${videoAt.toFixed(3)}S`}
                  >
                    {formatTimestamp(videoAt)}
                  </time>
                  <span className={chapter.status === 'passed' ? 'text-status-pass leading-5' : 'text-status-fail leading-5'}>
                    ●
                  </span>
                  <span className="leading-5">{chapter.name}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </figure>
  );
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':')
    : [minutes, rest].map((part) => String(part).padStart(2, '0')).join(':');
}
