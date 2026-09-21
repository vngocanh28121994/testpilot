/**
 * Studio: lưu cấu hình sinh testcase mà không cần chạy cả pipeline.
 *
 * `applyForm()` đi cùng route vì nó CHÍNH LÀ route này — không nơi nào khác
 * gọi nó. Để nó ở `server.ts` chỉ làm file kia dài thêm mà không ai được lợi.
 */
import { ConfigSchema, loadConfig, saveConfig, type TestPilotConfig } from '../../config.js';
import { Secrets } from '../../core/secrets.js';
import type { StudioForm } from '../../ui/contracts.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

/**
 * Folds the form into testpilot.config.json, and the passwords into the
 * separate secrets file. A password submitted as an empty string means "leave
 * the stored one alone" — the UI never receives the value back, so it cannot
 * echo it, and a plain save must not therefore wipe it.
 */
/**
 * Form của màn Studio → config trên đĩa.
 *
 * Export vì `POST /api/gen` còn nằm ở `server.ts` và phải lưu trước khi chạy:
 * form CHÍNH LÀ config, và một lượt chạy có đầu vào chưa từng được lưu thì
 * không dựng lại được từ terminal. Khi route `gen` chuyển sang đây thì export
 * này bỏ được.
 */
export async function applyForm(form: StudioForm, configFile: string): Promise<TestPilotConfig> {
  const current = await loadConfig(configFile).catch(() =>
    ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } }),
  );

  const accounts = (form.accounts ?? [])
    .filter((a) => a.label?.trim())
    .map((a) => ({ label: a.label.trim(), username: a.username ?? '' }));

  const draft = {
    ...current,
    sources: (form.sources ?? current.sources).filter((s) => s.trim()),
    targetFeature: form.targetFeature?.trim() ?? current.targetFeature,
    accounts,
    ...(form.defaultEnv?.trim() ? { defaultEnv: form.defaultEnv.trim() } : {}),
    // Empty objects are dropped so an environment that overrides nothing does
    // not write `"ios": {}` into the config on every save.
    ...(form.environments
      ? {
          environments: Object.fromEntries(
            Object.entries(form.environments).map(([name, e]) => [
              name,
              {
                accounts: e.accounts ?? {},
                ...(e.ios?.app?.trim() ? { ios: { app: e.ios.app.trim() } } : {}),
                ...(e.android?.app?.trim() ? { android: { app: e.android.app.trim() } } : {}),
                ...(e.web?.baseUrl?.trim() ? { web: { baseUrl: e.web.baseUrl.trim() } } : {}),
              },
            ]),
          ),
        }
      : {}),
    web: { ...current.web, baseUrl: form.baseUrl?.trim() || current.web.baseUrl },
    llm: {
      ...current.llm,
      model: form.model ?? current.llm.model,
      note: form.note ?? current.llm.note,
    },
    workflow: {
      ...current.workflow,
      // Taken verbatim when the form carried it: an empty list is now a real
      // answer ("run on the farm only"), not a form that forgot to say.
      platforms: form.workflowPlatforms ?? current.workflow.platforms,
      env: form.workflowEnv?.trim() || current.workflow.env || current.defaultEnv,
      appSource: form.workflowAppSource ?? current.workflow.appSource,
      headed: form.workflowHeaded ?? current.workflow.headed,
      ...(form.workflowDeviceFarm !== undefined
        ? { deviceFarm: form.workflowDeviceFarm ?? undefined }
        : {}),
      ...(form.workflowDevices !== undefined
        ? { devices: form.workflowDevices ?? undefined }
        : {}),
    },
  };

  const parsed = ConfigSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  await saveConfig(parsed.data, configFile);

  const secrets = await Secrets.load();
  for (const a of form.accounts ?? []) {
    const label = a.label?.trim();
    if (!label) continue;

    if (a.password) {
      secrets.set(label, a.password);
      continue;
    }
    // An empty password field means "leave it alone" — the value was never
    // sent to the browser, so it cannot be echoed back. When the label also
    // changed, "alone" has to follow the rename or the password is dropped on
    // the floor and the account silently stops working.
    const from = a.previousLabel?.trim();
    if (from && from !== label) {
      const carried = secrets.get(from);
      if (carried !== undefined) secrets.set(label, carried);
    }
  }
  secrets.keepOnly(accounts.map((a) => a.label));
  await secrets.save();

  return parsed.data;
}

export const studioRoutes: RouteTable = {
  // Saving and running are separate on purpose. Generation needs an API key,
  // so without this the only way to persist a test account was to run the
  // whole pipeline — and anyone without a key typed their credentials into a
  // form that silently discarded them.
  'POST /api/studio/save': async (req, res, url, ctx) => {
    const saved = await applyForm(await readJson<StudioForm>(req), ctx.configFile);
    const secrets = await Secrets.load();
    return json(res, 200, {
      ok: true,
      accounts: saved.accounts.map((a) => ({ ...a, hasPassword: secrets.has(a.label) })),
    });
  },
};
