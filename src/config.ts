import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * One JSON config for every surface. It has to be JSON rather than TypeScript
 * because the same file is read from inside the AWS Device Farm container,
 * where only the compiled `dist/` output exists.
 */

const Web = z.object({
  baseUrl: z.string().url(),
  headless: z.boolean().default(true),
  device: z.string().default('chromium-desktop'),
  record: z.boolean().default(true),
  /** Pause between actions, so a headed run is watchable rather than a blur. */
  slowMoMs: z.number().default(300),
  /**
   * Where the page under test is allowed to send traffic. Omit it and there is
   * no interception at all. Set it when the build has its backend compiled in
   * and you need production to be unreachable rather than merely unused —
   * see NetworkPolicy in drivers/web.ts.
   */
  network: z
    .object({
      rewrite: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
      allow: z.array(z.string()).default([]),
      fallback: z.enum(['block', 'allow']).default('block'),
    })
    .optional(),
});

/**
 * `hybrid` marks a Capacitor/Cordova/Ionic app. Its UI is a web page inside a
 * WebView, so native locators match nothing and the driver has to switch
 * context and resolve against the DOM instead. See drivers/native.ts.
 */
const Android = z.object({
  deviceName: z.string().default('Android Device'),
  app: z.string().optional(),
  appPackage: z.string().optional(),
  appActivity: z.string().optional(),
  hybrid: z.boolean().default(false),
  /**
   * How much state a scenario inherits from the one before it.
   *
   * `restart` force-stops the app between scenarios so its process — and with
   * it a WebView's whole DOM — is rebuilt, while cookies, storage and granted
   * permissions survive. Without it, re-launching an already-running activity
   * only brings it to the foreground: a value typed in scenario 2 is still in
   * the field in scenario 6, and the run order silently becomes an input.
   *
   * `none` restores the old behaviour for a suite that deliberately chains
   * scenarios, or when force-stop upsets a particular app.
   */
  isolation: z.enum(['restart', 'none']).default('restart'),
});

const Ios = z.object({
  deviceName: z.string().default('iPhone'),
  app: z.string().optional(),
  bundleId: z.string().optional(),
  hybrid: z.boolean().default(false),
});

const Paths = z.object({
  registry: z.string().default('registry/elements.json'),
  features: z.string().default('features'),
  artifacts: z.string().default('artifacts'),
  reports: z.string().default('reports'),
  /**
   * One self-contained directory per run. `reports` now holds only the
   * `latest-<platform>` pointers into this tree.
   */
  runs: z.string().default('runs'),
  flakeDb: z.string().default('registry/flake.json'),
  docs: z.string().default('docs'),
});

/**
 * Every ARN and path defaults to empty rather than being required: the UI has to
 * be able to save a half-filled farm block while you are still picking a device
 * pool. What is actually mandatory is checked at schedule time, where the error
 * can name the one missing field.
 */
const Farm = z
  .object({
    region: z.string().default('us-west-2'),
    projectArn: z.string().default(''),
    devicePoolArn: z.string().default(''),
    platform: z.enum(['android', 'ios']).default('android'),
    appPath: z.string().default(''),
    testPackagePath: z.string().default('build/testpilot-appium.zip'),
    testSpecPath: z.string().default('farm/testspec.yml'),
    runName: z.string().default(''),
    /** Per-job cap. Device Farm bills metered minutes, so this is a cost control. */
    jobTimeoutMinutes: z.number().default(30),
    /** Video is what makes a flaky native failure diagnosable at all. */
    videoCapture: z.boolean().default(true),
    /** How long to wait for the whole run before giving up. */
    timeoutMs: z.number().default(60 * 60_000),
    /**
     * Environment variables exported into the `test` phase of the generated
     * testspec — API endpoints, feature flags, anything the app under test needs.
     * Secrets do not belong here; the file is uploaded to AWS in plain text.
     */
    env: z.record(z.string()).default({}),
    /**
     * Copy test-account passwords from the local secrets file into the
     * generated testspec so `{{account.*.password}}` resolves on the device.
     *
     * Off by default and it should stay that way unless someone decides
     * otherwise: the testspec is uploaded to S3 in plain text and kept with the
     * run history, so anyone with access to the AWS account can read it. Rotate
     * the password afterwards.
     */
    sendSecrets: z.boolean().default(false),
  })
  .default({});

