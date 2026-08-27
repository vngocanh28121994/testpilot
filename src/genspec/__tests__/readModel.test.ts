/**
 * The generation stage must survive whatever the model writes.
 *
 * This is the step a user waits longest for: the document is fetched, read and
 * reasoned over, and only then does anything appear. It used to end on the
 * first field it disliked — one element carrying `strategy: "text"` destroyed a
 * whole run and left no registry, no scenarios and nothing to review. The cost
 * of the failure bore no relation to the size of the defect.
 *
 * Every case here is a shape the model can plausibly produce. The rule is the
 * same throughout: drop the unusable part, keep the rest, say what was dropped.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readModel } from '../generate.js';

const ok = {
  screens: [{ id: 'orders', title: 'Sổ lệnh', description: 'Danh sách lệnh' }],
  elements: [{
    id: 'orders.list',
    label: 'Danh sách lệnh',
    screen: 'orders',
    candidates: { web: [{ strategy: 'css', value: '.orders', weight: 0.8 }], android: [], ios: [] },
  }],
};

describe('a well-formed answer', () => {
  it('comes through intact', () => {
    const model = readModel(ok);
    assert.equal(model.screens.length, 1);
    assert.equal(model.elements[0]?.candidates.web?.length, 1);
  });

  it('stamps the source onto every screen', () => {
    const model = readModel(ok, { kind: 'confluence', ref: 'https://x/y' });
    assert.equal(model.screens[0]?.source?.ref, 'https://x/y');
  });
});

describe('shapes that used to be fatal', () => {
  it('survives a missing elements array', () => {
    const model = readModel({ screens: ok.screens });
    assert.equal(model.screens.length, 1);
    assert.equal(model.elements.length, 0);
  });

  it('survives a missing screens array', () => {
    const model = readModel({ elements: ok.elements });
    assert.equal(model.elements.length, 1);
  });

  it('survives an element with no candidates at all', () => {
    // Legitimate output: the document described the control but gave no clue
    // how to find it. Runtime discovery is exactly what that case is for.
    const model = readModel({
      screens: ok.screens,
      elements: [{ id: 'orders.filter', label: 'Lọc', screen: 'orders' }],
    });
    assert.equal(model.elements.length, 1);
    assert.deepEqual(model.elements[0]?.candidates, {});
  });

  it('survives a candidate with an invented strategy', () => {
    const model = readModel({
      screens: ok.screens,
      elements: [{
        ...ok.elements[0],
        candidates: { web: [{ strategy: 'nearby', value: 'x', weight: 0.5 }] },
      }],
    });
    assert.equal(model.elements.length, 1, 'element vẫn phải sống');
    assert.equal(model.elements[0]?.candidates.web?.length, 0);
  });

  it('survives a top-level answer that is not even an object', () => {
    const model = readModel('xin chào');
    assert.deepEqual(model, { screens: [], elements: [] });
  });
});

describe('what it will not quietly accept', () => {
  it('drops an element with no id, rather than registering a nameless one', () => {
    const model = readModel({
      screens: ok.screens,
      elements: [{ label: 'Không tên', screen: 'orders', candidates: {} }, ...ok.elements],
    });
    assert.equal(model.elements.length, 1);
    assert.equal(model.elements[0]?.id, 'orders.list');
  });

  it('drops an element with no screen, which could never be disambiguated', () => {
    const model = readModel({
      screens: ok.screens,
      elements: [{ id: 'x', label: 'X', candidates: {} }],
    });
    assert.equal(model.elements.length, 0);
  });

  it('treats an empty string as absent, because the model writes "" for nothing', () => {
    const model = readModel({
      screens: [{ id: 'orders', title: 'Sổ lệnh', description: '   ' }],
      elements: [],
    });
    assert.equal(model.screens[0]?.description, undefined);
  });

  it('ignores a platform that does not exist', () => {
    const model = readModel({
      screens: ok.screens,
      elements: [{ ...ok.elements[0], candidates: { web: [], desktop: [{ strategy: 'css', value: 'x', weight: 1 }] } }],
    });
    assert.equal('desktop' in (model.elements[0]?.candidates ?? {}), false);
  });
});

describe('an empty answer', () => {
  it('is not a failure — the registry may already hold everything needed', () => {
    // The pipeline loads the existing registry before generating and reports it
    // as "vốn từ sẵn có". A document describing a flow whose controls are all
    // already registered legitimately yields nothing new, and throwing here
    // would kill exactly the run that had everything it needed.
    const model = readModel({ screens: [], elements: [] });
    assert.deepEqual(model, { screens: [], elements: [] });
  });

  it('never throws, whatever the model wrote', () => {
    // Viability is decided at binding, which fails by naming the exact label it
    // could not find — an error a person can act on, unlike "model returned
    // nothing" raised from the wrong end of the pipeline.
    for (const junk of [null, 42, [], '', { screens: 'nope' }, { elements: {} }]) {
      assert.doesNotThrow(() => readModel(junk));
    }
  });
});
