/**
 * Where an element came from, and why that must only ever strengthen.
 *
 * The registry mixes two very different things: data somebody supplied on
 * purpose, and elements minted automatically the first time a scenario named an
 * unfamiliar label. They look identical in the file, which is how "never
 * resolved" came to read as "worthless" — while a locator library is loaded
 * before the scenarios that use it exist, so sitting unused is expected.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Registry } from '../registry.js';
import type { ElementDef } from '../types.js';

const fresh = () => Registry.load(`/dev/null/nonexistent-prov-${Math.random()}.json`);
const el = (over: Partial<ElementDef>): ElementDef => ({
  id: 'p.x', label: 'X', screen: 'p', candidates: {}, ...over,
});

describe('element provenance', () => {
  it('upgrades a byproduct once real data arrives', async () => {
    const registry = await fresh();
    registry.upsertElement(el({ provenance: 'byproduct' }));
    registry.upsertElement(el({
      provenance: 'imported',
      candidates: { web: [{ strategy: 'css', value: '.real', weight: 0.9, origin: 'authored' }] },
    }));
    assert.equal(registry.element('p.x').provenance, 'imported');
  });

  it('never downgrades supplied data back to a byproduct', async () => {
    const registry = await fresh();
    registry.upsertElement(el({ provenance: 'imported' }));
    // A regeneration touching the same element must not make it deletable.
    registry.upsertElement(el({ provenance: 'byproduct' }));
    assert.equal(registry.element('p.x').provenance, 'imported');
  });

  it('leaves an unknown provenance alone rather than assuming the worst', async () => {
    const registry = await fresh();
    registry.upsertElement(el({}));
    registry.upsertElement(el({ provenance: 'byproduct' }));
    assert.equal(
      registry.element('p.x').provenance, undefined,
      'không rõ nguồn gốc thì phải coi là có chủ đích, không phải rác',
    );
  });

  it('lets a person outrank everything', async () => {
    const registry = await fresh();
    registry.upsertElement(el({ provenance: 'generated' }));
    registry.upsertElement(el({ provenance: 'authored' }));
    registry.upsertElement(el({ provenance: 'imported' }));
    assert.equal(registry.element('p.x').provenance, 'authored');
  });
});
