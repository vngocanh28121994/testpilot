import { useQueries } from '@tanstack/react-query';
import { DevicePicker } from '@/components/DevicePicker';
import { PreflightChecks } from '@/components/PreflightChecks';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type { PreflightResponse } from '@core/ui/contracts.js';

export type NativePlatform = 'android' | 'ios';

/**
 * Viết thẳng ra thay vì để CSS `capitalize` lo: `capitalize` viết hoa mọi từ
 * nên "ios" thành "Ios" và câu kết luận cũng bị viết hoa lung tung.
 */
const LABEL: Record<NativePlatform, string> = { android: 'Android', ios: 'iOS' };

/**
 * Môi trường đã sẵn sàng để chạy chưa, hỏi ngay lúc tick nền tảng.
 *
 * Web chỉ cần một URL nên không nói gì. Android và iOS cần máy cắm vào, Appium
 * đang chạy và một bản build — ô tick không cho thấy thứ nào trong số đó. Thiếu
 * bảng này thì phải chờ workflow đọc xong tài liệu, gọi model hai lần và chờ
 * người duyệt kịch bản rồi mới biết là thiếu máy.
 */
export function WorkflowPreflight({
  platforms,
  devices,
  onPick,
}: {
  platforms: NativePlatform[];
  devices: Partial<Record<NativePlatform, string>>;
  onPick: (platform: NativePlatform, id: string) => void;
}) {
  // useQueries thay vì tự đếm token chống đua: khoá cache đã gồm cả máy đang
  // chọn, nên câu trả lời của lần dò cũ không thể ghi đè lần mới, và tick hai ô
  // thật nhanh cũng chỉ ra hai truy vấn độc lập.
  const probes = useQueries({
    queries: platforms.map((platform) => {
      const device = devices[platform];
      return {
        queryKey: ['preflight', platform, device ?? ''] as const,
        // Lựa chọn đi kèm luôn với lần dò: server đọc config đã lưu, mà máy vừa
        // được chọn một giây trước thì chưa nằm trong đó.
        queryFn: () =>
          api.get<PreflightResponse>(
            `${ROUTES.preflight}?platform=${encodeURIComponent(platform)}` +
              (device ? `&device=${encodeURIComponent(device)}` : ''),
          ),
      };
    }),
  });

  if (platforms.length === 0) return null;

  return (
    <div className="flex flex-col gap-3" aria-label="Kiểm tra môi trường">
      {platforms.map((platform, i) => {
        const probe = probes[i]!;
        if (probe.isPending) {
          return (
            <p key={platform} className="text-muted-foreground text-xs">
              {LABEL[platform]} — đang kiểm tra môi trường…
            </p>
          );
        }
        // Lỗi mạng hiện ra như một mục kiểm tra hỏng, không phải một khoảng
        // trống: "không thấy gì" và "chưa hỏi được" trông giống hệt nhau.
        const result: PreflightResponse = probe.data ?? {
          platform,
          ok: false,
          checks: [{ name: 'Kiểm tra', ok: false, detail: (probe.error as Error).message }],
        };
        return (
          <div key={platform} className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3">
            <div className="text-sm font-medium">
              {LABEL[platform]} — {result.ok ? 'sẵn sàng' : 'chưa chạy được'}
            </div>
            <PreflightChecks checks={result.checks} />
            {/* Câu hỏi được hỏi ngay tại chỗ phát hiện ra nó. Đẩy người dùng đi
                sửa file config để trả lời một câu mà màn hình đã biết là cách
                giữ cho một lượt chạy bị chặn cứ bị chặn mãi. */}
            {(result.candidates?.length ?? 0) > 1 && (
              <DevicePicker
                name={platform}
                candidates={result.candidates!}
                chosen={devices[platform]}
                onPick={(id) => onPick(platform, id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
