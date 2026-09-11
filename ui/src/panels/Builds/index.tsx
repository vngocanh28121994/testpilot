import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
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
    <AppShell title="Bản build">
      <Card>
        <CardHeader>
          <CardDescription>
            Bản build dùng cho local run, workflow và Device Farm.
            {builds.data ? ` File cất ở ${builds.data.root}.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {builds.isError && (
            <p role="alert" className="text-destructive">
              {(builds.error as Error).message}
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="p-3">Môi trường</th>
                  <th className="p-3">Android (.apk)</th>
                  <th className="p-3">iOS (.ipa)</th>
                </tr>
              </thead>
              <tbody>
                {builds.isPending && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center">
                      Đang tải…
                    </td>
                  </tr>
                )}
                {builds.data?.environments.map((row) => (
                  <tr key={row.env || 'shared'} className="border-border border-t">
                    <td className="p-3">
                      <b>{(row.env || 'Dùng chung').toUpperCase()}</b>
                      {row.isDefault && row.env && (
                        <span className="text-muted-foreground ms-2 text-xs">mặc định</span>
                      )}
                    </td>
                    <BuildCell row={row} platform="android" onDone={refresh} />
                    <BuildCell row={row} platform="ios" onDone={refresh} />
                  </tr>
                ))}
              </tbody>
            </table>
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
    <td className="p-3 align-top">
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
    </td>
  );
}
