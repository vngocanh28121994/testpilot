/**
 * Compile / typecheck gate — item 37 (plan §60).
 *
 * Runs the static validation pipeline after code generation:
 *   typecheck → step-binding → (optional: lint, unit-tests)
 *
 * Nothing is submitted to AWS when any stage fails.
 * Stages run in order — later stages are skipped after any failure unless
 * `continueOnFailure` is set.
 */

import { spawn } from 'node:child_process';
import type { ValidationStage, ValidationSummary } from './AutomationTypes.js';
import { validateGherkin } from '../model/GherkinValidator.js';

export interface CompileGateOptions {
  /** Project root — where tsc / eslint are run from. */
  cwd?: string;
  /** Skip lint even if an eslint config is present (useful in CI pre-checks). */
  skipLint?: boolean;
  /** Skip unit-test stage (speeds up local iteration). */
  skipUnitTests?: boolean;
  /** When true, all stages run even after a failure. Default: false. */
  continueOnFailure?: boolean;
  /** Timeout per stage in milliseconds. Default: 60000 (1 min). */
  timeoutMs?: number;
}

export interface GherkinValidationInput {
  /** Raw Gherkin source string to validate. */
  source: string;
  uri?: string;
}

export class CompileGate {
  private readonly cwd: string;
  private readonly opts: Required<CompileGateOptions>;

  constructor(opts: CompileGateOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.opts = {
      cwd: this.cwd,
      skipLint: opts.skipLint ?? false,
      skipUnitTests: opts.skipUnitTests ?? true,
      continueOnFailure: opts.continueOnFailure ?? false,
      timeoutMs: opts.timeoutMs ?? 60_000,
    };
  }

  /**
   * Run the full validation pipeline for generated automation code.
   *
   * @param gherkinInput  - Optional Gherkin source to validate at the step-binding stage.
   */
  async run(gherkinInput?: GherkinValidationInput): Promise<ValidationSummary> {
    const stages: ValidationStage[] = [];
    let anyFailed = false;

    const runStage = async (
      name: ValidationStage['name'],
      fn: () => Promise<{ passed: boolean; output: string }>,
    ): Promise<boolean> => {
      if (anyFailed && !this.opts.continueOnFailure) {
        stages.push({ name, passed: false, output: 'skipped — prior stage failed', durationMs: 0 });
        return false;
      }
      const start = Date.now();
      const { passed, output } = await fn();
      stages.push({ name, passed, output, durationMs: Date.now() - start });
      if (!passed) anyFailed = true;
      return passed;
    };

    // ── Stage 1: Typecheck ────────────────────────────────────────────────────
    await runStage('typecheck', () =>
      this.runSubprocess('npx', ['tsc', '--noEmit', '-p', 'tsconfig.check.json']),
    );

    // ── Stage 2: Lint (optional) ──────────────────────────────────────────────
    if (!this.opts.skipLint) {
      await runStage('lint', () =>
        this.runSubprocess('npx', ['eslint', 'src/', '--max-warnings=0']),
      );
    }

    // ── Stage 3: Step binding / Gherkin validation ────────────────────────────
    await runStage('step-binding', async () => {
      if (!gherkinInput) {
        return { passed: true, output: 'no Gherkin source provided — skipped' };
      }
      const result = validateGherkin(gherkinInput.source, gherkinInput.uri ?? '<generated>');
      const output = result.issues
        .map((i) => `[${i.severity.toUpperCase()}] (${i.layer}) ${i.message}`)
        .join('\n') || 'no issues';
      return { passed: result.valid, output };
    });

    // ── Stage 4: Unit tests (optional) ───────────────────────────────────────
    if (!this.opts.skipUnitTests) {
      await runStage('unit-tests', () =>
        this.runSubprocess('node', [
          '--import', 'tsx/esm',
          '--test',
          'src/**/__tests__/**/*.test.ts',
        ]),
      );
    }

    const typecheckPassed = stages.find((s) => s.name === 'typecheck')?.passed ?? true;
    const lintPassed = stages.find((s) => s.name === 'lint')?.passed ?? true;
    const stepBindingPassed = stages.find((s) => s.name === 'step-binding')?.passed ?? true;
    const compilePassed = typecheckPassed; // compile ≈ typecheck in this project

    return {
      compilePassed,
      lintPassed,
      typecheckPassed,
      stepBindingPassed,
      stages,
      allPassed: !anyFailed,
    };
  }

  // ── subprocess runner ─────────────────────────────────────────────────────

  private runSubprocess(
    cmd: string,
    args: string[],
  ): Promise<{ passed: boolean; output: string }> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const proc = spawn(cmd, args, {
        cwd: this.cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (d: Buffer) => chunks.push(d));
      proc.stderr.on('data', (d: Buffer) => chunks.push(d));

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({ passed: false, output: `timed out after ${this.opts.timeoutMs}ms` });
      }, this.opts.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString('utf8').trim();
        resolve({ passed: code === 0, output: output || '(no output)' });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ passed: false, output: `spawn error: ${err.message}` });
      });
    });
  }
}
