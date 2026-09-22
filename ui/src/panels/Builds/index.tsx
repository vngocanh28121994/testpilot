import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { navTitle } from '@/lib/nav';

const PAGE_DESCRIPTION = 'Bản build dùng cho local run, workflow và Device Farm.';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { uploadBuild } from '@/api/upload';
import type { BuildsResponse } from '@core/ui/contracts.js';

export default function BuildsPanel() {
  const client = useQueryClient();
  const builds = useQuery({ queryKey: ['builds'], queryFn: () => api.get<BuildsResponse>(ROUTES.builds) });
  const refresh = (): void => {
    void Promise.all([
      client.invalidateQueries({ queryKey: ['builds'] }),
      client.invalidateQueries({ queryKey: ['state'] }),
    ]);
  };
  // Bảng nằm trong Card như mọi panel khác. Không phải để cho đẹp: nền chấm
  // động của AppShell vẽ xuyên qua bất cứ gì không có màu nền riêng, và bảng
  // trần là chỗ duy nhất trong app bị nó làm chìm chữ.
  return (
    <AppShell title={navTitle('builds')} description={PAGE_DESCRIPTION}>
      <Card>
        <CardHeader>
          {/* Chỉ phần ĐỘNG ở lại đây. Câu giới thiệu trang đã nằm trên đầu
              trang cùng chỗ với mọi trang khác — nói hai lần trong một màn
              hình thì lần thứ hai chỉ là tiếng ồn. */}
          <CardDescription>
            {builds.data ? `File cất ở ${builds.data.root}.` : 'Đang tìm thư mục build…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {builds.isError && (
            <p role="alert" className="text-destructive">
              {(builds.error as Error).message}
            </p>
          )}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Môi trường</TableHead>
                  <TableHead>Android (.apk)</TableHead>
                  <TableHead>iOS (.ipa)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {builds.isPending && (
                  <TableRow>
                    <TableCell colSpan={3} className="p-6 text-center">
                      Đang tải…
                    </TableCell>
                  </TableRow>
                )}
                {builds.data?.environments.map((row) => (
                  <TableRow key={row.env || 'shared'}>
                    <TableCell>
                      <b>{(row.env || 'Dùng chung').toUpperCase()}</b>
                      {row.isDefault && row.env && (
                        <span className="text-muted-foreground ms-2 text-xs">mặc định</span>
                      )}
                    </TableCell>
                    <BuildCell row={row} platform="android" onDone={refresh} />
                    <BuildCell row={row} platform="ios" onDone={refresh} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
/**
 * Một ô: bản build của một môi trường trên một nền tảng.
 *
 * Ô này chỉ trả lời "bản nào đang nằm ở đây". Câu "lượt này lấy app ở đâu" nằm
 * ở màn chạy, cạnh ô chọn môi trường — nó đổi theo từng lượt, không phải thuộc
 * tính của bản build; hỏi ở đây là hỏi ba lần cho cùng một quyết định.
 */
export function BuildCell({
  row,
  platform,
  onDone,
}: {
  row: BuildsResponse['environments'][number];
  platform: 'android' | 'ios';
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useMutation({
    mutationFn: (picked: File) =>
      uploadBuild(
        picked,
        { platform, ...(row.isDefault ? {} : { env: row.env }), persist: '1' },
        setProgress,
      ),
    onSuccess: () => {
      toast.success('Đã lưu build.');
      onDone();
      setFile(null);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setProgress(null),
  });

  const build = row[platform];
  const missing = row.missing.find((item) => item.platform === platform);

  return (
    <TableCell className="align-top">
      <div className="font-mono text-xs">
        {build?.path ?? (missing ? `✕ ${missing.path} — không thấy file` : 'Chưa có')}
      </div>
      {build?.sizeMb ? <div className="text-muted-foreground text-xs">{build.sizeMb} MB</div> : null}
      <label className="border-border mt-2 inline-flex cursor-pointer rounded border px-2 py-1 text-xs">
        {upload.isPending ? 'Đang tải…' : build || missing ? 'Thay bản khác…' : 'Tải lên…'}
        <input
          className="sr-only"
          type="file"
          accept={platform === 'ios' ? '.ipa' : '.apk'}
          disabled={upload.isPending}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) {
              setFile(picked);
              upload.mutate(picked);
            }
            e.currentTarget.value = '';
          }}
        />
      </label>
      {file && <span className="ms-2 text-xs">{file.name}</span>}
      {progress !== null && <progress className="ms-2 h-2" value={progress} max={1} />}
    </TableCell>
  );
}
