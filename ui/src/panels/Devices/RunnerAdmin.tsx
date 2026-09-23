import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Plus } from 'lucide-react';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Dropdown } from '@/components/Dropdown';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RunnersResponse, RunnerView } from '@core/ui/contracts.js';

const REFRESH_MS = 5_000;

const STATE_LABEL: Record<RunnerView['state'], string> = {
  online: 'đang chạy',
  offline: 'đang tắt',
  revoked: 'đã thu hồi',
};

const MODE_LABEL: Record<RunnerView['mode'], string> = {
  personal: 'máy cá nhân',
  lab: 'máy dùng chung',
  farm: 'AWS Device Farm',
};

/**
 * Thêm và quản lý máy chạy test.
 *
 * Đây là cửa vào của cả mô hình: một chiếc điện thoại chỉ tới được hệ thống
 * qua một tiến trình `testpilot-runner` đang chạy trên chiếc máy tính mà nó
 * cắm vào. Trình duyệt không nói chuyện được với cổng USB — nên nếu không có
 * chỗ nào cấp token, không ai nối máy của mình vào được, và cả phần "mỗi người
 * dùng máy của mình" nằm im.
 *
 * Trước màn này, cách duy nhất là gọi `POST /api/runners` bằng tay.
 */
export function RunnerAdmin() {
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'personal' | 'lab'>('personal');
  /** Token hiện ĐÚNG MỘT LẦN, ngay sau khi tạo. Server chỉ giữ hash. */
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  const runners = useQuery({
    queryKey: ['runners'],
    queryFn: () => api.get<RunnersResponse>(ROUTES.runners),
    refetchInterval: REFRESH_MS,
  });

  const create = useMutation({
    mutationFn: () => api.post<{ runner: RunnerView; token: string }>(ROUTES.runners, {
      name: name.trim(),
      mode,
      // Máy dùng chung mới cho cả tổ chức thấy; máy cá nhân giữ riêng.
      visibility: mode === 'lab' ? 'shared' : 'private',
    }),
    onSuccess: (result) => {
      setFresh({ name: result.runner.name, token: result.token });
      setAdding(false);
      setName('');
      void client.invalidateQueries({ queryKey: ['runners'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.post<{ token: string }>(ROUTES.runnersRotate, { id }),
    onSuccess: (result, id) => {
      const runner = runners.data?.runners.find((item) => item.id === id);
      setFresh({ name: runner?.name ?? 'máy', token: result.token });
      toast.success('Token cũ đã chết. Cập nhật máy ấy trước khi nó đòi job lần sau.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.post<unknown>(ROUTES.runnersRevoke, { id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['runners'] });
      void client.invalidateQueries({ queryKey: ['device-targets'] });
      toast.success('Đã thu hồi. Máy ấy không nhận job được nữa.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const list = runners.data?.runners ?? [];

  return (
    <Card aria-labelledby="runner-admin-title">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle id="runner-admin-title">Máy chạy test</CardTitle>
          <CardDescription>
            Điện thoại chỉ tới được hệ thống qua một tiến trình runner chạy trên chính chiếc
            máy tính nó cắm vào — trình duyệt không nói chuyện được với cổng USB.
          </CardDescription>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            Thêm máy
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {adding && (
          <div className="border-border bg-muted/40 flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>Tên máy</span>
              <Input
                autoFocus
                value={name}
                placeholder="laptop của Bình"
                aria-label="Tên máy"
                className="h-9 w-56"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Loại</span>
              <Dropdown
                aria-label="Loại máy"
                className="mt-0 w-48"
                value={mode}
                onChange={(value) => setMode(value === 'lab' ? 'lab' : 'personal')}
                options={[
                  { value: 'personal', label: 'Máy cá nhân — chỉ mình tôi thấy' },
                  { value: 'lab', label: 'Máy dùng chung — cả đội thấy' },
                ]}
              />
            </label>
            <Button
              size="sm"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Tạo token
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setName(''); }}>
              Thôi
            </Button>
          </div>
        )}

        {fresh && <FreshToken name={fresh.name} token={fresh.token} onDone={() => setFresh(null)} />}

        {list.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Chưa máy nào đăng ký. Bấm <b>Thêm máy</b> để lấy token, rồi chạy runner trên chiếc
            máy tính có điện thoại cắm vào.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Máy</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((runner) => (
                <TableRow key={runner.id}>
                  <TableCell>
                    <div>{runner.name}</div>
                    <div className="text-muted-foreground text-xs">{runner.id.slice(0, 16)}…</div>
                  </TableCell>
                  <TableCell>{MODE_LABEL[runner.mode]}</TableCell>
                  <TableCell>
                    <span className={runner.state === 'online'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'}
                    >
                      {STATE_LABEL[runner.state]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {runner.state !== 'revoked' && (
                      <span className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rotate.isPending}
                          onClick={() => rotate.mutate(runner.id)}
                        >
                          Đổi token
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(runner.id)}
                        >
                          Thu hồi
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Token, hiện đúng một lần.
 *
 * Kèm luôn câu lệnh đã điền sẵn, vì một chuỗi bốn mươi ba ký tự tự nó không
 * nói cho ai biết phải làm gì với nó. Không có đường nào đọc lại token: server
 * chỉ giữ hash, và một đường đọc lại nghĩa là nó nằm ở dạng đọc được ở đâu đó.
 */
function FreshToken({
  name,
  token,
  onDone,
}: {
  name: string;
  token: string;
  onDone: () => void;
}) {
  const command = [
    `TESTPILOT_SERVER=${window.location.origin}`,
    `TESTPILOT_RUNNER_TOKEN=${token}`,
    `TESTPILOT_RUNNER_NAME="${name}"`,
    'npx testpilot-runner',
  ].join(' \\\n  ');

  return (
    <div className="border-primary/40 bg-card flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="font-medium">Token của “{name}” — chỉ hiện một lần</div>
      <p className="text-muted-foreground text-xs">
        Server chỉ giữ hash của nó, nên không có đường nào đọc lại. Mất thì bấm Đổi token.
      </p>
      {/*
        `code` + `whitespace-pre` chứ không phải thẻ preformatted: đây là một
        CÂU LỆNH, còn logViewUsage.test.ts chặn thẻ ấy mọc thêm ở panel để log
        chỉ có một nơi vẽ. Nới guard theo tên file thì lần sau một chỗ vẽ log
        thật lọt qua cùng đường ấy.
      */}
      <code className="bg-muted block overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre">
        {command}
      </code>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(command)
              .then(() => toast.success('Đã chép câu lệnh.'))
              // Trình duyệt từ chối chép khi trang không chạy trên HTTPS hoặc
              // localhost. Nói ra thay vì im lặng không làm gì.
              .catch(() => toast.error('Trình duyệt không cho chép; hãy bôi đen rồi chép tay.'));
          }}
        >
          <Copy className="size-3.5" aria-hidden />
          Chép câu lệnh
        </Button>
        <Button size="sm" onClick={onDone}>Đã lưu</Button>
      </div>
    </div>
  );
}
