import { useState } from 'react';
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
import { Field, Section } from './Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PATH_FIELDS = [
  ['docs', 'Tài liệu'],
  ['features', 'Feature'],
  ['registry', 'Registry'],
  ['reports', 'Report'],
] as const;

type PathKey = (typeof PATH_FIELDS)[number][0];

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
      <AppShell title="Personal Settings">
        {state.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {(state.error as Error).message}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Đang tải cài đặt…</p>
        )}
      </AppShell>
    );
  }

  return <SettingsForm state={state.data} authEmail={auth.data?.email ?? ''} hasToken={auth.data?.hasToken ?? false} authLoaded={auth.isSuccess} />;
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
    <AppShell title="Personal Settings">
      <div className="flex flex-col gap-5">
        {state.configError && (
          <p role="alert" className="text-destructive text-sm">
            {state.configError}
          </p>
        )}

        <Section title="Hệ thống">
          <p className="text-sm">
            File config: <code className="font-mono text-xs">{state.configFile}</code>
          </p>
          <p className="text-sm">
            Anthropic API key:{' '}
            <b>{state.hasApiKey ? 'đã set' : 'chưa set — không sinh được testcase'}</b>
          </p>
          <p className="text-sm">
            Element trong registry: <b>{state.elements}</b>
          </p>
        </Section>

        <Section title="Vision key (Gemini)">
          <Field label="Gemini API key" hint={vision.text}>
              <Input
                type="password"
                            value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              // Ô LUÔN bắt đầu rỗng, kể cả khi đã có key: server không bao giờ
              // gửi giá trị về (R9). Placeholder là thứ duy nhất nói ra trạng thái.
              placeholder={
                state.modelKeys.gemini ? '•••••••• (Gemini key đã lưu)' : 'Gemini API key'
              }
            />
          </Field>
          <div>
            <Button
              disabled={saveKey.isPending}
              onClick={() => {
                const key = geminiKey.trim();
                if (!key) return;
                saveKey.mutate({ provider: 'gemini', key }, { onSuccess: () => setGeminiKey('') });
              }}
              >
              {saveKey.isPending ? 'Đang lưu…' : 'Lưu vision key'}
            </Button>
            {!geminiKey.trim() && (
              <span className="text-muted-foreground ms-2 text-xs">
                Nhập key mới hoặc giữ nguyên key đã lưu.
              </span>
            )}
          </div>
        </Section>

        <Section title="Confluence">
          <Field label="Email Atlassian">
              <Input
                type="email"
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
                            value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? '•••••••• (token đã lưu)' : 'API token'}
            />
          </Field>
          <div>
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
              {saveAuth.isPending ? 'Đang lưu…' : 'Lưu Confluence auth'}
            </Button>
            {(!email.trim() || !token.trim()) && (
              <span className="text-muted-foreground ms-2 text-xs">
                Cần cả email Atlassian và API token.
              </span>
            )}
          </div>
        </Section>

        <Section title="MCP">
          <Field label="Transport">
              <select
                aria-label="Transport"
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
                  <Input
                     value={mcp.command} onChange={(e) => set('command', e.target.value)} />
              </Field>
              <Field label="Args" hint="Cách nhau bằng dấu cách.">
                  <Input
                     value={mcp.args} onChange={(e) => set('args', e.target.value)} />
              </Field>
            </>
          )}
          {mcp.transport === 'http' && (
            <Field label="URL">
                <Input
                   value={mcp.url} onChange={(e) => set('url', e.target.value)} />
            </Field>
          )}

          {mcp.transport && (
            <>
              <Field label="Tool: Confluence page">
                  <Input
                     value={mcp.confluencePage} onChange={(e) => set('confluencePage', e.target.value)} />
              </Field>
              <Field label="Tool: Figma file">
                  <Input
                     value={mcp.figmaFile} onChange={(e) => set('figmaFile', e.target.value)} />
              </Field>
              <Field label="Tool: Confluence attachments">
                  <Input
                     value={mcp.confluenceAttachments} onChange={(e) => set('confluenceAttachments', e.target.value)} />
              </Field>
              <Field label="Tool: Figma image">
                  <Input
                     value={mcp.figmaImage} onChange={(e) => set('figmaImage', e.target.value)} />
              </Field>
              <div>
                <Button
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
                  variant="outline"
                >
                  {probe.isPending ? 'Đang kết nối…' : 'Kiểm tra kết nối'}
                </Button>
                {probe.isSuccess && (
                  <span className="text-muted-foreground ms-2 text-xs">
                    {probe.data.tools.length} tool khả dụng.
                  </span>
                )}
              </div>
            </>
          )}
        </Section>

        <Section title="Đường dẫn">
          {PATH_FIELDS.map(([key, label]) => (
            <Field key={key} label={label}>
                <Input
                                  value={paths[key]}
                onChange={(e) => setPaths((p) => ({ ...p, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </Section>

        <div>
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
            {saveConfig.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
