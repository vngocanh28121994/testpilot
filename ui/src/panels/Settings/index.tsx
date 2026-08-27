import { useState } from 'react';
import {
  FolderTree,
  KeyRound,
  Plug,
  Save,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import type { StateResponse } from '@core/ui/contracts.js';
import { useAppState } from '@/hooks/useAppState';
import {
  useConfluenceAuth,
  useProbeMcp,
  useSaveConfig,
  useSaveConfluenceAuth,
  useSaveModelKey,
} from './hooks/useSettings';
import { mcpFromForm, mcpToForm, visionKeyStatus, type McpForm } from './mcp';
import { Field } from '@/components/Field';
import { GroupHeading } from '@/components/GroupHeading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

const PATH_FIELDS = [
  ['docs', 'Tài liệu'],
  ['features', 'Feature'],
  ['registry', 'Registry'],
  ['reports', 'Report'],
] as const;

type PathKey = (typeof PATH_FIELDS)[number][0];

const PAGE_DESCRIPTION = 'Khoá, kết nối và đường dẫn dùng chung cho cả workspace.';

/** Một dòng trạng thái chỉ đọc trong thẻ Hệ thống. */
function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </li>
  );
}

/**
 * Tách phần tải dữ liệu khỏi phần form một cách có chủ đích.
 *
 * Cách hiển nhiên là một component với `useEffect` đồng bộ config vào state —
 * và nó sai theo hai cách: mỗi lần refetch sẽ ghi đè lên thứ người dùng đang gõ
 * dở, và nó gây một lượt render thừa (rule react-hooks bắt đúng chỗ này).
 *
 * Ở đây form chỉ được mount KHI ĐÃ có config, nên useState khởi tạo thẳng từ
 * prop và không cần đồng bộ gì nữa.
 */
export default function SettingsPanel() {
  const state = useAppState((s) => s);
  const auth = useConfluenceAuth();

  if (!state.data) {
    return (
      <AppShell title="Personal Settings" description={PAGE_DESCRIPTION}>
        {state.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {(state.error as Error).message}
          </p>
        ) : (
          // Khung xương thay cho một dòng chữ: giữ nguyên bố cục để trang không
          // nhảy một nhịp khi config về.
          <div className="flex flex-col gap-6" aria-busy="true" aria-label="Đang tải cài đặt…">
            <Skeleton className="h-40 w-full rounded-xl" />
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-56 w-full rounded-xl" />
              <Skeleton className="h-56 w-full rounded-xl" />
            </div>
          </div>
        )}
      </AppShell>
    );
  }

  return (
    <SettingsForm
      state={state.data}
      authEmail={auth.data?.email ?? ''}
      hasToken={auth.data?.hasToken ?? false}
      authLoaded={auth.isSuccess}
    />
  );
}

