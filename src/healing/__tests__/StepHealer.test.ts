/**
 * The rules that stand between a guess and a live brokerage account.
 *
 * Step healing exists because a tap that changes nothing means a step is
 * missing, and only running the application can reveal which one. The danger is
 * that the same mechanism, left unsupervised, clicks "Đặt lệnh" while looking
 * for the button that commits a watchlist entry. Every test here pins one of
 * the conditions under which the system is allowed to experiment rather than
 * ask — and the default is to ask.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  answerRejectedAll,
  CONFIDENCE_FLOOR,
  decideStepHealing,
  proposeStepHypotheses,
  type StepHypothesis,
} from '../StepHealer.js';

const context = { scenario: 'Thêm mã cổ phiếu mới vào danh mục', line: 13, screen: 'addStockModal' };

const hypothesis = (over: Partial<StepHypothesis> = {}): StepHypothesis => ({
  step: 'I click "Thêm mã"',
  elementId: 'priceBoard.addStockButton',
  elementText: 'Thêm mã',
  action: 'tap',
  reason: 'Nút ⊕ nằm ngay cạnh ô nhập đang giữ token "VIC,"',
  confidence: 0.9,
  ...over,
});

const known = (...ids: string[]) => new Set(ids.length ? ids : ['priceBoard.addStockButton']);

describe('when the system may experiment', () => {
  it('tries a confident, known, non-destructive action', () => {
    const decision = decideStepHealing({
      context, hypotheses: [hypothesis()], knownElementIds: known(),
    });
    assert.equal(decision.kind, 'try');
    assert.equal(decision.kind === 'try' && decision.hypothesis.step, 'I click "Thêm mã"');
  });

  it('picks the strongest guess when one clearly leads', () => {
    const decision = decideStepHealing({
      context,
      hypotheses: [
        hypothesis({ step: 'I click "Xem thêm"', elementId: 'auto.xemThem', elementText: 'Xem thêm', confidence: 0.4 }),
        hypothesis({ confidence: 0.9 }),
      ],
      knownElementIds: known('priceBoard.addStockButton', 'auto.xemThem'),
    });
    assert.equal(decision.kind === 'try' && decision.hypothesis.confidence, 0.9);
  });
});

describe('when it must ask instead', () => {
  it('never experiments with a destructive control once the guard is on', () => {
    // Off by default because this suite uses a test account and the classifier
    // is keyword-based; on, it is what stops a mechanism that tries its way to
    // an answer from eventually placing an order.
    const decision = decideStepHealing({
      context,
      blockHighRisk: true,
      hypotheses: [hypothesis({
        step: 'I click "Đặt lệnh"', elementId: 'priceBoard.datLenh',
        elementText: 'Đặt lệnh', confidence: 0.95,
      })],
      knownElementIds: known('priceBoard.datLenh'),
    });
    assert.equal(decision.kind, 'ask');
    assert.match(decision.kind === 'ask' ? decision.reason : '', /nguy hiểm/);
  });

  it('with the guard on, prefers a safe option over a more confident risky one', () => {
    const decision = decideStepHealing({
      context,
      blockHighRisk: true,
      hypotheses: [
        hypothesis({ confidence: 0.9 }),
        hypothesis({
          step: 'I click "Xoá khỏi danh mục"', elementId: 'priceBoard.xoaKhoiDanhMuc',
          elementText: 'Xoá khỏi danh mục', confidence: 0.95,
        }),
      ],
      knownElementIds: known('priceBoard.addStockButton', 'priceBoard.xoaKhoiDanhMuc'),
    });
    assert.equal(decision.kind, 'try');
    // Note the risky one carried the *higher* confidence and still lost.
    assert.equal(decision.kind === 'try' && decision.hypothesis.step, 'I click "Thêm mã"');
  });

  it('will not drive an element the registry has never heard of', () => {
    const decision = decideStepHealing({
      context,
      hypotheses: [hypothesis({ elementId: 'nhin.thay.tren.man.hinh' })],
      knownElementIds: known(),
    });
    assert.equal(decision.kind, 'ask');
    assert.match(decision.kind === 'ask' ? decision.reason : '', /chưa có trong registry/);
  });

  it('stays silent when nothing carries evidence', () => {
    // Not a question. Every candidate below the floor is just a control that
    // happens to be on screen, and offering four of them to choose between is
    // an inventory of the page dressed up as a decision — which is exactly what
    // one real failure produced while the true cause was the application
    // disabling the button outside business hours.
    const decision = decideStepHealing({
      context, hypotheses: [hypothesis({ confidence: 0.35 })], knownElementIds: known(),
    });
    assert.equal(decision.kind, 'give-up');
    assert.match(decision.kind === 'give-up' ? decision.reason : '', /bằng chứng/);
  });

  it('asks when two guesses are too close to separate', () => {
    const decision = decideStepHealing({
      context,
      hypotheses: [
        hypothesis({ confidence: 0.82 }),
        hypothesis({ step: 'I press "Enter"', elementId: 'addStockModal.searchInput', elementText: 'Ô tìm kiếm mã cổ phiếu', confidence: 0.78 }),
      ],
      knownElementIds: known('priceBoard.addStockButton', 'addStockModal.searchInput'),
    });
    assert.equal(decision.kind, 'ask');
    assert.match(decision.kind === 'ask' ? decision.reason : '', /ngang nhau/);
  });
});

describe('the question it produces', () => {
  /** Two candidates too close to separate — the one route that still asks. */
  const ambiguous = () => decideStepHealing({
    context,
    hypotheses: [
      hypothesis({ confidence: 0.82 }),
      hypothesis({ step: 'I press "Enter"', elementId: 'addStockModal.searchInput', confidence: 0.78 }),
    ],
    knownElementIds: known('priceBoard.addStockButton', 'addStockModal.searchInput'),
  });

  it('offers every guess plus a way to reject them all', () => {
    const decision = ambiguous();
    assert.equal(decision.kind, 'ask');
    if (decision.kind !== 'ask') return;
    assert.equal(decision.question.options.length, 3);
    assert.ok(answerRejectedAll(decision.question.options.at(-1)));
  });

  it('says where the run got stuck, so the answer is judgeable', () => {
    const decision = ambiguous();
    assert.match(
      decision.kind === 'ask' ? decision.question.rationale : '',
      /Thêm mã cổ phiếu mới vào danh mục, dòng 13/,
    );
  });

  it('only ever asks when there is a real hypothesis to choose between', () => {
    // The guarantee this whole change is about: a question always carries at
    // least one candidate that had evidence behind it.
    const decision = ambiguous();
    if (decision.kind !== 'ask') throw new Error('phải là câu hỏi');
    assert.ok(decision.question.options.length >= 2);
  });
});

