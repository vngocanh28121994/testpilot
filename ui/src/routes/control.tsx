import { createFileRoute } from '@tanstack/react-router';
import DeviceControlPanel from '@/panels/DeviceControl';

/**
 * `?device=<udid>`: mở màn điều khiển với máy ấy đã chọn sẵn — từ nút
 * "Điều khiển" ở danh sách thiết bị. Chỉ CHỌN, không tự giữ máy: giữ máy là
 * một hành động có hệ quả với người khác, nên vẫn là một cú bấm của người dùng.
 */
export const Route = createFileRoute('/control')({
  component: DeviceControlPanel,
  validateSearch: (search: Record<string, unknown>): { device?: string } =>
    typeof search.device === 'string' && search.device ? { device: search.device } : {},
});
