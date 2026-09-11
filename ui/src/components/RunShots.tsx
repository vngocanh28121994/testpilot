import { shotLabel } from '@/lib/shotName';
import type { ReportView } from '@core/ui/contracts.js';

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
export function RunShots({ report }: { report: Pick<ReportView, 'shotUrls'> }) {
  if (!report.shotUrls?.length) return null;
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {report.shotUrls.map((shot) => {
        const label = shotLabel(shot.name, shot.onFailure);
        return (
          <a
            key={shot.url}
            href={shot.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-1"
          >
            <img
              className="border-border rounded border"
              src={shot.url}
              // alt là toàn bộ thông tin còn lại khi ảnh không tải được.
              alt={[label.scenario, label.detail].filter(Boolean).join(' — ')}
            />
            {label.scenario && <span className="text-xs font-medium">{label.scenario}</span>}
            <span className="text-muted-foreground text-xs">{label.detail}</span>
          </a>
        );
      })}
    </div>
  );
}
