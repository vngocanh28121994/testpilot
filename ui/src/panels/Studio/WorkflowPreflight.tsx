import { useEffect } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { DevicePicker } from '@/components/DevicePicker';
import { PreflightChecks } from '@/components/PreflightChecks';
import { RegisterDevices } from '@/components/RegisterDevices';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type { ControlTargetsResponse, PreflightResponse } from '@core/ui/contracts.js';

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
  appSource,
}: {
  platforms: NativePlatform[];
  devices: Partial<Record<NativePlatform, string>>;
  onPick: (platform: NativePlatform, id: string) => void;
  /**
   * Nguồn app đã chọn ở ngay dưới. Đi kèm câu hỏi vì với máy ở runner khác,
   * "bản đã tải lên" là thứ chưa gửi sang được — và màn hình phải nói điều đó
   * trước khi người ta bấm chạy, không phải sau.
   */
  appSource?: 'device' | 'upload';
}) {
  /**
   * Máy để chọn — lấy từ SỔ MÁY, giống hệt Local Runner.
   *
   * Bản trước lấy từ phép dò của chính máy chủ (`result.candidates`), nên nó
   * không bao giờ thấy chiếc điện thoại cắm ở laptop người khác — và khi chưa
   * chọn máy nào, nó báo "Chưa có máy nào kết nối" trong khi máy đang cắm ở
   * đó, sẵn sàng. Workflow nay chạy được trên những máy ấy qua hàng đợi job
   * (xem `server/remoteRuns.ts`), nên chúng phải hiện ra để chọn.
   */
  const registry = useQuery({
    queryKey: ['device-targets'],
    queryFn: () => api.get<ControlTargetsResponse>(ROUTES.deviceTargets),
    refetchInterval: 10_000,
  });
  const candidatesFor = (platform: NativePlatform) => (registry.data?.devices ?? [])
    .filter((device) => device.platform === platform)
    .map((device) => ({
      id: device.udid,
      label: device.label,
      ...(device.runnerName ? { runnerName: device.runnerName } : {}),
      ...(device.mine !== undefined ? { mine: device.mine } : {}),
      offline: Boolean(device.offline),
    }));

  // Một máy đang chạy duy nhất thì KHÔNG có gì để hỏi — nó là máy sẽ chạy.
  // Chọn hộ và ghi vào lựa chọn thật, vì workflow đọc đúng lựa chọn ấy: chỉ
  // "hiện như đã chọn" trên màn hình mà không ghi lại thì màn hình nói một
  // đằng, lượt chạy đi một nẻo.
  useEffect(() => {
    for (const platform of platforms) {
      if (devices[platform]) continue;
      const online = candidatesFor(platform).filter((item) => !item.offline);
      if (online.length === 1) onPick(platform, online[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry.data, platforms.join(','), devices.android, devices.ios]);

  // useQueries thay vì tự đếm token chống đua: khoá cache đã gồm cả máy đang
  // chọn, nên câu trả lời của lần dò cũ không thể ghi đè lần mới, và tick hai ô
  // thật nhanh cũng chỉ ra hai truy vấn độc lập.
  const probes = useQueries({
    queries: platforms.map((platform) => {
      const device = devices[platform];
      return {
        queryKey: ['preflight', platform, device ?? '', appSource ?? ''] as const,
        // Lựa chọn đi kèm luôn với lần dò: server đọc config đã lưu, mà máy vừa
        // được chọn một giây trước thì chưa nằm trong đó.
        queryFn: () =>
          api.get<PreflightResponse>(
            `${ROUTES.preflight}?platform=${encodeURIComponent(platform)}` +
              (device ? `&device=${encodeURIComponent(device)}` : '') +
              (appSource ? `&appSource=${appSource}` : ''),
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
            <PreflightChecks
              checks={result.checks}
              // Nút sửa làm trên ĐÚNG máy cắm thiết bị — máy chủ hay laptop của
              // người dùng — và nói trước là máy nào.
              target={{ platform: result.platform, device: result.device, host: result.host }}
            />
            {/* Cùng một lý do với ô chọn máy ngay dưới: câu hỏi được hỏi ngay
                tại chỗ phát hiện ra nó. Workflow dùng chung `resolveDevice`
                với màn Local Runner, nên máy chưa khai làm hỏng cả hai chỗ
                theo đúng một kiểu — và được sửa ở cả hai bằng cùng một nút. */}
            {(result.unregistered?.length ?? 0) > 0 && (
              <RegisterDevices platform={platform} devices={result.unregistered!} />
            )}
            {/* Câu hỏi được hỏi ngay tại chỗ phát hiện ra nó. Đẩy người dùng đi
                sửa file config để trả lời một câu mà màn hình đã biết là cách
                giữ cho một lượt chạy bị chặn cứ bị chặn mãi. */}
            {candidatesFor(platform).length > 1 && (
              <DevicePicker
                name={platform}
                candidates={candidatesFor(platform)}
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
