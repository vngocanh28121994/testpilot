import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { FileText, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { CheckRow } from '@/components/CheckRow';
import { Dropdown } from '@/components/Dropdown';
import { LogView } from '@/components/LogView';
import { Field } from '@/components/Field';
import { GroupHeading } from '@/components/GroupHeading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState, useRecentRuns } from '@/hooks/useAppState';
import { StatusBanner } from '@/components/StatusBanner';
import { ReportAction } from '@/components/ReportAction';
import { WorkflowStages } from '@/components/WorkflowStages';
import { WorkflowCompletion, useWorkflowCompletion } from '@/components/WorkflowCompletion';
import { RecentWorkflows } from './RecentWorkflows';
import { WorkflowPreflight, type NativePlatform } from './WorkflowPreflight';
import { useStreamJob } from '@/hooks/useStreamJob';
import type {
  ModelsResponse,
  StateResponse,
  StudioForm,
  StudioSaveResponse,
} from '@core/ui/contracts.js';

const PAGE_DESCRIPTION = 'Từ tài liệu nguồn tới kịch bản đã duyệt và chạy tự động.';

const PLATFORMS = ['web', 'android', 'ios'] as const;

/**
 * Câu chú thích dưới ô Model.
 *
 * Ba trạng thái khác hẳn nhau và trước đây bị gộp làm hai: danh sách thật,
 * danh sách đoán (có key nhưng không gọi được), và không có key nào cả. Trường
 * hợp thứ ba từng hiện ra một danh sách Anthropic cho người đang dùng DeepSeek
 * — sai theo cả hai chiều, và không hề nói rằng nguyên nhân là thiếu key.
 */
function modelHint(data: ModelsResponse | undefined): string | undefined {
  if (!data) return undefined;
  const auto = `auto = ${data.auto ?? 'chưa xác định'}.`;
  // missingKeyHint() đã tự kết thúc bằng dấu chấm, còn một thông báo lỗi mạng
  // thì không. Nối thẳng vào là ra "ETIMEDOUT." hoặc "ANTHROPIC_API_KEY..",
  // tuỳ nguồn — nên cắt dấu chấm cuối rồi tự đặt lại.
  const why = data.reason?.replace(/\.\s*$/, '');
  if (data.live) return `${auto} Danh sách lấy trực tiếp từ nhà cung cấp.`;
  if (data.models.length > 0) {
    return `${auto} Không hỏi được nhà cung cấp nên đang đoán${why ? ` — ${why}` : ''}.`;
  }
  return `${auto} Chưa hỏi được model nào${
    why ? ` — ${why}` : ''
  }. Gõ tay tên model, hoặc thêm API key ở trang Cấu hình.`;
}

export default function StudioPanel() {
  const state = useAppState((s) => s);

  if (!state.data) {
    return (
      <AppShell title="App Automation Studio" description={PAGE_DESCRIPTION}>
        {state.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {(state.error as Error).message}
          </p>
        ) : (
          <div className="flex flex-col gap-6" aria-busy="true" aria-label="Đang tải Studio…">
            <div className="grid gap-6 xl:grid-cols-2">
              <Skeleton className="h-56 w-full rounded-xl" />
              <Skeleton className="h-56 w-full rounded-xl" />
            </div>
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}
      </AppShell>
    );
  }

  return <StudioFormPanel state={state.data} />;
}

function StudioFormPanel({ state }: { state: StateResponse }) {
  const client = useQueryClient();
  const cfg = state.config;
  const [sources, setSources] = useState(() => cfg.sources);
  const [source, setSource] = useState('');
  const [baseUrl, setBaseUrl] = useState(cfg.web.baseUrl);
  const [targetFeature, setTargetFeature] = useState(cfg.targetFeature);
  const [model, setModel] = useState(cfg.llm.model);
  const [note, setNote] = useState(cfg.llm.note);
  const [accounts, setAccounts] = useState(() =>
    state.accounts.map((item) => ({
      label: item.label,
      username: item.username,
      password: '',
      previousLabel: item.label,
      hasPassword: item.hasPassword,
    })),
  );
  const [platforms, setPlatforms] = useState<Set<(typeof PLATFORMS)[number]>>(
    () => new Set(cfg.workflow.platforms),
  );
  const [farm, setFarm] = useState(cfg.workflow.deviceFarm?.platform ?? '');
  /**
   * Máy đã chọn cho mỗi nền tảng, theo `id` trong config, giữ ở đây từ lúc chọn
   * tới lúc lưu. Chỉ có giá trị khi nhiều hơn một máy trong config đang cắm.
   */
  const [devices, setDevices] = useState<Partial<Record<NativePlatform, string>>>(
    () => ({ ...cfg.workflow.devices }),
  );
  const [workflowEnv, setWorkflowEnv] = useState(cfg.workflow.env ?? cfg.defaultEnv);
  const [headed, setHeaded] = useState(cfg.workflow.headed);
  const job = useStreamJob('studio-workflow', STREAM_ROUTES.gen);
  const completion = useWorkflowCompletion();
  const runs = useRecentRuns();

  /**
   * Danh sách bước lấy từ nguồn TƯƠI NHẤT, không phải từ luồng đã kết thúc.
   *
   * Luồng sinh kịch bản để lại một ảnh chụp đông cứng đúng lúc nó dừng: bước
   * "Chờ duyệt" đang quay, năm bước sau còn chờ. Workflow rồi chạy tiếp và xong
   * hẳn, nhưng ảnh chụp ấy không biết — nên màn hình nói workflow vẫn đang chờ
   * duyệt trong khi log ngay bên trên đã báo test chạy xong và có report.
   *
   * Thứ tự ưu tiên: luồng nào ĐANG chạy thì nó tươi nhất; không luồng nào chạy
   * thì state của server là nguồn đúng, vì nó được làm mới sau mỗi lần xong.
   */
  const liveRun =
    completion.status === 'running'
      ? completion.run
      : job.status === 'running'
        ? job.run
        : null;
  const runId = liveRun?.id ?? completion.run?.id ?? job.run?.id;
  const stagesRun =
    liveRun ?? (runs.data ?? []).find((item) => item.id === runId) ?? completion.run ?? job.run;
  const navigate = useNavigate();

  /**
   * Workflow vừa dừng lại chờ người duyệt thì đưa thẳng sang màn duyệt.
   *
   * Chỉ chuyển khi luồng CHUYỂN từ đang-chạy sang xong, không phải hễ thấy nó
   * đang ở trạng thái xong. Khác biệt đó là tất cả: effect chạy lại mỗi lần
   * Studio được mount, nên bản đầu tiên đá người dùng ra khỏi Studio mỗi lần họ
   * quay lại — kể cả khi tự bấm vào menu — chừng nào còn một lượt chờ duyệt.
   * Studio trở thành trang không vào được, và cái vòng "Hoàn thành rồi quay về
   * Studio" thì quay về đúng chỗ cũ.
   */
  //
  // Cách nhận biết: luồng đã kết thúc SẴN từ lúc mở trang thì bỏ qua; chỉ luồng
  // kết thúc trong lúc người dùng đang ngồi ở đây mới được chuyển màn.
  //
  // Không so với trạng thái "đang chạy" của lần render trước: một luồng nhanh
  // có thể không bao giờ được render ở trạng thái đó — React gộp các lần cập
  // nhật — và khi ấy cú chuyển màn lặng lẽ không xảy ra.
  const alreadyFinished = useRef(job.status === 'done' || job.status === 'error');
  useEffect(() => {
    if (job.status !== 'done' || alreadyFinished.current) return;
    alreadyFinished.current = true;

    const status = job.run?.status;
    if (status !== 'waiting_review' && status !== 'waiting_input') return;
    // Làm mới trước khi chuyển: cổng duyệt tìm run đang chờ trong state, nên
    // sang tới nơi mà state còn cũ thì màn hình trống trơn.
    // Lọc sẵn theo đúng file vừa sinh và theo trạng thái chờ duyệt: màn Kịch
    // bản liệt kê mọi kịch bản của mọi feature, nên mở ra mà không lọc thì mấy
    // kịch bản mới nằm lẫn giữa hàng chục cái đã duyệt từ trước.
    const generatedFile = job.run?.generatedFile;
    void client
      .invalidateQueries({ queryKey: ['state'] })
      .then(() =>
        navigate({ to: '/scenarios', search: { file: generatedFile, status: 'pending' } }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.status, job.run?.status]);
  /**
   * Danh sách model, hỏi thẳng nhà cung cấp.
   *
   * Gõ tay tên model thì gõ sai đến lúc chạy mới biết — sau khi đã đọc tài liệu
   * và gọi model một lần. `auto` là lựa chọn duy nhất luôn có, vì nó phân giải
   * ở phía server theo key mà server thực sự có.
   */
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api.get<ModelsResponse>(ROUTES.models),
  });

  const makeForm = (): StudioForm => ({
    sources,
    baseUrl,
    targetFeature,
    model,
    note,
    // Chỉ bốn field của StudioAccountInput. `hasPassword` là cờ hiển thị của
    // riêng trình duyệt — gửi lên là nói dối server về thứ nó vừa gửi xuống.
    accounts: accounts.map(({ label, username, password, previousLabel }) => ({
      label,
      username,
      password,
      previousLabel,
    })),
    workflowPlatforms: [...platforms],
    workflowEnv,
    workflowHeaded: headed,
    workflowDeviceFarm: farm ? { platform: farm as 'android' | 'ios' } : null,
    // Gửi cả khi rỗng, để bỏ tick nền tảng nhiều máy cuối cùng thì xoá luôn cái
    // ghim cũ, thay vì để lượt chạy nhắm vào một máy không ai dùng nữa.
    workflowDevices: devices,
  });

  const save = useMutation({
    mutationFn: () => api.post<StudioSaveResponse>(ROUTES.studioSave, makeForm()),
    onSuccess: () => {
      toast.success('Đã lưu cấu hình Studio.');
      void client.invalidateQueries({ queryKey: ['state'] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const addSource = () => {
    const clean = source.trim();
    if (clean && !sources.includes(clean)) setSources((all) => [...all, clean]);
    setSource('');
  };

  const togglePlatform = (item: (typeof PLATFORMS)[number], checked: boolean) =>
    setPlatforms((old) => {
      const next = new Set(old);
      if (checked) next.add(item);
      else next.delete(item);
      return next;
    });

  const setAccount = (index: number, patch: Partial<(typeof accounts)[number]>) =>
    setAccounts((all) => all.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <AppShell title="App Automation Studio" description={PAGE_DESCRIPTION}>
      <section aria-label="App Automation Studio" className="flex flex-1 flex-col gap-6">
        <section className="grid gap-4">
          <GroupHeading title="Đầu vào">
            Tài liệu nguồn và môi trường mà TestPilot đọc để sinh kịch bản.
          </GroupHeading>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card aria-labelledby="sources-title">
              <CardHeader>
                <CardTitle id="sources-title">Tài liệu nguồn</CardTitle>
                <CardDescription>
                  Link Confluence hoặc Figma. Thêm được nhiều nguồn cho một chức năng.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field label="Tài liệu đầu vào (Confluence hoặc Figma)">
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      value={source}
                      placeholder="Dán link Confluence/Figma…"
                      onChange={(e) => setSource(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSource();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addSource}>
                      <Plus className="size-4" />
                      Thêm
                    </Button>
                  </div>
                </Field>

                {sources.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {sources.map((item) => (
                      <li
                        key={item}
                        className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <FileText className="text-muted-foreground size-4 shrink-0" />
                        <span className="min-w-0 truncate">{item}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Xoá ${item}`}
                          className="text-muted-foreground hover:text-destructive ms-auto size-7"
                          onClick={() =>
                            setSources((all) => all.filter((value) => value !== item))
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Chưa có tài liệu nào. Không có nguồn thì workflow không sinh được kịch bản.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card aria-labelledby="target-title">
              <CardHeader>
                <CardTitle id="target-title">Mục tiêu kiểm thử</CardTitle>
                <CardDescription>
                  Chức năng cần phủ và môi trường sẽ chạy test lên.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field label="Test Environment URL">
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                </Field>
                <Field label="Tên chức năng cần kiểm thử">
                  <Input
                    value={targetFeature}
                    onChange={(e) => setTargetFeature(e.target.value)}
                  />
                </Field>
              </CardContent>
            </Card>
          </div>
        </section>

        <Card aria-labelledby="accounts-title">
          <CardHeader>
            <CardTitle id="accounts-title">Test Accounts</CardTitle>
            <CardDescription>
              Mật khẩu lưu riêng trong secrets và không bao giờ được đọc lại.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {accounts.length === 0 && (
              <p className="text-muted-foreground text-sm">Chưa có account nào.</p>
            )}
            {accounts.map((account, index) => (
              <div
                key={`${account.previousLabel}-${index}`}
                className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <Input
                  aria-label={`Vai trò account ${index + 1}`}
                  placeholder="Vai trò"
                  value={account.label}
                  onChange={(e) => setAccount(index, { label: e.target.value })}
                />
                <Input
                  aria-label={`Username account ${index + 1}`}
                  placeholder="Username"
                  autoComplete="off"
                  value={account.username}
                  onChange={(e) => setAccount(index, { username: e.target.value })}
                />
                <Input
                  aria-label={`Mật khẩu account ${index + 1}`}
                  type="password"
                  autoComplete="off"
                  // Ô luôn rỗng kể cả khi đã có mật khẩu: server chỉ gửi cờ
                  // hasPassword về, không bao giờ gửi giá trị (R9).
                  placeholder={account.hasPassword ? '•••••••• (đã lưu)' : 'Mật khẩu'}
                  value={account.password}
                  onChange={(e) => setAccount(index, { password: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Xoá account"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setAccounts((all) => all.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() =>
                setAccounts((all) => [
                  ...all,
                  { label: '', username: '', password: '', previousLabel: '', hasPassword: false },
                ])
              }
            >
              + Thêm account
            </Button>
          </CardContent>
        </Card>

        <section className="grid gap-4">
          <GroupHeading title="Sinh và chạy">
            Model dùng để sinh kịch bản, và những gì chạy tự động ngay sau khi được duyệt.
          </GroupHeading>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card aria-labelledby="model-title">
              <CardHeader>
                <CardTitle id="model-title">Model</CardTitle>
                <CardDescription>Model và ghi chú kèm theo mỗi lần sinh.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field
                  label="Model"
                  hint={modelHint(models.data)}
                >
                  {/* Không hỏi được nhà cung cấp thì quay về ô gõ tay, chứ
                      không dựng một dropdown chỉ có mỗi "auto": khoá người dùng
                      khỏi chính model họ đang chạy là tệ hơn là để họ gõ. */}
                  {models.data && models.data.models.length > 0 ? (
                    <Dropdown
                      className="mt-0"
                      value={model}
                      onChange={setModel}
                      options={[
                        { value: 'auto', label: 'auto' },
                        // Model đang lưu mà không còn trong danh sách vẫn phải
                        // hiện ra, nếu không dropdown lặng lẽ đổi cấu hình sang
                        // mục đầu tiên ngay khi mở trang.
                        ...(!models.data.models.some((m) => m.id === model) && model !== 'auto'
                          ? [{ value: model, label: `${model} (không còn trong danh sách)` }]
                          : []),
                        ...models.data.models.map((m) => ({
                          value: m.id,
                          label: m.display_name ?? m.id,
                        })),
                      ]}
                    />
                  ) : (
                    <Input value={model} onChange={(e) => setModel(e.target.value)} />
                  )}
                </Field>
                <Field label="Additional Note">
                  <Textarea
                    className="min-h-20"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
              </CardContent>
            </Card>

            <Card aria-labelledby="autorun-title">
              <CardHeader>
                <CardTitle id="autorun-title">Tự động chạy sau khi duyệt</CardTitle>
                <CardDescription>
                  Không tick gì thì workflow dừng lại ở bước sinh kịch bản.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {PLATFORMS.map((item) => (
                    <CheckRow
                      key={item}
                      label={item}
                      checked={platforms.has(item)}
                      onChange={(checked) => togglePlatform(item, checked)}
                    />
                  ))}
                  <CheckRow
                    label="Device Farm"
                    checked={Boolean(farm)}
                    onChange={(checked) => setFarm(checked ? 'android' : '')}
                  />
                </div>

                <WorkflowPreflight
                  platforms={[...platforms].filter(
                    (item): item is NativePlatform => item !== 'web',
                  )}
                  devices={devices}
                  onPick={(platform, id) => setDevices((all) => ({ ...all, [platform]: id }))}
                />

                {farm && (
                  <Field label="Hệ điều hành trên Device Farm">
                    <Dropdown
                      className="mt-0"
                      value={farm}
                      onChange={setFarm}
                      options={[
                        { value: 'android', label: 'Android' },
                        { value: 'ios', label: 'iOS' },
                      ]}
                    />
                  </Field>
                )}

                <Field label="Môi trường">
                  <Dropdown
                    className="mt-0"
                    value={workflowEnv}
                    onChange={setWorkflowEnv}
                    options={
                      // Config chưa khai môi trường nào thì danh sách rỗng trơ
                      // ra như đang hỏng; nói thẳng ra vẫn hơn.
                      Object.keys(cfg.environments).length === 0
                        ? [{ value: '', label: '— chưa cấu hình môi trường —' }]
                        : Object.keys(cfg.environments).map((item) => ({
                            value: item,
                            label: item,
                          }))
                    }
                  />
                </Field>

                <CheckRow
                  label="Hiện trình duyệt (web)"
                  checked={headed}
                  onChange={setHeaded}
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={job.status === 'running'} onClick={() => job.start(makeForm())}>
              <Play className="size-4" />
              {job.status === 'running' ? 'Đang chạy workflow…' : 'Bắt đầu chạy workflow'}
            </Button>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
              <Save className="size-4" />
              {save.isPending ? 'Đang lưu…' : 'Lưu (không chạy)'}
            </Button>
          </div>
        </section>

        {job.logs.length + completion.logs.length > 0 && (
          <Card aria-labelledby="progress-title">
            <CardHeader>
              <CardTitle id="progress-title">Tiến trình workflow</CardTitle>
              <CardDescription>
                {/* Đừng nói "đang diễn ra" khi nó đã xong: chính câu này, cộng
                    với vòng quay ở bước cuối, làm màn hình khẳng định workflow
                    còn đang chạy trong khi log ngay dưới đã báo có report. */}
                {job.status === 'running' || completion.status === 'running'
                  ? 'Log trực tiếp từ lượt chạy đang diễn ra.'
                  : 'Log của lượt chạy gần nhất.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {stagesRun?.stages?.length ? (
                <WorkflowStages stages={stagesRun.stages} runStatus={stagesRun.status} />
              ) : null}
              {/* MỘT dòng log liên tục: log sinh kịch bản, rồi log chạy test
                  nối ngay sau. Đó là cùng một workflow và người đọc theo dõi nó
                  theo thời gian; tách làm hai khối cạnh nhau thì phải tự ghép
                  lại trong đầu, và khối cũ trông như vẫn đang chạy. */}
              <LogView
                logs={[...job.logs, ...completion.logs]}
                dropped={job.dropped + completion.dropped}
                error={completion.error ?? job.error}
                label="Log workflow"
              />
              {/*
                Kết cục của chính lượt sinh kịch bản.
                Nó chỉ dừng để duyệt khi có kịch bản mới; còn lại thì chạy thẳng
                tới hết — và khi đó, trước đây, log đơn giản là ngừng chảy.
                Không ai nói đã xong hay đã hỏng.
              */}
              {job.status === 'error' && (
                <StatusBanner
                  tone="fail"
                  title="Workflow dừng giữa chừng"
                  detail={job.error ?? 'Không rõ lý do — xem log bên dưới.'}
                />
              )}
              {job.status === 'done' && job.run?.status === 'passed' && (
                <StatusBanner
                  tone="pass"
                  title="Workflow đã hoàn tất"
                  detail="Không có bước nào cần duyệt."
                  actions={<ReportAction runDirs={job.run?.runDirs} />}
                />
              )}
              {job.status === 'done' && job.run?.status === 'failed' && (
                <StatusBanner
                  tone="warn"
                  title="Workflow kết thúc với lỗi"
                  detail="Xem log bên dưới để biết bước nào hỏng."
                  actions={<ReportAction runDirs={job.run?.runDirs} />}
                />
              )}
              {/* Kết cục nằm NGAY SAU log, không phải phía trên nó.
                  Log tự cuộn xuống đáy trong lúc chạy, nên mắt người đọc ở cuối
                  khung — đặt kết quả lên đầu thẻ nghĩa là ai không kéo ngược lên
                  thì không biết là đã xong. */}
              <WorkflowCompletion />
            </CardContent>
          </Card>
        )}

        {/* Lịch sử workflow đứng ngay trên trang đã khởi động chúng — bản cũ đặt
            đúng chỗ này, và trang lịch sử đầy đủ của bản React thì không có lối
            nào dẫn tới cho tới giờ. */}
        <RecentWorkflows />
      </section>
    </AppShell>
  );
}