function SettingsForm({
  state,
  authEmail,
  hasToken,
  authLoaded,
}: {
  state: StateResponse;
  authEmail: string;
  hasToken: boolean;
  authLoaded: boolean;
}) {
  const config = state.config;

  const [mcp, setMcp] = useState<McpForm>(() => mcpToForm(config.mcp));
  const [paths, setPaths] = useState<Record<PathKey, string>>(() => ({
    docs: config.paths.docs,
    features: config.paths.features,
    registry: config.paths.registry,
    reports: config.paths.reports,
  }));
  const [geminiKey, setGeminiKey] = useState('');
  const [emailEdit, setEmailEdit] = useState<string | null>(null);
  const [token, setToken] = useState('');

  // Email do server trả về cho tới khi người dùng gõ vào ô đó lần đầu.
  const email = emailEdit ?? authEmail;

  const saveConfig = useSaveConfig();
  const saveKey = useSaveModelKey();
  const saveAuth = useSaveConfluenceAuth();
  const probe = useProbeMcp();

  const vision = visionKeyStatus(state.modelKeys);
  const set = <K extends keyof McpForm>(k: K, v: McpForm[K]) => setMcp((m) => ({ ...m, [k]: v }));

  return (
    <AppShell title="Personal Settings" description={PAGE_DESCRIPTION}>
      <section
        data-testid="panel-settings"
        aria-label="Personal settings"
        className="flex flex-1 flex-col gap-6"
      >
        {state.configError && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          >
            <XCircle className="size-4 shrink-0" />
            <span>{state.configError}</span>
          </div>
        )}

        <Card aria-labelledby="system-status-title">
          <CardHeader>
            <CardTitle id="system-status-title">Hệ thống</CardTitle>
            <CardDescription>
              Trạng thái chỉ đọc, đọc từ config đang nạp. Không sửa được ở đây.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              <StatusRow label="File config">
                <code className="text-muted-foreground truncate font-mono text-xs">
                  {state.configFile}
                </code>
              </StatusRow>
              <StatusRow label="Anthropic API key">
                {state.hasApiKey ? (
                  <Badge>
                    <ShieldCheck />
                    Đã set
                  </Badge>
                ) : (
                  <>
                    <span className="text-muted-foreground text-xs">
                      không sinh được testcase
                    </span>
                    <Badge variant="outline" className="text-muted-foreground">
                      <ShieldAlert />
                      Chưa set
                    </Badge>
                  </>
                )}
              </StatusRow>
              <StatusRow label="Element trong registry">
                <Badge variant="secondary">{state.elements}</Badge>
              </StatusRow>
            </ul>
          </CardContent>
        </Card>

        <section className="grid gap-4">
          <GroupHeading title="Khoá và kết nối">
            Mỗi thẻ lưu riêng, độc lập với nút lưu cấu hình bên dưới. Key đã lưu không bao giờ
            được gửi ngược về trình duyệt — ô luôn bắt đầu rỗng.
          </GroupHeading>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card aria-labelledby="vision-key-title">
              <CardHeader>
                <CardTitle id="vision-key-title">Vision key (Gemini)</CardTitle>
                <CardDescription>
                  Dùng để đọc ảnh trong tài liệu khi sinh testcase.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field label="Gemini API key" hint={vision.text}>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    // Ô LUÔN bắt đầu rỗng, kể cả khi đã có key: server không bao giờ
                    // gửi giá trị về (R9). Placeholder là thứ duy nhất nói ra trạng thái.
                    placeholder={
                      state.modelKeys.gemini ? '•••••••• (Gemini key đã lưu)' : 'Gemini API key'
                    }
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={saveKey.isPending}
                    onClick={() => {
                      const key = geminiKey.trim();
                      if (!key) return;
                      saveKey.mutate(
                        { provider: 'gemini', key },
                        { onSuccess: () => setGeminiKey('') },
                      );
                    }}
                  >
                    <KeyRound className="size-4" />
                    {saveKey.isPending ? 'Đang lưu…' : 'Lưu vision key'}
                  </Button>
                  {!geminiKey.trim() && (
                    <span className="text-muted-foreground text-xs">
                      Nhập key mới hoặc giữ nguyên key đã lưu.
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card aria-labelledby="confluence-title">
              <CardHeader>
                <CardTitle id="confluence-title">Confluence</CardTitle>
                <CardDescription>
                  Tài khoản Atlassian dùng để đọc tài liệu nguồn.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field label="Email Atlassian">
                  <Input
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmailEdit(e.target.value)}
                  />
                </Field>
                <Field
                  label="API token"
                  hint={authLoaded ? (hasToken ? '(đã cấu hình)' : '(chưa cấu hình)') : ''}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={hasToken ? '•••••••• (token đã lưu)' : 'API token'}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={saveAuth.isPending}
                    onClick={() => {
                      if (!email.trim() || !token.trim()) return;
                      saveAuth.mutate(
                        { email: email.trim(), token: token.trim() },
                        { onSuccess: () => setToken('') },
                      );
                    }}
                  >
                    <KeyRound className="size-4" />
                    {saveAuth.isPending ? 'Đang lưu…' : 'Lưu Confluence auth'}
                  </Button>
                  {(!email.trim() || !token.trim()) && (
                    <span className="text-muted-foreground text-xs">
                      Cần cả email Atlassian và API token.
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-4">
          <GroupHeading title="Cấu hình dự án">
            Hai thẻ này ghi vào cùng một file config, nên chúng dùng chung nút “Lưu cài đặt” ở
            cuối — khác với các thẻ khoá ở trên.
          </GroupHeading>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card aria-labelledby="mcp-title">
              <CardHeader>
                <CardTitle id="mcp-title">MCP</CardTitle>
                <CardDescription>
                  Server cung cấp tool đọc Confluence và Figma.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Field label="Transport">
                  <select
                    aria-label="Transport"
                    className="input mt-0"
                    value={mcp.transport}
                    onChange={(e) => set('transport', e.target.value as McpForm['transport'])}
                  >
                    <option value="">Không dùng MCP</option>
                    <option value="stdio">stdio</option>
                    <option value="http">http</option>
                  </select>
                </Field>

                {/* stdio và http mang hai bộ trường loại trừ nhau; hiện cả hai sẽ mời
                    người dùng điền một tổ hợp mà ConfigSchema từ chối. */}
                {mcp.transport === 'stdio' && (
                  <>
                    <Field label="Command">
                      <Input value={mcp.command} onChange={(e) => set('command', e.target.value)} />
                    </Field>
                    <Field label="Args" hint="Cách nhau bằng dấu cách.">
                      <Input value={mcp.args} onChange={(e) => set('args', e.target.value)} />
                    </Field>
                  </>
                )}
                {mcp.transport === 'http' && (
                  <Field label="URL">
                    <Input value={mcp.url} onChange={(e) => set('url', e.target.value)} />
                  </Field>
                )}

                {mcp.transport && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Tool: Confluence page">
                        <Input
                          value={mcp.confluencePage}
                          onChange={(e) => set('confluencePage', e.target.value)}
                        />
                      </Field>
                      <Field label="Tool: Figma file">
                        <Input
                          value={mcp.figmaFile}
                          onChange={(e) => set('figmaFile', e.target.value)}
                        />
                      </Field>
                      <Field label="Tool: Confluence attachments">
                        <Input
                          value={mcp.confluenceAttachments}
                          onChange={(e) => set('confluenceAttachments', e.target.value)}
                        />
                      </Field>
                      <Field label="Tool: Figma image">
                        <Input
                          value={mcp.figmaImage}
                          onChange={(e) => set('figmaImage', e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        disabled={probe.isPending}
                        onClick={() =>
                          probe.mutate(mcpFromForm(mcp), {
                            // Chỉ điền hộ ô còn TRỐNG — ghi đè thứ người dùng đã gõ
                            // là cách nhanh nhất để mất một cấu hình đúng.
                            onSuccess: ({ guess }) =>
                              setMcp((m) => ({
                                ...m,
                                confluencePage: m.confluencePage || (guess.confluencePage ?? ''),
                                figmaFile: m.figmaFile || (guess.figmaFile ?? ''),
                                confluenceAttachments:
                                  m.confluenceAttachments || (guess.confluenceAttachments ?? ''),
                                figmaImage: m.figmaImage || (guess.figmaImage ?? ''),
                              })),
                          })
                        }
                      >
                        <Plug className="size-4" />
                        {probe.isPending ? 'Đang kết nối…' : 'Kiểm tra kết nối'}
                      </Button>
                      {probe.isSuccess && (
                        <span className="text-muted-foreground text-xs">
                          {probe.data.tools.length} tool khả dụng.
                        </span>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card aria-labelledby="paths-title">
              <CardHeader>
                <CardTitle id="paths-title">Đường dẫn</CardTitle>
                <CardDescription>
                  Thư mục tương đối so với gốc repo, nơi TestPilot đọc và ghi.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {PATH_FIELDS.map(([key, label]) => (
                    <Field key={key} label={label}>
                      <Input
                        value={paths[key]}
                        onChange={(e) => setPaths((p) => ({ ...p, [key]: e.target.value }))}
                      />
                    </Field>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={saveConfig.isPending}
              onClick={() => {
                saveConfig.mutate({
                  ...config,
                  mcp: mcpFromForm(mcp),
                  paths: {
                    ...config.paths,
                    docs: paths.docs.trim(),
                    features: paths.features.trim(),
                    registry: paths.registry.trim(),
                    reports: paths.reports.trim(),
                  },
                });
              }}
            >
              <Save className="size-4" />
              {saveConfig.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}
            </Button>
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <FolderTree className="size-3.5" />
              Áp cho cả MCP và Đường dẫn.
            </span>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
