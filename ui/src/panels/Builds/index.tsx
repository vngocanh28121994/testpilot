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
 * Một ô: nguồn app của một môi trường trên một nền tảng.
 *
 * Ô này trả lời đúng một câu — ưu tiên bản có sẵn trên thiết bị, hay bản được
 * upload? Hai lựa chọn để rõ ràng, không phải một ô tích: bỏ trống một ô tích
 * gộp mất hai trạng thái khác hẳn nhau — "tôi đã chọn dùng bản trên máy" và
 * "tôi chưa quyết định gì", mà ranh giới đó lại đúng là thứ bộ chặn lúc chạy
 * canh.
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
  const source = useMutation({
    mutationFn: (useInstalled: boolean) =>
      api.post(ROUTES.buildSource, { env: row.env, platform, useInstalled }),
    onSuccess: () => onDone(),
    onError: (e) => toast.error((e as Error).message),
  });

  const build = row[platform];
  const missing = row.missing.find((item) => item.platform === platform);
  const prefersInstalled = row.preferInstalled[platform];
  // Môi trường mặc định là chính cấu hình gốc, không có khối override để ghi
  // lựa chọn vào — nên ô đó chỉ có phần tải lên, như trước.
  const choosable = Boolean(row.env);
  const name = `source-${row.env || 'shared'}-${platform}`;

  return (
    <td className="p-3 align-top">
      {choosable && (
        <fieldset className="mb-3 flex flex-col gap-1" disabled={source.isPending}>
          <legend className="text-muted-foreground mb-1 text-xs">
            Ưu tiên bản nào?
          </legend>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="radio"
              name={name}
              checked={!prefersInstalled}
              onChange={() => source.mutate(false)}
            />
            Bản được upload
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="radio"
              name={name}
              checked={prefersInstalled}
              onChange={() => source.mutate(true)}
            />
            Bản có sẵn trên thiết bị
          </label>
          {prefersInstalled && (
            <p className="text-muted-foreground text-xs">
              Tool không kiểm được bản trên máy thuộc môi trường nào — mọi môi trường
              dùng chung bundle id. Lượt chạy sẽ in ra phiên bản đang cài để bạn đối chiếu.
            </p>
          )}
        </fieldset>
      )}
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
