import { useRef, useState } from 'react';
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
  const chapters = whole ? (report.chapters ?? []) : [];

  const seek = (seconds: number) => {
    const el = video.current;
    if (!el) return;
    el.currentTime = Math.max(0, (skipped ?? 0) + seconds);
    void el.play().catch(() => {});
  };

  return (
    <figure className="mt-3 flex flex-col gap-2">
      <video
        ref={video}
        className="max-w-full"
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
        <ul className="flex flex-wrap gap-1.5">
          {chapters.map((chapter) => (
            <li key={`${chapter.name}-${chapter.at}`}>
              <button
                type="button"
                className="border-border hover:bg-muted rounded border px-2 py-1 text-left text-xs"
                onClick={() => seek(chapter.at)}
              >
                <span className={chapter.status === 'passed' ? 'text-status-pass' : 'text-status-fail'}>
                  ●
                </span>{' '}
                {chapter.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
