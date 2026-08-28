import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { endOfDay, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  Download,
  Info,
  LogIn,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Field } from '@/components/Field';
import { CheckRow } from '@/components/CheckRow';
import { GroupHeading } from '@/components/GroupHeading';
import { StageList } from '@/components/StageList';
import { StatusPill } from '@/components/StatusPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DateRangePicker } from '@/components/DateRangePicker';
import { Pagination } from '@/components/Pagination';
import { TagPicker } from '@/components/TagPicker';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import { FARM_IDLE_STAGES } from '@/lib/stages';
import { cn } from '@/lib/utils';
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
  const state = useAppState((s) => ({ config: s.config, appBuilds: s.appBuilds, runs: s.runs, features: s.features, tagTaxonomy: s.tagTaxonomy }));
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
  const [deviceQuery, setDeviceQuery] = useState('');
  const [realAvailableOnly, setRealAvailableOnly] = useState(false);
  const [tagsSelected, setTagsSelected] = useState(() => (saved?.env?.TESTPILOT_TAG ?? '').split(',').filter(Boolean));
  const [historyRange, setHistoryRange] = useState<DateRange>();
  const [historyPlatform, setHistoryPlatform] = useState<'all' | 'android' | 'ios'>('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [aws, setAws] = useState<AwsStatus | null>(null);
  const [form, setForm] = useState(() => ({
    testPackagePath: saved?.testPackagePath ?? 'build/testpilot-appium.zip',
    testSpecPath: saved?.testSpecPath ?? 'farm/testspec.yml',
    runName: saved?.runName ?? '',
    jobTimeoutMinutes: saved?.jobTimeoutMinutes ?? 30,
    videoCapture: saved?.videoCapture ?? true,
    sendSecrets: saved?.sendSecrets ?? false,
    env: Object.entries(saved?.env ?? {}).filter(([key]) => key !== 'TESTPILOT_TAG').map(([key, value]) => ({ key, value })),
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
    if (tagsSelected.length) env.TESTPILOT_TAG = tagsSelected.join(',');
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
      // Gửi cả object rỗng để bỏ tag không vô tình giữ TESTPILOT_TAG từ lượt trước.
      env,
      bundle: form.bundle,
    };
    job.start(body);
  };
  const shownPools = pools.filter(
    (item) => !item.platforms?.length || item.platforms.includes(platform),
  );
  const selectedPool = shownPools.find((item) => item.arn === pool);
  const shownDevices = useMemo(() => {
    const query = deviceQuery.trim().toLowerCase();
    return devices
      .filter((item) => !realAvailableOnly || (item.formFactor.toUpperCase() !== 'VIRTUAL' && ['AVAILABLE', 'HIGHLY_AVAILABLE'].includes(item.availability)))
      .filter((item) => !query || `${item.name} ${item.manufacturer} ${item.os}`.toLowerCase().includes(query))
      .slice(0, 300);
  }, [deviceQuery, devices, realAvailableOnly]);
  const tagOptions = useMemo(
    () => [...new Set(state.data?.features.flatMap((feature) => feature.scenarios.flatMap((scenario) => scenario.tags)) ?? [])].sort(),
    [state.data],
  );
  const build = state.data?.appBuilds[platform];
  const farmRuns = (state.data?.runs ?? []).filter((run) => run.kind === 'farm');
  const filteredFarmRuns = farmRuns.filter((run) => (historyPlatform === 'all' || run.platform === historyPlatform) && farmInRange(run.startedAt, historyRange));
  const historyPageCount = Math.max(1, Math.ceil(filteredFarmRuns.length / 10));
  const shownFarmRuns = filteredFarmRuns.slice((Math.min(historyPage, historyPageCount) - 1) * 10, Math.min(historyPage, historyPageCount) * 10);

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
                  <span
                    className={cn(
                      'text-sm',
                      expiringSoon(aws) ? 'text-status-flaky' : 'text-muted-foreground',
                    )}
                  >
                    {aws ? credentialLine(aws) : 'Đang kiểm tra credential…'}
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

                {aws && <LoginHelp status={aws} />}

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
                    <select
                      className="input mt-0"
                      value={project}
                      onChange={(e) => {
                        setProject(e.target.value);
                        setPool('');
                      }}
                    >
                      <option value="">— chọn project —</option>
                      {projects.map((item) => (
                        <option key={item.arn} value={item.arn}>
                          {item.name}
                        </option>
                      ))}
                    </select>
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
                    <select
                      className="input mt-0"
                      value={pool}
                      onChange={(e) => setPool(e.target.value)}
                    >
                      <option value="">— chọn pool —</option>
                      {shownPools.map((item) => (
                        <option key={item.arn} value={item.arn}>
                          {item.name} ({item.type})
                        </option>
                      ))}
                    </select>
                    <p className="text-muted-foreground mt-1 text-xs" aria-live="polite">
                      {selectedPool
                        ? `Pool đã chọn: ${selectedPool.name}${selectedPool.platforms?.length ? ` · ${selectedPool.platforms.join(', ')}` : ''}.`
                        : pools.length > shownPools.length
                          ? `Đã ẩn ${pools.length - shownPools.length} pool không phù hợp với ${platform}.`
                          : 'Chọn pool phù hợp với nền tảng để chạy.'}
                    </p>
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        type="search"
                        value={deviceQuery}
                        onChange={(event) => setDeviceQuery(event.target.value)}
                        placeholder="Lọc tên, hãng hoặc phiên bản OS…"
                        aria-label="Lọc thiết bị"
                      />
                      <CheckRow
                        label="Chỉ thiết bị thật đang rảnh"
                        checked={realAvailableOnly}
                        onChange={setRealAvailableOnly}
                      />
                    </div>
                    <Button variant="outline" size="sm" className="self-start" onClick={loadDevices}>
                      <Download className="size-4" />
                      Tải thiết bị
                    </Button>
                    {devices.length > 0 && (
                      <div className="max-h-64 overflow-auto rounded-lg border">
                        {shownDevices.map((item) => (
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
                        {shownDevices.length === 0 && (
                          <p className="text-muted-foreground p-4 text-sm">Không có thiết bị khớp bộ lọc.</p>
                        )}
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
                {form.sendSecrets && (
                  <p className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
                    Cần bật thì <code>{'{{account.*.password}}'}</code> mới có giá trị trên máy thật. Mật khẩu được chèn vào testspec, upload lên S3 dưới dạng văn bản thuần và lưu theo lịch sử run — ai truy cập AWS có thể đọc được. Hãy đổi mật khẩu sau khi test xong; tắt thì placeholder giữ nguyên và đăng nhập sẽ không qua.
                  </p>
                )}
              </div>

              <section className="rounded-lg border p-4" aria-labelledby="farm-env-guide-title">
                <h4 id="farm-env-guide-title" className="text-sm font-medium">Hướng dẫn biến môi trường</h4>
                <p className="text-muted-foreground mt-1 text-xs">Biến được chèn thành <code>export KEY=VALUE</code> trong phase test của testspec.</p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div><dt><code>TESTPILOT_TAG</code></dt><dd className="text-muted-foreground text-xs">Tự đặt từ bộ lọc tag bên dưới.</dd></div>
                  <div><dt><code>TESTPILOT_APPIUM_HOST</code></dt><dd className="text-muted-foreground text-xs">Override host Appium, mặc định 127.0.0.1.</dd></div>
                  <div><dt><code>TESTPILOT_PLATFORM</code></dt><dd className="text-muted-foreground text-xs">Device Farm tự thiết lập Android hoặc iOS.</dd></div>
                </dl>
                <p className="text-muted-foreground mt-3 text-xs">Không đặt password, token hay API key ở đây: testspec có thể được upload và ghi log. Dùng AWS Secrets Manager cho dữ liệu nhạy cảm.</p>
              </section>

              <EnvEditor
                entries={form.env}
                onChange={(env) => setForm((old) => ({ ...old, env }))}
              />

              <Field label="Lọc scenario theo tag">
                <TagPicker
                  value={tagsSelected}
                  onChange={setTagsSelected}
                  taxonomy={state.data?.tagTaxonomy}
                  knownTags={tagOptions}
                  placeholder="Tất cả scenario — chọn nhiều tag để chạy tập hợp"
                  aria-label="Lọc tag Device Farm"
                />
                <p className="text-muted-foreground mt-1 text-xs">Giá trị được gửi bằng <code>TESTPILOT_TAG</code>.</p>
              </Field>

              <div>
                <Button disabled={job.status === 'running'} onClick={start}>
                  <Play className="size-4" />
                  {job.status === 'running' ? 'Đang chạy…' : 'Chạy trên Device Farm'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {(job.logs.length > 0 || job.status === 'running') && (
            <Card aria-labelledby="farm-progress-title">
              <CardHeader>
                <CardTitle id="farm-progress-title">Tiến trình</CardTitle>
                <CardDescription>
                  Bốn stage của một lượt farm. Upload và hàng chờ thiết bị là hai phần chậm
                  nhất, nên chúng phải nhìn thấy được chứ không gộp thành một dòng.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <StageList stages={job.run?.stages} idle={FARM_IDLE_STAGES} />
                {job.logs.length > 0 && (
                  <pre className="console mt-0">
                    {job.logs.join('\n')}
                    {job.error ? `\n❌ ${job.error}` : ''}
                  </pre>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        <Card aria-labelledby="history-title">
          <CardHeader>
            <CardTitle id="history-title">Lịch sử chạy Device Farm</CardTitle>
            <CardDescription>Các lượt đã gửi lên farm từ máy này.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-end gap-3"><label className="text-sm">Khoảng ngày<DateRangePicker value={historyRange} onChange={(next) => { setHistoryRange(next); setHistoryPage(1); }} /></label><div className="flex gap-1">{(['all', 'android', 'ios'] as const).map((item) => <Button key={item} size="sm" variant={historyPlatform === item ? 'default' : 'outline'} onClick={() => { setHistoryPlatform(item); setHistoryPage(1); }}>{item === 'all' ? 'Tất cả' : item}</Button>)}</div><Button className="ms-auto" size="sm" variant="ghost" onClick={() => { setHistoryRange(undefined); setHistoryPlatform('all'); setHistoryPage(1); }}>Xoá bộ lọc</Button></div>
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
                  {shownFarmRuns.map((run) => (
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
                  {shownFarmRuns.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={4} className="text-muted-foreground p-6 text-center">
                        Không có lần chạy Device Farm khớp bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={Math.min(historyPage, historyPageCount)} pageCount={historyPageCount} onPageChange={setHistoryPage} />
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function farmInRange(iso: string | undefined, range: DateRange | undefined) { if (!range?.from) return true; const time = Date.parse(iso ?? ''); return !Number.isNaN(time) && time >= startOfDay(range.from).getTime() && time <= endOfDay(range.to ?? range.from).getTime(); }

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

/** Còn dưới 15 phút — cùng ngưỡng mà scheduler cảnh báo (app.js:5093). */
function expiringSoon(aws: AwsStatus | null): boolean {
  return aws?.ok === true && aws.expiresInMinutes !== undefined && aws.expiresInMinutes < 15;
}

/**
 * Một dòng nói đủ ba thứ: nguồn, key nào, và còn sống bao lâu.
 *
 * Bản React trước đây chỉ hiện `Nguồn: X` và bỏ rơi `keyHint` lẫn
 * `expiresInMinutes` mà server vẫn gửi. Hạn dùng mới là thứ quyết định: một
 * lượt farm chạy 20 phút với credential còn 5 phút sẽ chết giữa chừng, SAU khi
 * đã upload 216MB và tiêu phút thiết bị.
 */
function credentialLine(aws: AwsStatus): string {
  if (!aws.ok) return aws.reason ?? 'Không dùng được credential.';
  const parts = [`Nguồn: ${aws.source}`];
  if (aws.keyHint) parts.push(`key ${aws.keyHint}…`);
  parts.push(
    aws.expiresInMinutes === undefined
      ? 'không hết hạn (IAM role hoặc access key)'
      : aws.expiresInMinutes < 0
        ? 'đã hết hạn'
        : `còn ${aws.expiresInMinutes} phút`,
  );
  return parts.join(' · ');
}

/**
 * Vì sao không có nút "Đăng nhập AWS", và phải làm gì.
 *
 * Đây là chỗ lấp lỗ hổng lớn nhất của thẻ này: ba tình huống hoàn toàn khác
 * nhau trước đây cùng rơi vào một ngõ cụt — một câu lỗi tiếng Anh của AWS SDK
 * và một nút "Kiểm tra lại" bấm bao nhiêu lần cũng ra đúng câu đó.
 *
 * Im lặng ở đây tốn nhiều thời gian hơn vẻ ngoài của nó: người dùng không có
 * cách nào phân biệt "máy này chưa cài AWS CLI" với "phiên đã hết hạn, bấm
 * đăng nhập là xong".
 */
function LoginHelp({ status }: { status: AwsStatus }) {
  // Đã kết nối được thì không có gì phải giải thích.
  if (status.ok) return null;

  // Không có phiên nào để đăng nhập: credential đến từ biến môi trường, IAM
  // role của container, hay web identity. Sửa nằm ở cấu hình triển khai, và
  // một trình duyệt mở ra sẽ mở trên server chứ không phải ở đây.
  if (!status.login) {
    return (
      <Note icon={Info}>
        Credential đến từ <b>{status.source}</b>, nên không có phiên nào để đăng nhập từ màn
        này. Sửa ở nơi cấu hình credential cho tiến trình đang chạy TestPilot.
      </Note>
    );
  }

  if (!status.login.cliFound) {
    return (
      <Note icon={TerminalSquare}>
        <span>
          Chưa tìm thấy AWS CLI v2 trên máy này, nên chưa chạy được{' '}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            {status.login.command}
          </code>
          . Cài AWS CLI v2
          {status.login.kind === 'sso' ? '' : ' và cấu hình profile'}, rồi bấm “Kiểm tra lại”.
        </span>
      </Note>
    );
  }

  // Nút đăng nhập đang hiện. Nói ra lệnh nó sắp chạy — `aws login` và
  // `aws sso login` là hai luồng vào hai danh tính khác nhau, và bấm nhầm tệ
  // hơn là không bấm (devicefarm.ts loginCommand).
  return (
    <Note icon={LogIn}>
      <span>
        Bấm “Đăng nhập AWS” sẽ chạy{' '}
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          {status.login.command}
        </code>
        {status.login.profile ? ` cho profile “${status.login.profile}”` : ''} và mở trình duyệt
        trên chính máy này.
      </span>
    </Note>
  );
}

function Note({ icon: Icon, children }: { icon: typeof Info; children: ReactNode }) {
  return (
    <div className="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
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
    <select className="input mt-0" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}
