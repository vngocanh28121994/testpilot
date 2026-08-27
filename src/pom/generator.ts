/**
 * Deterministic POM code generator.
 *
 * Reads parsed FeatureSpec[] + ElementRegistry and emits:
 *   generated/pages/{ScreenName}Page.ts  — one typed Page Object per screen
 *   generated/tests/{feature-slug}.spec.ts — one spec per feature file
 *   generated/support/driver.ts           — platform setup scaffold (written once)
 *
 * No LLM call is needed: all information required to generate the code already
 * exists in the parsed feature intents and element registry. The "AI" is the
 * existing vocabulary binding that turns Gherkin into typed Intent objects.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FeatureSpec, Intent, Platform } from '../core/types.js';
import type { ElementDef, ElementRegistry } from '../core/types.js';
import { isOverflowRowAction } from '../core/contextual.js';

export interface PomGeneratorOptions {
  /** Root output directory. Default: `generated` relative to cwd. */
  outputDir?: string;
  /** Relative path to TestPilot src root from the output dir. Default: `../../src`. */
  srcRelative?: string;
  /** Relative path to registry from the output dir. Default: `../../registry/elements.json`. */
  registryRelative?: string;
  /** Target platform embedded in generated driver scaffold. Default: `web`. */
  platform?: Platform;
  /** If true, overwrite existing driver.ts scaffold. Default: false. */
  overwriteDriver?: boolean;
}

export interface PomOutput {
  pages: Record<string, string>;
  specs: Record<string, string>;
  driver: string;
  /** Ambiguous label bindings the caller should show whoever triggered this. */
  warnings?: string[];
  changes: {
    pagesCreated: string[];
    pageMethodsAdded: Record<string, string[]>;
    specsWritten: string[];
    preserved: string[];
    driverWritten: boolean;
    /**
     * Set when the preserved scaffold names a different platform than this
     * generation. The scaffold is written once and never overwritten, so it
     * silently kept saying `web` long after every run had moved to Android —
     * and the generated tests, read at face value, opened a browser.
     */
    driverPlatformStale?: { existing: string; current: Platform };
  };
}

/** (elementId, intentKind) pairs collected from all scenarios. */
interface UsedMethod {
  elementId: string;
  kind: Intent['kind'];
  targetElementId?: string;
}

