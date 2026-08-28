import { HardDrive, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Build } from '@core/ui/contracts.js';

export function BuildCard({
  platform,
  env,
  defaultEnv,
  appBuilds,
  envBuilds,
}: {
  platform: 'web' | 'android' | 'ios';
  env: string;
  defaultEnv: string;
  appBuilds: { android: Build; ios: Build };
  envBuilds: Record<string, { android: Build; ios: Build }>;
}) {
  if (platform === 'web') return null;
  const build = env ? envBuilds[env]?.[platform] ?? null : appBuilds[platform];
  const inherited = Boolean(env && env !== defaultEnv && build && !build.own);
  return (
    <Card aria-labelledby="build-to-install-title">
      <CardHeader>
        <CardTitle id="build-to-install-title" className="flex items-center gap-2 text-base"><HardDrive className="size-4" /> Bản build sẽ cài</CardTitle>
        <CardDescription>{env ? `Bản build của môi trường “${env}”.` : 'Không chọn môi trường: dùng bản build mặc định hoặc app đã cài sẵn.'}</CardDescription>
      </CardHeader>
      <CardContent>
        {inherited ? <p className="text-destructive flex gap-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0" /> Chưa có build riêng cho “{env}” — đang trỏ về <code>{build?.path}</code> của “{defaultEnv}”. Chạy sẽ bị chặn; hãy tải build riêng lên ở màn Bản build.</p> : !build ? <p className="text-muted-foreground text-sm">Chưa đặt build — app phải được cài sẵn trên máy.</p> : build.exists ? <p className="text-status-pass text-sm">✓ <code>{build.path}</code>{build.sizeMb ? ` · ${build.sizeMb} MB` : ''}</p> : <p className="text-destructive text-sm">✕ Không tìm thấy <code>{build.path}</code></p>}
      </CardContent>
    </Card>
  );
}