describe('proposing from what the run did and what is on screen', () => {
  /** The real failure: line 13 clicked the suggestion and nothing changed. */
  const today = () => proposeStepHypotheses({
    priorTaps: [
      { elementId: 'priceBoard.addStockButton', label: 'Thêm mã' },
      { elementId: 'priceBoard.stockSearchFirstResult', label: 'Kết quả tìm kiếm đầu tiên' },
    ],
    visibleNow: [
      { elementId: 'priceBoard.addStockButton', label: 'Thêm mã' },
      { elementId: 'addStockModal.clearButton', label: 'Xóa từ khóa' },
    ],
    failingElementId: 'priceBoard.stockSearchFirstResult',
  });

  it('leads with the control the scenario already used', () => {
    const [first] = today();
    assert.equal(first?.step, 'I click "Thêm mã"');
  });

  it('never proposes re-pressing the control that just proved nothing', () => {
    assert.ok(!today().some((h) => h.elementId === 'priceBoard.stockSearchFirstResult'));
  });

  it('offers merely-present controls too, but not as an answer', () => {
    const present = today().find((h) => h.elementId === 'addStockModal.clearButton');
    assert.ok(present, 'phải có trong danh sách để người duyệt còn thấy');
    assert.ok(present!.confidence < CONFIDENCE_FLOOR, 'nhưng không được đủ để tự thử');
  });

  it('skips a control that is no longer on screen', () => {
    const proposals = proposeStepHypotheses({
      priorTaps: [{ elementId: 'home.searchBox', label: 'Nút tìm kiếm' }],
      visibleNow: [],
      failingElementId: 'x',
    });
    assert.equal(proposals.length, 0);
  });

  it('reaches the same answer a day of manual debugging did', () => {
    // End to end on the real case: the proposal the generator leads with is the
    // step that was eventually added by hand, and the gate lets it be tried.
    const decision = decideStepHealing({
      context,
      hypotheses: today(),
      knownElementIds: new Set(['priceBoard.addStockButton', 'addStockModal.clearButton']),
    });
    assert.equal(decision.kind, 'try');
    assert.equal(decision.kind === 'try' && decision.hypothesis.step, 'I click "Thêm mã"');
  });
});

describe('when there is nothing to work with', () => {
  it('gives up rather than inventing a hypothesis', () => {
    const decision = decideStepHealing({ context, hypotheses: [], knownElementIds: known() });
    assert.equal(decision.kind, 'give-up');
  });
});
