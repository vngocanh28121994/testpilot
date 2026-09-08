/**
 * Nhãn "Known issue" tách một kịch bản đỏ-vì-sản-phẩm khỏi một kịch bản hỏng.
 *
 * Ca thật: app loại tiểu khoản nguồn khỏi danh sách đích nhưng không làm chiều
 * ngược lại. Kịch bản mô tả đúng yêu cầu và chạy đúng; app chưa đáp ứng. Gộp nó
 * vào con số fail thì hoặc người ta xoá kịch bản đúng để suite xanh, hoặc quen
 * dần với một suite luôn đỏ rồi thôi không đọc nữa.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { KnownIssueStore } from '../knownIssues.js';

async function store() {
  const dir = await mkdtemp(path.join(tmpdir(), 'known-'));
  return { file: path.join(dir, 'known-issues.json'), dir };
}

const issue = (over: Partial<Parameters<KnownIssueStore['mark']>[0]> = {}) => ({
  id: 'chuyen-tien-tieu-khoan-dich',
  filename: 'chuyen-tien-noi-bo.feature',
  scenarioName: 'Tiểu khoản đã chọn ở đích không xuất hiện ở dropdown nguồn',
  contentHash: 'hash-1',
  note: 'App chỉ loại trừ theo chiều nguồn→đích.',
  ...over,
});

describe('KnownIssueStore', () => {
  it('nhãn có hiệu lực khi nội dung kịch bản không đổi', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    s.mark(issue());
    assert.ok(s.active('chuyen-tien-tieu-khoan-dich', 'hash-1'));
  });

  /**
   * Nhãn thuộc về đúng những bước đã được xem xét, không thuộc về cái tên. Nếu
   * không, sửa kịch bản thành một thứ khác hẳn rồi giữ nguyên tên là đủ để nó
   * mãi mãi không bao giờ bị tính là fail.
   */
  it('hết hiệu lực khi nội dung kịch bản đổi, dù tên giữ nguyên', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    s.mark(issue());
    assert.equal(s.active('chuyen-tien-tieu-khoan-dich', 'hash-2'), undefined);
    assert.ok(s.stale('chuyen-tien-tieu-khoan-dich', 'hash-2'), 'phải nói được là nhãn đã cũ');
  });

  it('phân biệt "chưa từng gắn" với "gắn rồi nhưng đã cũ"', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    assert.equal(s.active('không-có', 'hash-1'), undefined);
    assert.equal(s.stale('không-có', 'hash-1'), undefined);
  });

  it('bắt buộc có lý do', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    assert.throws(() => s.mark(issue({ note: '   ' })), /lý do/);
  });

  it('gỡ được nhãn, và nói rõ có gỡ được gì không', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    s.mark(issue());
    assert.equal(s.unmark('chuyen-tien-tieu-khoan-dich'), true);
    assert.equal(s.unmark('chuyen-tien-tieu-khoan-dich'), false);
    assert.equal(s.active('chuyen-tien-tieu-khoan-dich', 'hash-1'), undefined);
  });

  it('ghi xuống đĩa và đọc lại được', async () => {
    const { file } = await store();
    const a = await KnownIssueStore.load(file);
    a.mark(issue());
    await a.save();

    const b = await KnownIssueStore.load(file);
    const found = b.active('chuyen-tien-tieu-khoan-dich', 'hash-1');
    assert.equal(found?.note, 'App chỉ loại trừ theo chiều nguồn→đích.');
    assert.ok(found?.markedAt, 'phải ghi lại thời điểm gắn nhãn');
  });

  /**
   * Một file hỏng không được phép chặn cả lượt chạy. Mất nhãn thì kịch bản quay
   * về đỏ thật — mặc định an toàn, vì nó chỉ làm người ta chú ý nhiều hơn.
   */
  it('file hỏng thì coi như chưa có nhãn nào, không ném lỗi', async () => {
    const { file } = await store();
    await writeFile(file, '{ hỏng', 'utf8');
    const s = await KnownIssueStore.load(file);
    assert.deepEqual(s.list(), []);
  });

  it('không ghi lại file khi không có gì đổi', async () => {
    const { file } = await store();
    const a = await KnownIssueStore.load(file);
    a.mark(issue());
    await a.save();
    const before = await readFile(file, 'utf8');

    const b = await KnownIssueStore.load(file);
    await b.save();
    assert.equal(await readFile(file, 'utf8'), before);
  });
});

/**
 * Sinh lại một feature là một đợt bản nháp MỚI, kể cả khi chữ giống hệt — chính
 * cổng duyệt cũng theo nguyên tắc đó (forcePending). Nhãn Known issue là một
 * quyết định của con người về kịch bản, nên nó rơi theo cùng nguyên tắc.
 *
 * Không làm vậy thì một kịch bản vừa sinh ra đã mang sẵn nhãn "sản phẩm chưa đáp
 * ứng" — nhãn nói về một lần chạy và một phiên bản app của quá khứ, chưa ai kiểm
 * lại còn đúng không, mà đã kịp miễn cho kịch bản đó khỏi bị tính là fail.
 */
describe('sinh lại feature thì gỡ nhãn của chính file đó', () => {
  it('gỡ hết nhãn của file được sinh lại', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    s.mark(issue());
    assert.equal(s.forgetFile('chuyen-tien-noi-bo.feature'), 1);
    assert.equal(s.active('chuyen-tien-tieu-khoan-dich', 'hash-1'), undefined);
  });

  it('không đụng tới nhãn của file khác', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    s.mark(issue());
    s.mark(issue({ id: 'khac', filename: 'dang-nhap.feature' }));

    assert.equal(s.forgetFile('chuyen-tien-noi-bo.feature'), 1);
    assert.ok(s.active('khac', 'hash-1'), 'nhãn của file khác phải còn nguyên');
  });

  it('không có gì để gỡ thì trả về 0 và không ghi lại file', async () => {
    const { file } = await store();
    const s = await KnownIssueStore.load(file);
    assert.equal(s.forgetFile('khong-co.feature'), 0);
  });
});
