import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { Button } from '@/components/ui/button';

import type { UnregisteredDevice } from '@core/core/preflight.js';

/**
 * Máy đang cắm mà config chưa biết, kèm nút thêm.
 *
 * Vì sao cần: cắm một chiếc điện thoại vào rồi mở web lên, người dùng thấy
 * dòng "2 máy sẵn sàng" nhưng chỉ chạy được một máy — chiếc kia không có trong
 * `testpilot.config.json` nên không xuất hiện ở bất kỳ ô chọn nào. Cách sửa
 * vốn có (`npm run devices:sync`) nằm trong một terminal, và người đang nhìn
 * màn hình không có lý do gì để biết nó tồn tại.
 *
 * Hiện `id` sẽ nhận TRƯỚC khi bấm. Đó là cái tên sẽ đi vào tên thư mục lượt
 * chạy và vào sổ healing, nên nó không phải chi tiết kỹ thuật — nó là thứ
 * người ta sẽ đọc mỗi lần mở lại một lượt chạy cũ.
 */
export function RegisterDevices({
  platform,
  devices,
}: {
  platform: 'android' | 'ios';
  devices: UnregisteredDevice[];
}) {
  const client = useQueryClient();
  const add = useMutation({
    mutationFn: (udids: string[]) =>
      api.post<{ added: Array<{ id: string }> }>(ROUTES.devicesRegister, { platform, udids }),
    onSuccess: (result) => {
      // Preflight phải hỏi lại: máy vừa thêm giờ mới là một lựa chọn, và ô
      // chọn máy chỉ mọc ra từ câu trả lời mới.
      void client.invalidateQueries({ queryKey: ['preflight'] });
      void client.invalidateQueries({ queryKey: ['state'] });
      const names = result.added.map((device) => device.id).join(', ');
      toast.success(result.added.length > 0
        ? `Đã thêm ${names} vào cấu hình. Giờ chọn được máy này để chạy.`
        : 'Cấu hình đã có đủ những máy này.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (devices.length === 0) return null;

  return (
    <div className="border-border bg-muted/40 flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="text-muted-foreground">
        {devices.length === 1 ? 'Một máy đang cắm' : `${devices.length} máy đang cắm`} nhưng chưa
        có trong cấu hình, nên chưa chọn để chạy được:
      </div>
      <ul className="flex flex-col gap-2">
        {devices.map((device) => (
          <li key={device.udid} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{device.model ?? device.udid}</span>
            <span className="text-muted-foreground text-xs">{device.udid}</span>
            <span className="text-muted-foreground text-xs">
              → sẽ đặt tên <code>{device.suggestedId}</code>
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ms-auto"
              disabled={add.isPending}
              onClick={() => add.mutate([device.udid])}
            >
              <Plus className="size-3.5" aria-hidden />
              Thêm vào cấu hình
            </Button>
          </li>
        ))}
      </ul>
      {devices.length > 1 && (
        <Button
          size="sm"
          variant="ghost"
          className="self-end"
          disabled={add.isPending}
          onClick={() => add.mutate(devices.map((device) => device.udid))}
        >
          Thêm tất cả
        </Button>
      )}
    </div>
  );
}
