import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Test-account passwords are deliberately kept OUT of testpilot.config.json.
 * That file is meant to be committed, diffed and read inside the Device Farm
 * container; a password in it would be a password in git history forever.
 *
 * They live here instead: one gitignored, owner-only file. The UI never gets a
 * password back — only a boolean saying whether one is stored — and nothing in
 * this module is ever written to a log line or an SSE frame.
 */

export const SECRETS_FILE = '.testpilot.secrets.json';
export const MODEL_KEY_NAMES = [
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;

/**
 * Credentials for reading source documents, as opposed to calling a model.
 *
 * Confluence attachments are private and the MCP OAuth grant carries no
 * attachment scope, so images on a spec page need a Confluence API token of
 * their own. Stored alongside the model keys because the handling is identical:
 * kept locally, adopted into the process, never returned or logged.
 */
export const INGEST_KEY_NAMES = [
  'CONFLUENCE_EMAIL',
  'CONFLUENCE_API_TOKEN',
] as const;

interface SecretsFile {
  version: 1;
  /** account label -> password */
  accounts: Record<string, string>;
  /**
   * Vendor api keys, so a model key does not have to be exported by hand on
   * every shell that starts the server. Same rules as a password: never
   * committed, never logged, never returned to the browser.
   */
  apiKeys?: Record<string, string>;
}

const EMPTY: SecretsFile = { version: 1, accounts: {} };

export class Secrets {
  private constructor(
    private readonly file: string,
    private data: SecretsFile,
  ) {}

  static async load(file = SECRETS_FILE): Promise<Secrets> {
    const abs = path.resolve(file);
    if (!existsSync(abs)) return new Secrets(abs, { ...EMPTY, accounts: {} });
    try {
      const parsed = JSON.parse(await readFile(abs, 'utf8')) as Partial<SecretsFile>;
      return new Secrets(abs, {
        version: 1,
        accounts: parsed.accounts ?? {},
        ...(parsed.apiKeys ? { apiKeys: parsed.apiKeys } : {}),
      });
    } catch {
      // A corrupt secrets file must not take the whole UI down; treat it as empty.
      return new Secrets(abs, { ...EMPTY, accounts: {} });
    }
  }

  has(label: string): boolean {
    return Boolean(this.data.accounts[label]);
  }

  get(label: string): string | undefined {
    return this.data.accounts[label];
  }

  set(label: string, password: string): void {
    this.data.accounts[label] = password;
  }

  apiKey(name: string): string | undefined {
    return this.data.apiKeys?.[name];
  }

  setApiKey(name: string, key: string): void {
    this.data.apiKeys = { ...this.data.apiKeys, [name]: key };
  }

  /** Drops every stored password whose account no longer exists in the config. */
  keepOnly(labels: string[]): void {
    const keep = new Set(labels);
    for (const label of Object.keys(this.data.accounts)) {
      if (!keep.has(label)) delete this.data.accounts[label];
    }
  }

  async save(): Promise<void> {
    await writeFile(this.file, JSON.stringify(this.data, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    // writeFile only applies `mode` when it creates the file, so an existing
    // file keeps whatever permissions it had. Re-assert them every save.
    await chmod(this.file, 0o600).catch(() => {});
  }
}

/**
 * Load locally stored model keys into this process without returning or logging
 * their values. An explicitly exported environment variable always wins.
 * Shared by UI, generator CLI and runtime semantic discovery so provider
 * selection cannot depend on how the user started Horus.
 */
export async function adoptStoredApiKeys(file = SECRETS_FILE): Promise<void> {
  const secrets = await Secrets.load(file);
  for (const name of [...MODEL_KEY_NAMES, ...INGEST_KEY_NAMES]) {
    const stored = secrets.apiKey(name);
    if (stored && !process.env[name]) process.env[name] = stored;
  }
}

/**
 * The substitution table handed to the executor. Gherkin refers to credentials
 * as `{{account.maker.username}}`, never as a literal — so a .feature file stays
 * safe to commit and the same suite can run against any environment.
 */
export function accountVariables(
  accounts: Array<{ label: string; username: string }>,
  secrets: Secrets,
  alias: Record<string, string> = {},
): Record<string, string> {
  const vars: Record<string, string> = {};
  const put = (key: string, a: { label: string; username: string }): void => {
    vars[`account.${key}.username`] = a.username;

    // The secrets file is deliberately not shipped to a device farm, so on a
    // farm run the password arrives through the environment instead. Local
    // file first: it is the copy a developer just edited.
    const pw = secrets.get(a.label) ?? process.env[secretEnvName(a.label)];
    // Assigned or removed, never left behind. A role re-points an existing key
    // at a different account, so a password merely *not overwritten* is the
    // previous account's password sitting under the new account's username —
    // a SIT login attempted with the prod password, and a guard downstream
    // that sees a value and concludes all is well.
    if (pw !== undefined) vars[`account.${key}.password`] = pw;
    else delete vars[`account.${key}.password`];
  };

  for (const a of accounts) {
    const key = a.label.trim().toLowerCase();
    if (!key) continue;
    put(key, a);
  }

  // Roles last, so `{{account.tcbs.*}}` means the environment's account even
  // when a label of that name also exists. Without this precedence a config
  // whose prod label *is* `tcbs` would quietly keep resolving to prod on a SIT
  // run — the exact silent-wrong-environment failure the roles exist to stop.
  for (const [role, label] of Object.entries(alias)) {
    const key = role.trim().toLowerCase();
    const target = accounts.find((a) => a.label.trim().toLowerCase() === label.trim().toLowerCase());
    if (!key || !target) continue;
    put(key, target);
  }
  return vars;
}

/**
 * Environment variable carrying one account's password, used where the secrets
 * file cannot follow the run. `Maker` -> `TESTPILOT_SECRET_MAKER`.
 */
export function secretEnvName(label: string): string {
  return `TESTPILOT_SECRET_${label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/**
 * Passwords to export into a Device Farm testspec.
 *
 * Lived in the UI server until it turned out `npm run farm` never called it:
 * the CLI shipped a testspec with no secrets in it, `{{account.x.password}}`
 * survived expansion untouched, and the app was handed the placeholder itself
 * as a 25-character password. Three device runs failed at the login server
 * before anyone suspected the fill logic. Shared code, one behaviour.
 */
export async function farmSecretEnv(
  cfg: { farm: { sendSecrets: boolean }; accounts: Array<{ label: string }> },
  log: (line: string) => void,
): Promise<Record<string, string>> {
  if (!cfg.farm.sendSecrets) {
    if (cfg.accounts.length > 0) {
      log(
        'farm.sendSecrets = false — mật khẩu KHÔNG lên thiết bị; ' +
          '{{account.*.password}} sẽ giữ nguyên dạng placeholder.',
      );
    }
    return {};
  }

  const secrets = await Secrets.load();
  const env: Record<string, string> = {};
  const sent: string[] = [];
  for (const a of cfg.accounts) {
    const pw = secrets.get(a.label);
    if (pw === undefined) continue;
    env[secretEnvName(a.label)] = pw;
    sent.push(a.label);
  }
  if (sent.length > 0) {
    log(
      `Gửi mật khẩu của ${sent.length} account lên testspec: ${sent.join(', ')} ` +
        '(plaintext trên S3 — nhớ đổi mật khẩu sau khi test).',
    );
  }
  return env;
}