export const ConfigSchema = z.object({
  web: Web,
  android: Android.default({}),
  ios: Ios.default({}),
  paths: Paths.default({}),
  resolve: z
    .object({
      timeoutMs: z.number().default(10_000),
      pollMs: z.number().default(250),
      verifyHealedMatch: z.boolean().default(true),
    })
    .default({}),
  executor: z
    .object({
      retries: z.number().default(1),
      /** Read each field back after typing; see ExecutorOptions.verifyInput. */
      verifyInput: z.boolean().default(true),
    })
    .default({}),
  /**
   * What to keep once the suite has been run a few hundred times. Failures are
   * the evidence you came for; passes are a baseline and a handful is plenty.
   */
  retention: z
    .object({
      keepFailedDays: z.number().default(30),
      keepPassedPerPlatform: z.number().default(3),
    })
    .default({}),
  flake: z
    .object({
      window: z.number().default(30),
      minRuns: z.number().default(5),
      quarantineAt: z.number().default(0.15),
      brokenAt: z.number().default(0.95),
    })
    .default({}),
  /** Confluence / Figma links the spec generator reads. */
  sources: z.array(z.string()).default([]),
  /** Name of the feature being generated; becomes `features/<name>.feature`. */
  targetFeature: z.string().default(''),
  /**
   * Test accounts available to generated scenarios. Passwords are NOT here —
   * they live in the gitignored secrets file (see core/secrets.ts) and are
   * substituted into steps at run time as `{{account.<label>.password}}`.
   */
  accounts: z
    .array(z.object({ label: z.string(), username: z.string().default('') }))
    .default([]),
  /**
   * The MCP server that can read those links. Without it, generation falls back
   * to documents exported into `paths.docs`.
   */
  mcp: z
    .object({
      transport: z.enum(['stdio', 'http']).default('stdio'),
      command: z.string().optional(),
      args: z.array(z.string()).default([]),
      env: z.record(z.string()).default({}),
      cwd: z.string().optional(),
      url: z.string().optional(),
      headers: z.record(z.string()).default({}),
      tools: z
        .object({ confluencePage: z.string().default(''), figmaFile: z.string().default('') })
        .default({}),
    })
    .optional(),
  llm: z
    .object({
      /** "auto" lets the server pick the current default rather than pinning one. */
      model: z.string().default('auto'),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
      /** Free-text guidance appended to the generation prompt. */
      note: z.string().default(''),
    })
    .default({}),
  farm: Farm,
});

export type TestPilotConfig = z.infer<typeof ConfigSchema>;

/** The model used when the config says "auto". */
export const DEFAULT_LLM_MODEL = 'claude-opus-5';

/**
 * "auto" is the default the UI shows, so nobody has to pin a model id to get
 * started. Resolving it in one place keeps the CLI and the UI in agreement.
 */
export function resolveModel(model: string): string {
  return !model || model === 'auto' ? DEFAULT_LLM_MODEL : model;
}

export async function loadConfig(file = 'testpilot.config.json'): Promise<TestPilotConfig> {
  const abs = path.resolve(file);
  if (!existsSync(abs)) {
    throw new Error(`No config at ${abs}. Copy testpilot.config.example.json and edit it.`);
  }
  const parsed = ConfigSchema.safeParse(JSON.parse(await readFile(abs, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${abs} is invalid:\n${parsed.error.issues.map(fmt).join('\n')}`);
  }
  return parsed.data;
}

/**
 * The UI writes the same file the CLI reads, so anything configured in the
 * browser is reproducible from a terminal and reviewable in a diff.
 */
export async function saveConfig(
  cfg: TestPilotConfig,
  file = 'testpilot.config.json',
): Promise<void> {
  const parsed = ConfigSchema.safeParse(cfg);
  if (!parsed.success) {
    throw new Error(`Refusing to save an invalid config:\n${parsed.error.issues.map(fmt).join('\n')}`);
  }
  await writeFile(path.resolve(file), JSON.stringify(parsed.data, null, 2) + '\n', 'utf8');
}

function fmt(i: z.ZodIssue): string {
  return `  - ${i.path.join('.') || '(root)'}: ${i.message}`;
}
