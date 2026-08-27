import { useEffect, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { StatusPill } from '@/components/StatusPill';
import { api, qs } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import { when } from '@/lib/datetime';
import type { AwsStatus, FarmApiResponse, FarmDevice, FarmForm, FarmPool, FarmProject } from '@core/ui/contracts.js';

interface EnvEntry { key: string; value: string }

async function farmGet<T>(path: string): Promise<T> {
  const response = await api.get<FarmApiResponse<T>>(path);
  if (!response.ok || response.data === undefined) throw new Error(response.hint ?? response.error ?? 'Yêu cầu Device Farm thất bại.');
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
  const checkAws = () => void api.get<AwsStatus>(`${ROUTES.aws}${qs({ region })}`).then(setAws).catch((error: Error) => toast.error(error.message));
  useEffect(checkAws, [region]);
  const loadProjects = () => void farmGet<FarmProject[]>(`${ROUTES.farmProjects}${qs({ region })}`).then(setProjects).catch((error: Error) => toast.error(error.message));
  const loadPools = () => { if (project) void farmGet<FarmPool[]>(`${ROUTES.farmPools}${qs({ region, projectArn: project })}`).then(setPools).catch((error: Error) => toast.error(error.message)); };
  const loadDevices = () => void farmGet<FarmDevice[]>(`${ROUTES.farmDevices}${qs({ region, platform })}`).then(setDevices).catch((error: Error) => toast.error(error.message));
  const makePool = async () => {
    if (!poolName || !project || selected.length === 0) return toast.error('Cần project, tên pool và ít nhất một thiết bị.');
    try {
      const response = await api.post<FarmApiResponse<FarmPool>>(ROUTES.farmPool, { region, projectArn: project, name: poolName, deviceArns: selected });
      if (!response.ok || !response.data) throw new Error(response.error);
      setPools((items) => [...items, response.data!]);
      setPool(response.data.arn);
      toast.success(`Đã tạo ${response.data.name}.`);
    } catch (error) { toast.error((error as Error).message); }
  };
  const start = () => {
    const env = Object.fromEntries(form.env.map(({ key, value }) => [key.trim(), value]).filter(([key]) => key));
    const body: FarmForm = {
      region, projectArn: project, devicePoolArn: pool, platform,
      testPackagePath: form.testPackagePath, testSpecPath: form.testSpecPath,
      runName: form.runName, jobTimeoutMinutes: form.jobTimeoutMinutes,
      videoCapture: form.videoCapture, sendSecrets: form.sendSecrets,
      ...(Object.keys(env).length > 0 ? { env } : {}), bundle: form.bundle,
    };
    job.start(body);
  };
  const shownPools = pools.filter((item) => !item.platforms?.length || item.platforms.includes(platform));
  const build = state.data?.appBuilds[platform];
  const farmRuns = (state.data?.runs ?? []).filter((run) => run.kind === 'farm');

  return <AppShell title="AWS Device Farm">
    <Card title="Kết nối"><p className="text-muted-foreground text-sm">TestPilot dùng credential chain mặc định của AWS SDK; key không đi qua trình duyệt.</p><div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill status={aws?.ok ? 'Kết nối được' : 'Chưa kết nối'} /><span className="text-muted-foreground text-sm">{aws?.ok ? `Nguồn: ${aws.source}` : (aws?.reason ?? 'Đang kiểm tra credential…')}</span><button className="button" onClick={checkAws}>Kiểm tra lại</button>{aws?.canLogin && <button className="button" onClick={() => login.start({ region })}>Đăng nhập AWS</button>}</div>{login.logs.length > 0 && <pre className="console">{login.logs.join('\n')}</pre>}<div className="mt-4 grid gap-3 sm:grid-cols-2"><Select label="Region" value={region} onChange={setRegion} options={['us-west-2', 'us-east-1']} /><label className="text-sm">Project<select className="input" value={project} onChange={(e) => { setProject(e.target.value); setPool(''); }}><option value="">— chọn project —</option>{projects.map((item) => <option key={item.arn} value={item.arn}>{item.name}</option>)}</select></label></div><div className="mt-3 flex gap-2"><button className="button" onClick={loadProjects}>Tải project</button><button className="button" disabled={!project} onClick={loadPools}>Tải pool</button></div></Card>
    <Card title="Hệ điều hành & thiết bị"><div className="grid gap-3 sm:grid-cols-2"><Select label="Hệ điều hành" value={platform} onChange={(value) => { setPlatform(value as 'android' | 'ios'); setSelected([]); }} options={['android', 'ios']} /><label className="text-sm">Device pool<select className="input" value={pool} onChange={(e) => setPool(e.target.value)}><option value="">— chọn pool —</option>{shownPools.map((item) => <option key={item.arn} value={item.arn}>{item.name} ({item.type})</option>)}</select></label></div><p className="text-muted-foreground mt-3 text-sm">{build ? `${build.exists ? 'Đang dùng' : 'Không tìm thấy'}: ${build.path}` : 'Chưa có bản build.'} <Link to="/builds" className="underline">Đổi bản build →</Link></p><details className="mt-4"><summary>Hoặc tự chọn thiết bị và tạo pool mới</summary><button className="button mt-3" onClick={loadDevices}>Tải thiết bị</button><div className="mt-2 max-h-64 overflow-auto">{devices.map((item) => <label key={item.arn} className="border-border flex gap-2 border-b p-2 text-sm"><input type="checkbox" checked={selected.includes(item.arn)} onChange={(e) => setSelected((all) => e.target.checked ? [...all, item.arn] : all.filter((arn) => arn !== item.arn))} />{item.name} · {item.formFactor} · OS {item.os}<span className="text-muted-foreground ms-auto">{item.availability}</span></label>)}</div><div className="mt-3 flex gap-2"><input className="input" placeholder="Tên pool" value={poolName} onChange={(e) => setPoolName(e.target.value)} /><button className="button" onClick={() => void makePool()}>Tạo pool</button></div></details></Card>
    <Card title="Gói cài đặt"><div className="grid gap-3 sm:grid-cols-2"><Text label="Test package" value={form.testPackagePath} onChange={(value) => setForm((old) => ({ ...old, testPackagePath: value }))} /><Text label="Testspec" value={form.testSpecPath} onChange={(value) => setForm((old) => ({ ...old, testSpecPath: value }))} /><Text label="Tên lượt chạy" value={form.runName} onChange={(value) => setForm((old) => ({ ...old, runName: value }))} /><label className="text-sm">Timeout (phút)<input type="number" className="input" value={form.jobTimeoutMinutes} onChange={(e) => setForm((old) => ({ ...old, jobTimeoutMinutes: Number(e.target.value) || 30 }))} /></label></div><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={form.bundle} onChange={(e) => setForm((old) => ({ ...old, bundle: e.target.checked }))} />Đóng gói lại test package trước khi chạy</label><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={form.videoCapture} onChange={(e) => setForm((old) => ({ ...old, videoCapture: e.target.checked }))} />Ghi video cho mỗi thiết bị</label><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={form.sendSecrets} onChange={(e) => setForm((old) => ({ ...old, sendSecrets: e.target.checked }))} />Gửi secret đã cấu hình vào farm</label><EnvEditor entries={form.env} onChange={(env) => setForm((old) => ({ ...old, env }))} /><button className="bg-primary text-primary-foreground mt-5 rounded px-3 py-2 text-sm disabled:opacity-50" disabled={job.status === 'running'} onClick={start}>{job.status === 'running' ? 'Đang chạy…' : 'Chạy trên Device Farm'}</button></Card>
    {job.logs.length > 0 && <pre className="console">{job.logs.join('\n')}</pre>}
    <section className="mt-6"><h2 className="font-medium">Lịch sử chạy Device Farm</h2><div className="border-border mt-3 overflow-x-auto rounded border"><table className="w-full text-sm"><tbody>{farmRuns.map((run) => <tr key={run.id} className="border-border border-t"><td className="p-2">{when(run.startedAt)}</td><td className="p-2">{run.feature}</td><td className="p-2"><StatusPill status={run.status} /></td><td className="p-2"><Link to="/farm/$runId" params={{ runId: run.id }} className="underline">Xem</Link></td></tr>)}{farmRuns.length === 0 && <tr><td className="p-4">Chưa có lần chạy Device Farm.</td></tr>}</tbody></table></div></section>
  </AppShell>;
}

function EnvEditor({ entries, onChange }: { entries: EnvEntry[]; onChange: (entries: EnvEntry[]) => void }) {
  const change = (index: number, key: keyof EnvEntry, value: string) => onChange(entries.map((entry, i) => i === index ? { ...entry, [key]: value } : entry));
  return <section className="border-border mt-4 rounded border p-3"><div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-medium">Biến môi trường</h3><p className="text-muted-foreground text-xs">Chỉ gửi cho lượt chạy này và được lưu vào cấu hình Farm.</p></div><button className="button" type="button" onClick={() => onChange([...entries, { key: '', value: '' }])}>+ Thêm biến</button></div>{entries.map((entry, index) => <div key={`${index}-${entry.key}`} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input aria-label={`Tên biến ${index + 1}`} className="input mt-0" placeholder="TÊN_BIẾN" value={entry.key} onChange={(e) => change(index, 'key', e.target.value)} /><input aria-label={`Giá trị biến ${index + 1}`} className="input mt-0" placeholder="giá trị" value={entry.value} onChange={(e) => change(index, 'value', e.target.value)} /><button className="button" type="button" aria-label={`Xoá biến ${index + 1}`} onClick={() => onChange(entries.filter((_, i) => i !== index))}>Xoá</button></div>)}</section>;
}

function Card({ title, children }: { title: string; children: ReactNode }) { return <section className="border-border mt-4 max-w-4xl rounded-lg border p-5"><h2 className="font-medium">{title}</h2><div className="mt-3">{children}</div></section>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <label className="text-sm">{label}<select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
function Text({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-sm">{label}<input className="input" value={value} onChange={(e) => onChange(e.target.value)} /></label>; }
