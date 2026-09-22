import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleAlert, CircleHelp } from 'lucide-react';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RunnersResponse, RunnerView } from '@core/ui/contracts.js';

/** Cùng nhịp với bảng thiết bị ngay trên: hai nhịp khác nhau trong một màn
 *  hình làm hai nửa của cùng một sự thật lệch nhau trước mắt người đọc. */
const REFRESH_MS = 5_000;

const PLATFORMS = ['web', 'android', 'ios'] as const;

/**
 * Máy chạy test, và mỗi máy thiếu gì.
 *
 * Đây là nửa còn lại của P4.5. Nửa đầu đã có: runner ĐO môi trường của mình và
 * từ chối job nó không chạy được, kèm câu nói rõ việc cần làm. Nhưng câu ấy
 * chỉ tới tay người ĐẶT job, sau khi họ đã đặt — còn chủ chiếc máy, người duy
 * nhất sửa được, thì không thấy gì cả.
 *
 * Nên bảng này trả lời một câu hỏi rất cụ thể: "máy nào trong đội đang không
 * chạy được iOS, và vì sao". Trước khi ai đó đặt job, không phải sau.
 */
export function RunnerHealth() {
  const runners = useQuery({
    queryKey: ['runners'],
    queryFn: () => api.get<RunnersResponse>(ROUTES.runners),
    refetchInterval: REFRESH_MS,
  });
  const list = runners.data?.runners ?? [];

  return (
    <Card aria-labelledby="runners-title">
      <CardHeader>
        <CardTitle id="runners-title">Máy chạy test</CardTitle>
        <CardDescription>
          Mỗi máy tự đo môi trường của nó — server không cắm thiết bị nào và không có Appium.
          Ô trống nghĩa là máy ấy chưa đo, không phải là nó hỏng.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Chưa máy nào đăng ký. Thêm máy ở màn Personal Settings, rồi chạy runner trên máy ấy.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Máy</TableHead>
                <TableHead>Trạng thái</TableHead>
                {PLATFORMS.map((platform) => (
                  <TableHead key={platform}>{platform}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((runner) => (
                <TableRow key={runner.id}>
                  <TableCell>
                    <b>{runner.name}</b>
                    <span className="text-muted-foreground ms-2 text-xs">{runner.mode}</span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        runner.state === 'online'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {STATE_LABEL[runner.state]}
                    </span>
                  </TableCell>
                  {PLATFORMS.map((platform) => (
                    <TableCell key={platform}>
                      <PlatformCell runner={runner} platform={platform} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const STATE_LABEL: Record<RunnerView['state'], string> = {
  online: 'đang chạy',
  offline: 'đang tắt',
  revoked: 'đã thu hồi',
};

/**
 * Một ô: nền tảng này chạy được trên máy này không.
 *
 * Ba trạng thái chứ không phải hai, và trạng thái thứ ba là điểm chính: CHƯA
 * ĐO khác với HỎNG. Vẽ chúng giống nhau nghĩa là ai đó sẽ đi sửa một chiếc máy
 * hoàn toàn tốt vừa khởi động xong.
 */
function PlatformCell({
  runner,
  platform,
}: {
  runner: RunnerView;
  platform: 'web' | 'android' | 'ios';
}) {
  const report = runner.prereq?.[platform];
  if (!report) {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <CircleHelp className="size-3.5" aria-hidden />
        chưa đo
      </span>
    );
  }
  if (report.ok) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="size-3.5" aria-hidden />
        sẵn sàng
      </span>
    );
  }
  return (
    // Lý do nằm ngay trong ô, không nấp sau một tooltip: người đọc bảng này
    // đang đi tìm việc cần làm, và bắt họ rê chuột lên từng ô để biết việc gì
    // là đúng thứ khiến người ta thôi mở bảng.
    <span className="text-destructive flex max-w-72 items-start gap-1 whitespace-normal text-xs">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {report.reason ?? 'chưa chạy được'}
    </span>
  );
}
