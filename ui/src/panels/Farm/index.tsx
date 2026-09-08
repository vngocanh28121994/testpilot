import { useEffect, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  Download,
  LogIn,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Dropdown } from '@/components/Dropdown';
import { Field } from '@/components/Field';
import { CheckRow } from '@/components/CheckRow';
import { GroupHeading } from '@/components/GroupHeading';
import { StatusPill } from '@/components/StatusPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import type {
  AwsStatus,
  FarmApiResponse,
  FarmDevice,
  FarmForm,
  FarmPool,
  FarmProject,
} from '@core/ui/contracts.js';

interface EnvEntry {
  key: string;
  value: string;
}

const PAGE_DESCRIPTION = 'Chạy bộ test Appium trên thiết bị thật của AWS.';

async function farmGet<T>(path: string): Promise<T> {
  const response = await api.get<FarmApiResponse<T>>(path);
  if (!response.ok || response.data === undefined)
    throw new Error(response.hint ?? response.error ?? 'Yêu cầu Device Farm thất bại.');
  return response.data;
}

export default function FarmPanel() {
  const state = useAppState((s) => ({ config: s.config, appBuilds: s.appBuilds, runs: s.runs }));
  const saved = state.data?.config.farm;
  const [region, setRegion] = useState(saved?.region ?? 'us-west-2');
  const [platform, setPlatform] = useState<'android' | 'ios'>(saved?.platform ?? 'android');
  const [project, setProject] = useState(saved?.projectArn ?? '');
  const [pool, setPool] = useState(saved?.devicePoolArn ?? '');
  const [projects, setProjects] = useState<FarmProject[]>([]);
  const [pools, setPools] = useState<FarmPool[]>([]);
  const [devices, setDevices] = useState<FarmDevice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [poolName, setPoolName] = useState('');
  const [aws, setAws] = useState<AwsStatus | null>(null);
  const [form, setForm] = useState(() => ({
    testPackagePath: saved?.testPackagePath ?? 'build/testpilot-appium.zip',
    testSpecPath: saved?.testSpecPath ?? 'farm/testspec.yml',
    runName: saved?.runName ?? '',
    jobTimeoutMinutes: saved?.jobTimeoutMinutes ?? 30,
    videoCapture: saved?.videoCapture ?? true,
    sendSecrets: saved?.sendSecrets ?? false,
    env: Object.entries(saved?.env ?? {}).map(([key, value]) => ({ key, value })),
    bundle: true,
  }));
  const job = useStreamJob('farm-run', STREAM_ROUTES.farmRun);
  const login = useStreamJob('aws-login', STREAM_ROUTES.awsLogin);
  const checkAws = () =>
    void api
      .get<AwsStatus>(`${ROUTES.aws}${qs({ region })}`)
      .then(setAws)
      .catch((error: Error) => toast.error(error.message));
  useEffect(checkAws, [region]);
  const loadProjects = () =>
    void farmGet<FarmProject[]>(`${ROUTES.farmProjects}${qs({ region })}`)
      .then(setProjects)
      .catch((error: Error) => toast.error(error.message));
  const loadPools = () => {
    if (project)
      void farmGet<FarmPool[]>(`${ROUTES.farmPools}${qs({ region, projectArn: project })}`)
        .then(setPools)
        .catch((error: Error) => toast.error(error.message));
  };
  const loadDevices = () =>
    void farmGet<FarmDevice[]>(`${ROUTES.farmDevices}${qs({ region, platform })}`)
      .then(setDevices)
      .catch((error: Error) => toast.error(error.message));
  const makePool = async () => {
    if (!poolName || !project || selected.length === 0)
      return toast.error('Cần project, tên pool và ít nhất một thiết bị.');
    try {
      const response = await api.post<FarmApiResponse<FarmPool>>(ROUTES.farmPool, {
        region,
        projectArn: project,
        name: poolName,
        deviceArns: selected,
      });
      if (!response.ok || !response.data) throw new Error(response.error);
      setPools((items) => [...items, response.data!]);
      setPool(response.data.arn);
      toast.success(`Đã tạo ${response.data.name}.`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const start = () => {
    const env = Object.fromEntries(
      form.env.map(({ key, value }) => [key.trim(), value]).filter(([key]) => key),
    );
    const body: FarmForm = {
      region,
      projectArn: project,
      devicePoolArn: pool,
      platform,
      testPackagePath: form.testPackagePath,
      testSpecPath: form.testSpecPath,
      runName: form.runName,
      jobTimeoutMinutes: form.jobTimeoutMinutes,
      videoCapture: form.videoCapture,
      sendSecrets: form.sendSecrets,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      bundle: form.bundle,
    };
    job.start(body);
  };
  const shownPools = pools.filter(
    (item) => !item.platforms?.length || item.platforms.includes(platform),
  );
  const build = state.data?.appBuilds[platform];
  const farmRuns = (state.data?.runs ?? []).filter((run) => run.kind === 'farm');

  return (
    <AppShell title="AWS Device Farm" description={PAGE_DESCRIPTION}>
      <section aria-label="Device Farm" className="flex flex-1 flex-col gap-6">
        <section className="grid gap-4">
          <GroupHeading title="Kết nối và thiết bị">
            Chọn tài khoản AWS, rồi chọn project và device pool sẽ nhận lượt chạy.
          </GroupHeading>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card aria-labelledby="aws-title">
              <CardHeader>
                <CardTitle id="aws-title">Kết nối AWS</CardTitle>
                <CardDescription>
                  TestPilot dùng credential chain mặc định của AWS SDK; key không đi qua trình
                  duyệt.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {aws?.ok ? (
                    <Badge>
                      <ShieldCheck />
                      Kết nối được
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      <ShieldAlert />
                      Chưa kết nối
                    </Badge>
                  )}
                  <span className="text-muted-foreground text-sm">
                    {aws?.ok
                      ? `Nguồn: ${aws.source}`
                      : (aws?.reason ?? 'Đang kiểm tra credential…')}
                  </span>
                  <div className="ms-auto flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={checkAws}>
                      <RefreshCw className="size-4" />
                      Kiểm tra lại
                    </Button>
                    {aws?.canLogin && (
                      <Button variant="outline" size="sm" onClick={() => login.start({ region })}>
                        <LogIn className="size-4" />
                        Đăng nhập AWS
                      </Button>
                    )}
                  </div>
                </div>

                {login.logs.length > 0 && <pre className="console">{login.logs.join('\n')}</pre>}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Region">
                    <NativeSelect
                      value={region}
                      onChange={setRegion}
                      options={['us-west-2', 'us-east-1']}
                    />
                  </Field>
                  <Field label="Project">
                    <Dropdown
                      className="mt-0"
                      value={project}
                      placeholder="— chọn project —"
                      onChange={(next) => {
                        setProject(next);
                        setPool('');
                      }}
                      options={projects.map((item) => ({ value: item.arn, label: item.name }))}
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={loadProjects}>
                    <Download className="size-4" />
                    Tải project
                  </Button>
                  <Button variant="outline" disabled={!project} onClick={loadPools}>
                    <Download className="size-4" />
                    Tải pool
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card aria-labelledby="device-title">
              <CardHeader>
                <CardTitle id="device-title">Hệ điều hành & thiết bị</CardTitle>
                <CardDescription>
                  Pool quyết định lượt chạy đi lên những máy nào.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Hệ điều hành">
                    <NativeSelect
                      value={platform}
                      onChange={(value) => {
                        setPlatform(value as 'android' | 'ios');
                        setSelected([]);
                      }}
                      options={['android', 'ios']}
                    />
                  </Field>
                  <Field label="Device pool">
                    <Dropdown
                      className="mt-0"
                      value={pool}
                      placeholder="— chọn pool —"
                      onChange={setPool}
                      options={shownPools.map((item) => ({
                        value: item.arn,
                        label: `${item.name} (${item.type})`,
                      }))}
                    />
                  </Field>
                </div>

                <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Smartphone className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {build
                      ? `${build.exists ? 'Đang dùng' : 'Không tìm thấy'}: ${build.path}`
                      : 'Chưa có bản build.'}
                  </span>
                  <Link to="/builds" className="text-primary ms-auto underline">
                    Đổi bản build →
                  </Link>
                </div>

                <details className="group">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm select-none">
                    Hoặc tự chọn thiết bị và tạo pool mới
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <Button variant="outline" size="sm" className="self-start" onClick={loadDevices}>
                      <Download className="size-4" />
                      Tải thiết bị
                    </Button>
                    {devices.length > 0 && (
                      <div className="max-h-64 overflow-auto rounded-lg border">
                        {devices.map((item) => (
                          <label
                            key={item.arn}
                            className="hover:bg-muted/50 flex items-center gap-2 border-b p-2 text-sm last:border-b-0"
                          >
                            <input
                              type="checkbox"
                              className="accent-primary size-4"
                              checked={selected.includes(item.arn)}
                              onChange={(e) =>
                                setSelected((all) =>
                                  e.target.checked
                                    ? [...all, item.arn]
                                    : all.filter((arn) => arn !== item.arn),
                                )
                              }
                            />
                            {item.name} · {item.formFactor} · OS {item.os}
                            <span className="text-muted-foreground ms-auto text-xs">
                              {item.availability}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Tên pool"
                        value={poolName}
                        onChange={(e) => setPoolName(e.target.value)}
                      />
                      <Button variant="outline" onClick={() => void makePool()}>
                        <Plus className="size-4" />
                        Tạo pool
                      </Button>
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-4">
          <GroupHeading title="Lượt chạy">
            Gói test và tuỳ chọn gửi lên farm. Cấu hình ở đây được lưu lại cho lần chạy sau.
          </GroupHeading>
          <Card aria-labelledby="package-title">
            <CardHeader>
              <CardTitle id="package-title">Gói cài đặt</CardTitle>
              <CardDescription>
                Đường dẫn tương đối so với gốc repo, cùng tuỳ chọn cho lượt chạy.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Test package">
                  <Input
                    value={form.testPackagePath}
                    onChange={(e) => setForm((old) => ({ ...old, testPackagePath: e.target.value }))}
                  />
                </Field>
                <Field label="Testspec">
                  <Input
                    value={form.testSpecPath}
                    onChange={(e) => setForm((old) => ({ ...old, testSpecPath: e.target.value }))}
                  />
                </Field>
                <Field label="Tên lượt chạy">
                  <Input
                    value={form.runName}
                    onChange={(e) => setForm((old) => ({ ...old, runName: e.target.value }))}
                  />
                </Field>
                <Field label="Timeout (phút)">
                  <Input
                    type="number"
                    value={form.jobTimeoutMinutes}
                    onChange={(e) =>
                      setForm((old) => ({
                        ...old,
                        jobTimeoutMinutes: Number(e.target.value) || 30,
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <CheckRow
                  label="Đóng gói lại test package trước khi chạy"
                  checked={form.bundle}
                  onChange={(bundle) => setForm((old) => ({ ...old, bundle }))}
                />
                <CheckRow
                  label="Ghi video cho mỗi thiết bị"
                  checked={form.videoCapture}
                  onChange={(videoCapture) => setForm((old) => ({ ...old, videoCapture }))}
                />
                <CheckRow
                  label="Gửi secret đã cấu hình vào farm"
                  checked={form.sendSecrets}
                  onChange={(sendSecrets) => setForm((old) => ({ ...old, sendSecrets }))}
                />
              </div>

              <EnvEditor
                entries={form.env}
                onChange={(env) => setForm((old) => ({ ...old, env }))}
              />

              <div>
                <Button disabled={job.status === 'running'} onClick={start}>
                  <Play className="size-4" />
                  {job.status === 'running' ? 'Đang chạy…' : 'Chạy trên Device Farm'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {job.logs.length > 0 && <pre className="console mt-0">{job.logs.join('\n')}</pre>}
        </section>

        <Card aria-labelledby="history-title">
          <CardHeader>
            <CardTitle id="history-title">Lịch sử chạy Device Farm</CardTitle>
            <CardDescription>Các lượt đã gửi lên farm từ máy này.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="p-2 font-medium">Thời điểm</th>
                    <th className="p-2 font-medium">Feature</th>
                    <th className="p-2 font-medium">Trạng thái</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {farmRuns.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="p-2">{when(run.startedAt)}</td>
                      <td className="p-2">{run.feature}</td>
                      <td className="p-2">
                        <StatusPill status={run.status} />
                      </td>
                      <td className="p-2">
                        <Link
                          to="/farm/$runId"
                          params={{ runId: run.id }}
                          className="text-primary underline"
                        >
                          Xem
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {farmRuns.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={4} className="text-muted-foreground p-6 text-center">
                        Chưa có lần chạy Device Farm.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function EnvEditor({
  entries,
  onChange,
}: {
  entries: EnvEntry[];
  onChange: (entries: EnvEntry[]) => void;
}) {
  const change = (index: number, key: keyof EnvEntry, value: string) =>
    onChange(entries.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));
  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">Biến môi trường</h4>
          <p className="text-muted-foreground text-xs">
            Chỉ gửi cho lượt chạy này và được lưu vào cấu hình Farm.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onChange([...entries, { key: '', value: '' }])}
        >
          + Thêm biến
        </Button>
      </div>
      {entries.map((entry, index) => (
        <div
          key={`${index}-${entry.key}`}
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Input
            aria-label={`Tên biến ${index + 1}`}
            placeholder="TÊN_BIẾN"
            value={entry.key}
            onChange={(e) => change(index, 'key', e.target.value)}
          />
          <Input
            aria-label={`Giá trị biến ${index + 1}`}
            placeholder="giá trị"
            value={entry.value}
            onChange={(e) => change(index, 'value', e.target.value)}
          />
          <Button
            variant="outline"
            type="button"
            aria-label={`Xoá biến ${index + 1}`}
            className="text-destructive hover:text-destructive"
            onClick={() => onChange(entries.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
            Xoá
          </Button>
        </div>
      ))}
    </section>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}): ReactNode {
  return (
    <Dropdown
      className="mt-0"
      value={value}
      onChange={onChange}
      options={options.map((option) => ({ value: option, label: option }))}
    />
  );
}