export async function generatePom(
  features: FeatureSpec[],
  registry: ElementRegistry,
  opts: PomGeneratorOptions = {},
): Promise<PomOutput> {
  const outputDir = opts.outputDir ?? 'generated';
  const srcRel = opts.srcRelative ?? '../../src';
  const registryRel = opts.registryRelative ?? '../../registry/elements.json';
  const platform: Platform = opts.platform ?? 'web';

  // Collect all (elementId, intentKind) used across all features
  const methodsUsed = collectMethods(features, registry);

  // Group by screen
  const byScreen = new Map<string, UsedMethod[]>();
  for (const m of methodsUsed) {
    const screenId = registry.elements[m.elementId]?.screen;
    if (!screenId) continue;
    const list = byScreen.get(screenId) ?? [];
    list.push(m);
    byScreen.set(screenId, list);
  }

  // Deduplicate within each screen (same elementId+kind → one method)
  for (const [screen, list] of byScreen) {
    const seen = new Set<string>();
    byScreen.set(
      screen,
      list.filter((m) => {
        const key = `${m.elementId}:${m.kind}:${m.targetElementId ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    );
  }

  const pages: Record<string, string> = {};
  const specs: Record<string, string> = {};
  const changes: PomOutput['changes'] = {
    pagesCreated: [],
    pageMethodsAdded: {},
    specsWritten: [],
    preserved: [],
    driverWritten: false,
  };

  // Generate Page Objects
  for (const [screenId, methods] of byScreen) {
    const className = screenClassName(screenId);
    const fileName = `${className}.ts`;
    pages[fileName] = renderPageObject(className, screenId, methods, registry, srcRel);
  }

  // Generate test specs
  for (const feature of features) {
    const slug = featureSlug(feature);
    const fileName = `${slug}.spec.ts`;
    specs[fileName] = renderSpec(feature, registry, byScreen, srcRel);
  }

  // Driver scaffold
  const driver = renderDriverScaffold(platform, srcRel, registryRel);

  // Write files
  const pagesDir = path.join(outputDir, 'pages');
  const specsDir = path.join(outputDir, 'tests');
  const supportDir = path.join(outputDir, 'support');
  await mkdir(pagesDir, { recursive: true });
  await mkdir(specsDir, { recursive: true });
  await mkdir(supportDir, { recursive: true });

  for (const [name, code] of Object.entries(pages)) {
    const file = path.join(pagesDir, name);
    const existing = await readOptional(file);
    if (existing === undefined) {
      await writeFile(file, code, 'utf8');
      changes.pagesCreated.push(name);
      continue;
    }
    const screenId = [...byScreen.keys()].find((id) => `${screenClassName(id)}.ts` === name)!;
    const methods = byScreen.get(screenId) ?? [];
    const merged = mergePageObject(existing, methods, registry);
    pages[name] = merged.code;
    if (merged.added.length > 0) {
      await writeFile(file, merged.code, 'utf8');
      changes.pageMethodsAdded[name] = merged.added;
    } else {
      changes.preserved.push(name);
    }
  }
  for (const [name, code] of Object.entries(specs)) {
    const file = path.join(specsDir, name);
    const existing = await readOptional(file);
    // Specs are projections of approved feature files. Only files carrying our
    // managed signature (or the unmistakable legacy template) are regenerated;
    // an arbitrary user-authored spec is never overwritten.
    if (existing === undefined || isManagedSpec(existing) || isLegacyGeneratedSpec(existing)) {
      await writeFile(file, code, 'utf8');
      changes.specsWritten.push(name);
    } else {
      specs[name] = existing;
      changes.preserved.push(name);
    }
  }

  const driverPath = path.join(supportDir, 'driver.ts');
  const existingDriver = await readOptional(driverPath);
  if (opts.overwriteDriver || existingDriver === undefined || isLegacyDriverScaffold(existingDriver)) {
    await writeFile(driverPath, driver, 'utf8');
    changes.driverWritten = true;
  } else {
    changes.preserved.push('support/driver.ts');
    const named = /defaultPlatform:\s*'([a-z]+)'/.exec(existingDriver)?.[1];
    if (named && named !== platform) {
      changes.driverPlatformStale = { existing: named, current: platform };
    }
  }

  return { pages, specs, driver, changes };
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

function collectMethods(features: FeatureSpec[], registry: ElementRegistry): UsedMethod[] {
  const methods: UsedMethod[] = [];
  for (const feature of features) {
    const allSteps = [
      ...feature.background,
      ...feature.scenarios.flatMap((s) => s.steps),
    ];
    for (const step of allSteps) {
      const intent = step.intent;
      if ('element' in intent && intent.element) {
        methods.push({
          elementId: intent.element,
          kind: effectiveMethodKind(intent, registry),
        });
      } else if (intent.kind === 'dragDrop') {
        methods.push({
          elementId: intent.source,
          targetElementId: intent.target,
          kind: intent.kind,
        });
      }
    }
  }
  return methods;
}

function effectiveMethodKind(intent: Intent, registry: ElementRegistry): Intent['kind'] {
  if (
    intent.kind === 'input' &&
    registry.elements[intent.element]?.controlType === 'date'
  ) return 'selectDate';
  return intent.kind;
}

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

function screenClassName(screenId: string): string {
  return capitalize(screenId) + 'Page';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function elementSuffix(elementId: string): string {
  const dot = elementId.lastIndexOf('.');
  const name = dot >= 0 ? elementId.slice(dot + 1) : elementId;
  return capitalize(name);
}

function methodName(
  kind: Intent['kind'],
  suffix: string,
  element?: ElementDef,
  targetSuffix?: string,
  targetElement?: ElementDef,
): string {
  if (kind === 'dragDrop') {
    const source = element?.template?.kind === 'text' ? 'Text' : suffix;
    const target = targetElement?.template?.kind === 'text' ? 'Text' : (targetSuffix ?? 'Target');
    return `drag${source}To${target}`;
  }
  if (kind === 'tap' && element?.template?.kind === 'rowAction') {
    return isOverflowRowAction(element.template.action) ? 'openRowMenu' : `tap${suffix}`;
  }
  if (element?.template?.kind === 'text') {
    switch (kind) {
      case 'tap': return 'tapText';
      case 'hover': return 'hoverText';
      case 'longPress': return 'longPressText';
      case 'input': return 'enterText';
      case 'selectDate': return 'selectDateText';
      case 'clear': return 'clearText';
      case 'select': return 'selectText';
      case 'scrollTo': return 'scrollToText';
      case 'waitFor': return 'waitForText';
      case 'focusRegion': return 'focusTextRegion';
      case 'assertVisible': return 'assertTextVisible';
      case 'assertNotVisible': return 'assertTextNotVisible';
      case 'assertText': return 'assertTextContent';
      case 'assertNumber': return 'assertTextNumber';
      case 'assertCollection': return 'assertTextCollection';
      default: return `do${suffix}`;
    }
  }
  switch (kind) {
    case 'tap':
      return `tap${suffix}`;
    case 'hover':
      return `hover${suffix}`;
    case 'input':
      return `enter${suffix}`;
    case 'selectDate':
      return `selectDate${suffix}`;
    case 'clear':
      return `clear${suffix}`;
    case 'select':
      return `select${suffix}`;
    case 'waitFor':
      return `waitFor${suffix}`;
    case 'focusRegion':
      return `focus${suffix}Region`;
    case 'assertVisible':
      return `assert${suffix}Visible`;
    case 'assertNotVisible':
      return `assert${suffix}NotVisible`;
    case 'assertText':
      return `assert${suffix}Text`;
    case 'assertNumber':
      return `assert${suffix}Number`;
    case 'assertCollection':
      return `assert${suffix}Collection`;
    case 'longPress':
      return `longPress${suffix}`;
    case 'scrollTo':
      return `scrollTo${suffix}`;
    default:
      return `do${suffix}`;
  }
}

function methodSignature(
  kind: Intent['kind'],
  suffix: string,
  element?: ElementDef,
  targetSuffix?: string,
  targetElement?: ElementDef,
): string {
  const name = methodName(kind, suffix, element, targetSuffix, targetElement);
  if (kind === 'dragDrop') {
    const args: string[] = [];
    if (element?.template?.kind === 'text') args.push('sourceText: string');
    if (targetElement?.template?.kind === 'text') args.push('targetText: string');
    return `${name}(${args.join(', ')})`;
  }
  if (kind === 'tap' && element?.template?.kind === 'rowAction') {
    return `${name}(rowText: string)`;
  }
  if (element?.template?.kind === 'text') {
    if (kind === 'input') return `${name}(locatorText: string, value: string)`;
    if (kind === 'selectDate') return `${name}(locatorText: string, date: string)`;
    if (kind === 'select') return `${name}(locatorText: string, option: string)`;
    if (kind === 'assertText') return `${name}(locatorText: string, expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains')`;
    if (kind === 'assertNumber') {
      return `${name}(locatorText: string, operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost', expected: number)`;
    }
    if (kind === 'assertCollection') return `${name}(locatorText: string, check: Parameters<BasePage['assertCollection']>[1])`;
    return `${name}(text: string)`;
  }
  switch (kind) {
    case 'input':
      return `${name}(text: string)`;
    case 'selectDate':
      return `${name}(date: string)`;
    case 'select':
      return `${name}(option: string)`;
    case 'assertText':
      return `${name}(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains')`;
    case 'assertNumber':
      return `${name}(operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast' | 'atMost', expected: number)`;
    case 'assertCollection':
      return `${name}(check: Parameters<BasePage['assertCollection']>[1])`;
    default:
      return `${name}()`;
  }
}

function methodBody(
  kind: Intent['kind'],
  elementId: string,
  element?: ElementDef,
  targetElementId?: string,
  targetElement?: ElementDef,
): string {
  const q = (s: string) => `'${s}'`;
  if (kind === 'dragDrop' && targetElementId) {
    const sourceParams = element?.template?.kind === 'text' ? '{ text: sourceText }' : 'undefined';
    const targetParams = targetElement?.template?.kind === 'text' ? '{ text: targetText }' : 'undefined';
    return `await this.page.dragDrop(${q(elementId)}, ${q(targetElementId)}, ${sourceParams}, ${targetParams});`;
  }
  if (kind === 'tap' && element?.template?.kind === 'rowAction') {
    return `await this.page.tapRowAction(${q(elementId)}, rowText, ${q(element.template.action)});`;
  }
  if (element?.template?.kind === 'text') {
    const params = `{ text: ${kind === 'input' || kind === 'selectDate' || kind === 'select' || kind === 'assertText' || kind === 'assertNumber' || kind === 'assertCollection' ? 'locatorText' : 'text'} }`;
    switch (kind) {
      case 'tap': return `await this.page.tap(${q(elementId)}, ${params});`;
      case 'hover': return `await this.page.hover(${q(elementId)}, ${params});`;
      case 'longPress': return `await this.page.longPress(${q(elementId)}, 1000, ${params});`;
      case 'input': return `await this.page.input(${q(elementId)}, value, ${params});`;
      case 'selectDate': return `await this.page.selectDate(${q(elementId)}, date, ${params});`;
      case 'clear': return `await this.page.clear(${q(elementId)}, ${params});`;
      case 'select': return `await this.page.select(${q(elementId)}, option, ${params});`;
      case 'scrollTo': return `await this.page.scrollTo(${q(elementId)}, ${params});`;
      case 'waitFor': return `await this.page.waitFor(${q(elementId)}, undefined, ${params});`;
      case 'focusRegion': return `await this.page.focusRegion(${q(elementId)}, ${params});`;
      case 'assertVisible': return `await this.page.assertVisible(${q(elementId)}, ${params});`;
      case 'assertNotVisible': return `await this.page.assertNotVisible(${q(elementId)}, ${params});`;
      // The mode must come from the step, not be assumed: emitting 'contains'
      // for a "does not show" step inverts the assertion silently.
      case 'assertText':
        return `await this.page.assertText(${q(elementId)}, expected, mode, ${params});`;
      case 'assertNumber': return `await this.page.assertNumber(${q(elementId)}, operator, expected, ${params});`;
      case 'assertCollection': return `await this.page.assertCollection(${q(elementId)}, check, ${params});`;
      default: return `await this.page.tap(${q(elementId)}, ${params});`;
    }
  }
  switch (kind) {
    case 'tap':
      return `await this.page.tap(${q(elementId)});`;
    case 'hover':
      return `await this.page.hover(${q(elementId)});`;
    case 'input':
      return `await this.page.input(${q(elementId)}, text);`;
    case 'selectDate':
      return `await this.page.selectDate(${q(elementId)}, date);`;
    case 'clear':
      return `await this.page.clear(${q(elementId)});`;
    case 'select':
      return `await this.page.select(${q(elementId)}, option);`;
    case 'waitFor':
      return `await this.page.waitFor(${q(elementId)});`;
    case 'focusRegion':
      return `await this.page.focusRegion(${q(elementId)});`;
    case 'assertVisible':
      return `await this.page.assertVisible(${q(elementId)});`;
    case 'assertNotVisible':
      return `await this.page.assertNotVisible(${q(elementId)});`;
    case 'assertText':
      return `await this.page.assertText(${q(elementId)}, expected, mode);`;
    case 'assertNumber':
      return `await this.page.assertNumber(${q(elementId)}, operator, expected);`;
    case 'assertCollection':
      return `await this.page.assertCollection(${q(elementId)}, check);`;
    case 'longPress':
      return `await this.page.longPress(${q(elementId)});`;
    case 'scrollTo':
      return `await this.page.scrollTo(${q(elementId)});`;
    default:
      return `await this.page.tap(${q(elementId)});`;
  }
}

function featureSlug(feature: FeatureSpec): string {
  return path.basename(feature.uri, path.extname(feature.uri));
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderPageObject(
  className: string,
  screenId: string,
  methods: UsedMethod[],
  registry: ElementRegistry,
  srcRel: string,
): string {
  const screenDef = registry.screens[screenId];
  const screenTitle = screenDef?.title ?? screenId;

  const methodLines = methods
    .map((m) => renderPageMethod(m, registry))
    .join('\n\n');

  return `import { BasePage } from '${srcRel}/pom/BasePage.js';

/** ${screenTitle} */
export class ${className} {
  constructor(private readonly page: BasePage) {}

${methodLines}
}
`;
}

function renderPageMethod(method: UsedMethod, registry: ElementRegistry): string {
  const suffix = elementSuffix(method.elementId);
  const element = registry.elements[method.elementId];
  const target = method.targetElementId ? registry.elements[method.targetElementId] : undefined;
  const targetSuffix = method.targetElementId ? elementSuffix(method.targetElementId) : undefined;
  const sig = methodSignature(method.kind, suffix, element, targetSuffix, target);
  const body = methodBody(method.kind, method.elementId, element, method.targetElementId, target);
  const label = element?.label ?? method.elementId;
  const targetMarker = method.targetElementId ? ` target=${method.targetElementId}` : '';
  return (
    `  /** ${label}\n` +
    `   * @testpilot-element ${method.elementId} action=${method.kind}${targetMarker}\n` +
    `   */\n` +
    `  async ${sig}: Promise<void> {\n    ${body}\n  }`
  );
}

/**
 * Append only methods that do not already exist. Existing imports, methods,
 * comments and hand-written helpers remain byte-for-byte unchanged.
 */
function mergePageObject(
  existing: string,
  methods: UsedMethod[],
  registry: ElementRegistry,
): { code: string; added: string[] } {
  let code = existing;
  const renamed: string[] = [];
  const missing = methods.filter((method) => {
    const marker = `@testpilot-element ${method.elementId} action=${method.kind}` +
      (method.targetElementId ? ` target=${method.targetElementId}` : '');
    const name = methodName(
      method.kind,
      elementSuffix(method.elementId),
      registry.elements[method.elementId],
      method.targetElementId ? elementSuffix(method.targetElementId) : undefined,
      method.targetElementId ? registry.elements[method.targetElementId] : undefined,
    );
    if (code.includes(marker)) {
      // The pair is already generated — but possibly by an older generator,
      // under a name this one no longer emits. The spec always calls the
      // current name, so a stale name is not a harmless cosmetic difference:
      // the generated project stops compiling, and nothing here noticed because
      // the marker matched. Seen in the wild as `doCacQuyCoTheBanQuanTam` for
      // an action=focusRegion method whose body still called tap().
      const current = managedMethodName(code, marker);
      if (current && current !== name) {
        const replaced = replaceManagedMethod(code, marker, renderPageMethod(method, registry));
        if (replaced) {
          code = replaced;
          renamed.push(name);
        }
      }
      return false;
    }
    return !new RegExp(`\\b(?:async\\s+)?${escapeRegExp(name)}\\s*\\(`).test(code);
  });
  if (missing.length === 0) return { code, added: renamed };
  const existingCode = code;

  const close = findPageClassClosingBrace(existingCode);
  if (close < 0) {
    // A customised file that is no longer a normal class is protected rather
    // than "repaired" by destructive generation.
    return { code, added: renamed };
  }
  const addition = missing.map((m) => renderPageMethod(m, registry)).join('\n\n');
  const head = existingCode.slice(0, close).replace(/\s*$/, '');
  const tail = existingCode.slice(close);
  return {
    code: `${head}\n\n${addition}\n${tail.endsWith('\n') ? tail : `${tail}\n`}`,
    added: [...renamed, ...missing.map((m) => methodName(
      m.kind,
      elementSuffix(m.elementId),
      registry.elements[m.elementId],
      m.targetElementId ? elementSuffix(m.targetElementId) : undefined,
      m.targetElementId ? registry.elements[m.targetElementId] : undefined,
    ))],
  };
}

/** The method name directly beneath a `@testpilot-element` marker, if any. */
function managedMethodName(source: string, marker: string): string | undefined {
  const at = source.indexOf(marker);
  if (at < 0) return undefined;
  return /\basync\s+([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(at))?.[1];
}

/**
 * Swap a whole generated method — doc comment, signature and body — for a
 * freshly rendered one.
 *
 * Replaces rather than renames because a method emitted under an old name was
 * emitted by an old generator, body included, and that body can be wrong in its
 * own right. Only methods carrying the marker are touched, so anything a person
 * wrote by hand is out of reach; a method whose name is already current is left
 * exactly as it is, hand-edited body and all.
 */
function replaceManagedMethod(
  source: string,
  marker: string,
  replacement: string,
): string | undefined {
  const at = source.indexOf(marker);
  if (at < 0) return undefined;
  const commentStart = source.lastIndexOf('/**', at);
  const open = source.indexOf('{', source.indexOf('(', at));
  if (commentStart < 0 || open < 0) return undefined;
  const end = matchingBrace(source, open);
  if (end < 0) return undefined;
  const lineStart = source.lastIndexOf('\n', commentStart) + 1;
  return source.slice(0, lineStart) + replacement + source.slice(end + 1);
}

/** Index of the `}` closing the `{` at `open`, or -1. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Find the generated Page Object class boundary without assuming it is EOF. */
function findPageClassClosingBrace(source: string): number {
  const classMatch = /export\s+class\s+[A-Za-z_$][\w$]*\s*\{/.exec(source);
  if (!classMatch) return -1;
  const open = source.indexOf('{', classMatch.index);
  let depth = 0;
  let quote: "'" | '"' | '`' | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < source.length; i++) {
    const char = source[i]!;
    const next = source[i + 1];
    const prev = source[i - 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (char === quote && prev !== '\\') quote = undefined;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return i;
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

function isManagedSpec(source: string): boolean {
  return source.startsWith('// @testpilot-managed');
}

function isLegacyGeneratedSpec(source: string): boolean {
  return (
    source.startsWith("import { describe, test } from 'node:test';") &&
    source.includes("import { createPageContext } from '../support/driver.js';") &&
    source.includes('// app already launched via ctx.launch()')
  );
}

function isLegacyDriverScaffold(source: string): boolean {
  return (
    source.includes("const { WebDriver } = await import(") &&
    source.includes("const { NativeDriver } = await import(") &&
    source.includes('Unsupported platform:')
  );
}

function renderSpec(
  feature: FeatureSpec,
  registry: ElementRegistry,
  byScreen: Map<string, UsedMethod[]>,
  srcRel: string,
): string {
  // Collect screen classes used in this feature
  const screensUsed = new Set<string>();
  const allSteps = [
    ...feature.background,
    ...feature.scenarios.flatMap((s) => s.steps),
  ];
  for (const step of allSteps) {
    const intent = step.intent;
    if ('element' in intent && intent.element) {
      const screenId = registry.elements[intent.element]?.screen;
      if (screenId) screensUsed.add(screenId);
    }
  }

  const importLines = [...screensUsed]
    .map((s) => {
      const cls = screenClassName(s);
      return `import { ${cls} } from '../pages/${cls}.js';`;
    })
    .join('\n');

  const pageVarDecls = [...screensUsed]
    .map((s) => {
      const cls = screenClassName(s);
      const varName = s + 'Page';
      return `      const ${varName} = new ${cls}(ctx);`;
    })
    .join('\n');

  const scenarioBlocks = feature.scenarios
    .map((scenario) => {
      const allScenarioSteps = [...feature.background, ...scenario.steps];
      const stepLines = allScenarioSteps
        .map((step) => renderStepCall(step.intent, registry, step.text))
        .filter(Boolean)
        .join('\n      ');
      return (
        `  test(${JSON.stringify(scenario.name)}, async () => {\n` +
        `    const ctx = await createPageContext();\n` +
        `    try {\n` +
        pageVarDecls +
        `\n      await ctx.launch();\n      ${stepLines}\n` +
        `    } finally {\n` +
        `      await ctx.close();\n` +
        `    }\n` +
        `  });`
      );
    })
    .join('\n\n');

  return `// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
${importLines}

describe(${JSON.stringify(feature.name)}, () => {
${scenarioBlocks}
});
`;
}

function renderStepCall(intent: Intent, registry: ElementRegistry, originalText: string): string {
  if (intent.kind === 'launch') return '// app already launched via ctx.launch()';

  if (intent.kind === 'ensureLoggedIn') {
    return `await ctx.ensureLoggedIn(${JSON.stringify(intent.account)});`;
  }

  if (intent.kind === 'openFeatureFromSearch') {
    return `await ctx.openFeatureFromSearch(${JSON.stringify(intent.query)});`;
  }

  if (intent.kind === 'scroll') {
    return `await ctx.scroll(${JSON.stringify(intent.direction)});`;
  }

  if (intent.kind === 'dragDrop') {
    const source = registry.elements[intent.source];
    const target = registry.elements[intent.target];
    if (!source || !target) return `// [unknown drag element] ${originalText}`;
    const varName = source.screen + 'Page';
    const name = methodName(
      intent.kind,
      elementSuffix(intent.source),
      source,
      elementSuffix(intent.target),
      target,
    );
    const args: string[] = [];
    if (source.template?.kind === 'text') {
      const value = intent.sourceLocatorParams?.text;
      if (!value) return `// [missing source text] ${originalText}`;
      args.push(JSON.stringify(value));
    }
    if (target.template?.kind === 'text') {
      const value = intent.targetLocatorParams?.text;
      if (!value) return `// [missing target text] ${originalText}`;
      args.push(JSON.stringify(value));
    }
    return `await ${varName}.${name}(${args.join(', ')});`;
  }

  if (!('element' in intent) || !intent.element) {
    if (intent.kind === 'screenshot') {
      return `await ctx.screenshot(${JSON.stringify(intent.name)});`;
    }
    return `// ${originalText}`;
  }

  const elementId = intent.element;
  const screenId = registry.elements[elementId]?.screen;
  if (!screenId) return `// [unknown element] ${originalText}`;

  const varName = screenId + 'Page';
  const suffix = elementSuffix(elementId);
  const element = registry.elements[elementId];
  const effectiveKind = effectiveMethodKind(intent, registry);
  const name = methodName(effectiveKind, suffix, element);

  if (intent.kind === 'tap' && element?.template?.kind === 'rowAction') {
    const rowText = intent.rowAction?.rowText;
    if (!rowText) return `// [missing row context] ${originalText}`;
    return `await ${varName}.${name}(${JSON.stringify(rowText)});`;
  }

  if (element?.template?.kind === 'text') {
    const locatorText = intent.locatorParams?.text;
    if (!locatorText) return `// [missing text parameter] ${originalText}`;
    const locatorArg = JSON.stringify(locatorText);
    if (effectiveKind === 'input' && intent.kind === 'input') {
      return `await ${varName}.${name}(${locatorArg}, ${expandPlaceholder(intent.text)});`;
    }
    if (effectiveKind === 'selectDate' && (intent.kind === 'selectDate' || intent.kind === 'input')) {
      const date = intent.kind === 'selectDate' ? intent.date : intent.text;
      return `await ${varName}.${name}(${locatorArg}, ${expandPlaceholder(date)});`;
    }
    if (intent.kind === 'select') {
      return `await ${varName}.${name}(${locatorArg}, ${JSON.stringify(intent.option)});`;
    }
    if (intent.kind === 'assertText') {
      return `await ${varName}.${name}(${locatorArg}, ${expandPlaceholder(intent.text)}` +
        `${assertTextMode(intent.mode)});`;
    }
    if (intent.kind === 'assertNumber') {
      return `await ${varName}.${name}(${locatorArg}, ${JSON.stringify(intent.operator)}, ${intent.value});`;
    }
    if (intent.kind === 'assertCollection') {
      return `await ${varName}.${name}(${locatorArg}, ${JSON.stringify(intent.check)});`;
    }
    return `await ${varName}.${name}(${locatorArg});`;
  }

  if (effectiveKind === 'input' && intent.kind === 'input') {
    const text = intent.text ?? '';
    const textExpr = expandPlaceholder(text);
    return `await ${varName}.${name}(${textExpr});`;
  }

  if (effectiveKind === 'selectDate' && (intent.kind === 'selectDate' || intent.kind === 'input')) {
    const date = intent.kind === 'selectDate' ? intent.date : intent.text;
    return `await ${varName}.${name}(${expandPlaceholder(date)});`;
  }

  if (intent.kind === 'select') {
    return `await ${varName}.${name}(${JSON.stringify(intent.option)});`;
  }

  if (intent.kind === 'assertText') {
    return `await ${varName}.${name}(${expandPlaceholder(intent.text)}${assertTextMode(intent.mode)});`;
  }

  if (intent.kind === 'assertNumber') {
    return `await ${varName}.${name}(${JSON.stringify(intent.operator)}, ${intent.value});`;
  }

  if (intent.kind === 'assertCollection') {
    return `await ${varName}.${name}(${JSON.stringify(intent.check)});`;
  }

  return `await ${varName}.${name}();`;
}

/**
 * Convert `{{account.tcbs.username}}` → `ctx.variable('account.tcbs.username')`.
 * Literal strings pass through as JSON-stringified values.
 *
 * It used to emit `process.env['TCBS_USERNAME'] ?? ''`, which invented a second
 * source of credentials that nothing else in the project fills. Running a
 * generated spec therefore typed an empty string into the login form and failed
 * for a reason the code did not show. The context reads the same accounts the
 * runner does, so the two paths cannot disagree about who is logging in.
 */
function expandPlaceholder(text: string): string {
  const match = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(text.trim());
  if (!match) return JSON.stringify(text);
  return `ctx.variable(${JSON.stringify(match[1]!)})`;
}

function renderDriverScaffold(platform: Platform, srcRel: string, _registryRel: string): string {
  return `/**
 * Runtime bridge for generated POM tests.
 * It will NOT be overwritten by \`testpilot pom\` — edit it freely.
 *
 * The platform below is only a default: TESTPILOT_PLATFORM wins when set, so
 * one scaffold serves every platform without being edited.
 *
 *   TESTPILOT_PLATFORM=android TESTPILOT_DEVICE=sm-s918b \\
 *     node --import tsx/esm --test generated/tests/*.spec.ts
 *
 * TESTPILOT_DEVICE names an entry of <platform>.devices, and is required once
 * the config lists more than one — same rule as the runner's --device.
 *
 * Accounts come from the same place the runner reads them — testpilot.config.json
 * plus the gitignored secrets file — so no credential is needed in the environment.
 * TESTPILOT_ENV selects which environment's accounts and build apply.
 */

import { createPomPageContext } from '${srcRel}/pom/context.js';

export function createPageContext() {
  return createPomPageContext({ defaultPlatform: '${platform}' });
}
`;
}

/** The mode argument, omitted when it is the default the signature already has. */
function assertTextMode(mode: 'equals' | 'contains' | 'notContains' | undefined): string {
  return !mode || mode === 'contains' ? '' : `, '${mode}'`;
}
