import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { CheckRow } from '@/components/CheckRow';
import { Field } from '@/components/Field';
import { GroupHeading } from '@/components/GroupHeading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { useStreamJob } from '@/hooks/useStreamJob';
import type { StateResponse, StudioForm, StudioSaveResponse } from '@core/ui/contracts.js';

const PAGE_DESCRIPTION = 'Từ tài liệu nguồn tới kịch bản đã duyệt và chạy tự động.';

const PLATFORMS = ['web', 'android', 'ios'] as const;

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
  const [workflowEnv, setWorkflowEnv] = useState(cfg.workflow.env ?? cfg.defaultEnv);
  const [headed, setHeaded] = useState(cfg.workflow.headed);
  const job = useStreamJob('studio-workflow', STREAM_ROUTES.gen);

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
                <Field label="Model">
                  <Input value={model} onChange={(e) => setModel(e.target.value)} />
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

                {farm && (
                  <Field label="Hệ điều hành trên Device Farm">
                    <select
                      className="input mt-0"
                      value={farm}
                      onChange={(e) => setFarm(e.target.value)}
                    >
                      <option value="android">Android</option>
                      <option value="ios">iOS</option>
                    </select>
                  </Field>
                )}

                <Field label="Môi trường">
                  <select
                    className="input mt-0"
                    value={workflowEnv}
                    onChange={(e) => setWorkflowEnv(e.target.value)}
                  >
                    {/* Config chưa khai môi trường nào thì select rỗng trơ ra như
                        đang hỏng; nói thẳng ra vẫn hơn. */}
                    {Object.keys(cfg.environments).length === 0 && (
                      <option value="">— chưa cấu hình môi trường —</option>
                    )}
                    {Object.keys(cfg.environments).map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
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

        {job.logs.length > 0 && (
          <Card aria-labelledby="progress-title">
            <CardHeader>
              <CardTitle id="progress-title">Tiến trình workflow</CardTitle>
              <CardDescription>Log trực tiếp từ lượt chạy đang diễn ra.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="console mt-0">{job.logs.join('\n')}</pre>
            </CardContent>
          </Card>
        )}
      </section>
    </AppShell>
  );
}
