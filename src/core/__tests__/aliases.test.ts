/**
 * One control, several names.
 *
 * A control acquires more than one Vietnamese phrasing as scenarios get
 * written — "Thêm mã" and "Nút thêm mã cổ phiếu" are the same ⊕ button. Without
 * aliases the second phrasing mints a fresh, empty element, so the proven
 * locators and the resolution history stay behind on the first name while the
 * step binds to a shell that has never resolved anything. That is not
 * hypothetical: the ⊕ button existed twice, once with five locators and 173
 * successful resolutions and once with an invented one and zero.
 *
 * The uniqueness rule is the other half. Duplicate *labels* are tolerated and
 * disambiguated by screen, but an alias is a deliberate claim that two names
 * mean one control; letting two controls share one would bind a step to the
 * wrong element and never fail.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Registry } from '../registry.js';
import { parseFeature } from '../../steps/binding.js';
import type { ElementDef, ElementRegistry } from '../types.js';

const el = (over: Partial<ElementDef>): ElementDef => ({
  id: 'p.x', label: 'X', screen: 'p', candidates: {}, ...over,
});

/** Registry.load is the only path that validates, so tests go through a file. */
async function loadWith(elements: ElementDef[]): Promise<Registry> {
  const dir = await mkdtemp(path.join(tmpdir(), 'alias-'));
  const file = path.join(dir, 'elements.json');
  const raw: ElementRegistry = {
    version: 1,
    screens: { p: { id: 'p', title: 'P' } },
    elements: Object.fromEntries(elements.map((e) => [e.id, e])),
  };
  await writeFile(file, JSON.stringify(raw), 'utf8');
  return Registry.load(file);
}

const feature = (step: string) => `Feature: F
  Scenario: S
    When ${step}
`;

describe('element aliases', () => {
  it('binds a step written with an alias to the element that owns it', async () => {
    const registry = await loadWith([
      el({
        id: 'p.addButton',
        label: 'Thêm mã',
        aliases: ['Nút thêm mã cổ phiếu'],
        candidates: { web: [{ strategy: 'css', value: '.add', weight: 0.9, origin: 'authored' }] },
      }),
    ]);

    const spec = parseFeature('f.feature', feature('I click "Nút thêm mã cổ phiếu"'), registry);
    const intent = spec.scenarios[0]!.steps[0]!.intent;
    assert.equal('element' in intent && intent.element, 'p.addButton');
  });

  it('the alias and the label reach the same locators, not a second empty twin', async () => {
    const registry = await loadWith([
      el({
        id: 'p.addButton',
        label: 'Thêm mã',
        aliases: ['Nút thêm mã cổ phiếu'],
        candidates: { web: [{ strategy: 'css', value: '.add', weight: 0.9, origin: 'authored' }] },
      }),
    ]);

    const viaLabel = parseFeature('f.feature', feature('I click "Thêm mã"'), registry);
    const viaAlias = parseFeature('f.feature', feature('I click "Nút thêm mã cổ phiếu"'), registry);
    const idOf = (spec: ReturnType<typeof parseFeature>) => {
      const intent = spec.scenarios[0]!.steps[0]!.intent;
      return 'element' in intent ? intent.element : undefined;
    };
    assert.equal(idOf(viaLabel), idOf(viaAlias));
    assert.equal(registry.candidates(idOf(viaAlias)!, 'web').length, 1);
  });

  it('refuses an alias that is already another element\'s label', async () => {
    await assert.rejects(
      () => loadWith([
        el({ id: 'p.a', label: 'Đặt lệnh' }),
        el({ id: 'p.b', label: 'Thêm mã', aliases: ['Đặt lệnh'] }),
      ]),
      /trùng với label của "p\.a"/,
    );
  });

  it('refuses the same alias declared on two elements', async () => {
    await assert.rejects(
      () => loadWith([
        el({ id: 'p.a', label: 'A', aliases: ['Nút chung'] }),
        el({ id: 'p.b', label: 'B', aliases: ['Nút chung'] }),
      ]),
      /được khai báo ở cả/,
    );
  });

  it('allows an element to alias its own label without complaint', async () => {
    const registry = await loadWith([
      el({ id: 'p.a', label: 'Thêm mã', aliases: ['Thêm mã'] }),
    ]);
    assert.equal(registry.element('p.a').label, 'Thêm mã');
  });

  it('keeps aliases a regeneration does not know about', async () => {
    const registry = await loadWith([
      el({ id: 'p.a', label: 'Thêm mã', aliases: ['Nút thêm mã cổ phiếu'] }),
    ]);
    // A regenerated spec carries only the label it knows; the human-taught name
    // must survive it, exactly as proven locators do.
    registry.upsertElement(el({ id: 'p.a', label: 'Thêm mã', aliases: ['Nút thêm'] }));
    assert.deepEqual(
      [...registry.element('p.a').aliases!].sort(),
      ['Nút thêm', 'Nút thêm mã cổ phiếu'],
    );
  });
});
