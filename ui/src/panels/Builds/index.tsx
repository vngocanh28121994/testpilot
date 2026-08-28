import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheckBig, FolderArchive, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { uploadBuild } from '@/api/upload';
import type { BuildsResponse } from '@core/ui/contracts.js';

const PAGE_DESCRIPTION = 'Quản lý file cài đặt dùng cho local run, workflow và Device Farm.';

export default function BuildsPanel() {
  const client = useQueryClient();
  const builds = useQuery({
    queryKey: ['builds'],
    queryFn: () => api.get<BuildsResponse>(ROUTES.builds),
  });
  const refresh = () =>
    void Promise.all([
      client.invalidateQueries({ queryKey: ['builds'] }),
      client.invalidateQueries({ queryKey: ['state'] }),
    ]);

  return (
    <AppShell title="Bản build" description={PAGE_DESCRIPTION}>
      <section aria-label="Bản build" className="flex flex-1 flex-col gap-6">
        {builds.isError && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          >
            <CircleAlert className="size-4 shrink-0" />
            {(builds.error as Error).message}
          </div>
        )}

        <Card aria-labelledby="build-library-title">
          <CardHeader>
            <CardTitle id="build-library-title">Thư viện bản build</CardTitle>
            <CardDescription>
              Tải lên file <code>.apk</code> và <code>.ipa</code> theo từng môi trường. Bản
              build mới có hiệu lực cho lần chạy tiếp theo.
            </CardDescription>
            {builds.data && (
              <CardAction className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <FolderArchive className="size-3.5" />
                <code className="max-w-64 truncate">{builds.data.root}</code>
              </CardAction>
            )}
          </CardHeader>

          <CardContent>
            <div className="border-border overflow-x-auto rounded-lg border bg-white dark:bg-card">
              <table className="w-full min-w-180 text-sm">
                <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="w-1/3 px-4 py-3 font-medium">Môi trường</th>
                    <th className="w-1/3 px-4 py-3 font-medium">Android (.apk)</th>
                    <th className="w-1/3 px-4 py-3 font-medium">iOS (.ipa)</th>
                  </tr>
                </thead>
                <tbody>
                  {builds.isPending && <LoadingRows />}
                  {builds.data?.environments.map((row) => (
                    <tr key={row.env || 'shared'} className="border-border hover:bg-muted/30 border-t">
                      <td className="px-4 py-4 align-top">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{(row.env || 'Dùng chung').toUpperCase()}</span>
                          {row.isDefault && row.env && <Badge variant="secondary">Mặc định</Badge>}
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {row.isDefault
                            ? 'Dùng khi chưa chọn môi trường riêng.'
                            : 'Build riêng của môi trường này.'}
                        </p>
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
      </section>
    </AppShell>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1].map((row) => (
        <tr key={row} className="border-border border-t">
          {[0, 1, 2].map((column) => (
            <td key={column} className="px-4 py-4">
              <Skeleton className={column === 0 ? 'h-9 w-32' : 'h-14 w-full'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function BuildCell({
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
  const uploadId = `build-upload-${row.env || 'shared'}-${platform}`;
  const build = row[platform];
  const missing = row.missing.find((item) => item.platform === platform);
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
    onError: (error) => toast.error((error as Error).message),
    onSettled: () => setProgress(null),
  });

  return (
    <td className="px-4 py-4 align-top">
      <div className="flex min-h-10 items-start gap-2">
        {build ? (
          <CircleCheckBig className="text-status-pass mt-0.5 size-4 shrink-0" aria-label="Đã có build" />
        ) : missing ? (
          <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Không tìm thấy build" />
        ) : null}
        <div className="min-w-0">
          <code className="block truncate text-xs">
            {build?.path ?? (missing ? missing.path : 'Chưa có build')}
          </code>
          {missing && <p className="text-destructive mt-0.5 text-xs">Không tìm thấy file</p>}
          {build?.sizeMb && <p className="text-muted-foreground mt-0.5 text-xs">{build.sizeMb} MB</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          id={uploadId}
          className="sr-only"
          type="file"
          accept={platform === 'ios' ? '.ipa' : '.apk'}
          disabled={upload.isPending}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) {
              setFile(picked);
              upload.mutate(picked);
            }
            event.currentTarget.value = '';
          }}
        />
        <Button asChild type="button" variant="outline" size="sm" disabled={upload.isPending}>
          <label htmlFor={uploadId}>
            <Upload />
            {upload.isPending ? 'Đang tải…' : build || missing ? 'Thay bản khác' : 'Tải lên'}
          </label>
        </Button>
        {file && <span className="text-muted-foreground max-w-40 truncate text-xs">{file.name}</span>}
        {progress !== null && <progress className="accent-primary h-1.5 w-24" value={progress} max={1} />}
      </div>
    </td>
  );
}
