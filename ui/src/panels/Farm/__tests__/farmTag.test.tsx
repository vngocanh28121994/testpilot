import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Đường dẫn tính từ chính file test: vitest chạy với cwd là thư mục ui/. */
const here = path.dirname(new URL(import.meta.url).pathname);

/**
 * Giới hạn phạm vi trên farm từng phải tự gõ tay hai lần.
 *
 * Người dùng phải tự nhớ đúng tên biến `TESTPILOT_TAG`, rồi tự gõ đúng tên tag
 * vào ô "giá trị" bên cạnh. Gõ sai một ký tự thì farm lặng lẽ chạy cả bộ — và
 * chỉ biết sau vài chục phút cùng tiền thiết bị đã tiêu.
 *
 * Test đọc mã nguồn vì màn Farm cần cả router lẫn nhiều truy vấn; thứ đáng canh
 * ở đây là các mắt nối, không phải việc dựng lại cả màn hình.
 */
const source = readFileSync(path.join(here, '..', 'index.tsx'), 'utf8');

describe('Farm — lọc theo tag', () => {
  it('dùng chung ô chọn tag với Local Runner', () => {
    expect(source).toMatch(/import \{ TagFilter \}/);
    expect(source).toMatch(/<TagFilter all=\{allTags\} value=\{farmTags\} onChange=\{setFarmTags\}/);
  });

  it('ghi vào đúng biến mà testspec đọc, nối bằng dấu cộng', () => {
    expect(source).toMatch(/const FARM_TAG_VAR = 'TESTPILOT_TAG';/);
    expect(source).toMatch(/value: next\.join\('\+'\)/);
    expect(readFileSync(path.join(here, '../../../../..', 'farm/testspec.yml'), 'utf8')).toMatch(/--tag "\$TESTPILOT_TAG"/);
  });

  /** Một giá trị, hai ô sửa là cách chắc chắn để hai ô nói khác nhau. */
  it('ẩn dòng đó khỏi bảng biến môi trường chung', () => {
    expect(source).toMatch(/form\.env\.filter\(\(entry\) => entry\.key !== FARM_TAG_VAR\)/);
  });

  it('bỏ hết tag thì xoá luôn biến, không để lại chuỗi rỗng', () => {
    expect(source).toMatch(/next\.length > 0 \? \[\{ key: FARM_TAG_VAR/);
  });
});

/**
 * Tích thiết bị KHÔNG phải là chọn thiết bị cho lượt chạy.
 *
 * Danh sách tích chỉ là nguyên liệu cho nút "Tạo pool"; lượt chạy đọc ô
 * "Device pool" ở trên. Người dùng tích hai máy Android, bấm chạy, và lượt chạy
 * dùng một pool iPhone còn sót trong ô kia — ba lần upload mới biết, vì AWS chỉ
 * trả lời sau khi đã nhận đủ gói.
 */
describe('Farm — tích thiết bị chưa phải là pool', () => {
  it('chặn lượt chạy khi đã tích mà chưa tạo pool', () => {
    expect(source).toMatch(/if \(selected\.length > 0 && !poolMatchesTicks\)/);
    expect(source).toMatch(/chưa tạo pool/);
  });

  it('nói ra ngay dưới danh sách, không đợi tới lúc bấm chạy', () => {
    expect(source).toMatch(/Đã tích \$\{selected\.length\} thiết bị nhưng chưa thành pool/);
  });

  /** Tạo pool xong thì chính pool đó là thứ sẽ chạy — nói ra để khỏi đoán. */
  it('tạo pool xong thì ghi nhận nó là pool của lượt chạy', () => {
    expect(source).toMatch(/setTicksPool\(response\.data\.arn\)/);
    expect(source).toMatch(/Lượt chạy sẽ dùng pool này/);
  });
});

/**
 * Pool vừa tạo hiện ra là "test (undefined)" — trông như hỏng, ngay sau một
 * thao tác vừa thành công. createDevicePool chỉ trả {arn, name}, còn nhãn in
 * "<tên> (<loại>)".
 */
describe('Farm — tạo pool', () => {
  it('nút có trạng thái đang chạy, không để bấm hai lần', () => {
    expect(source).toMatch(/const \[makingPool, setMakingPool\] = useState\(false\)/);
    expect(source).toMatch(/disabled=\{makingPool\}/);
    expect(source).toMatch(/Đang tạo pool…/);
    // Mở khoá trong finally: hỏng giữa chừng mà nút vẫn khoá thì hết đường thử lại.
    expect(source).toMatch(/finally \{\s*\n\s*setMakingPool\(false\);/);
  });

  it('không in "(undefined)" khi pool chưa có loại', () => {
    expect(source).toMatch(/item\.type \? `\$\{item\.name\} \(\$\{item\.type\}\)` : item\.name/);
  });

  /** Pool dựng từ danh sách đã lọc theo nền tảng thì thuộc đúng nền tảng đó. */
  it('gắn nền tảng cho pool vừa tạo, để bộ lọc không giấu mất', () => {
    expect(source).toMatch(/\{ \.\.\.response\.data!, platforms: \[platform\] \}/);
  });
});

/**
 * Chạy xong thì không có lối nào sang báo cáo.
 *
 * Báo cáo vẫn được sinh đầy đủ — mỗi máy một bản, runDirs ghi đủ cả hai — và
 * màn /farm/<runId> hiện được chúng. Nhưng ở màn Farm, chạy xong thì log dừng
 * và hết; người dùng phải tự đoán ra là phải cuộn xuống danh sách "Lượt chạy"
 * rồi bấm "Xem". Đây đúng là lúc họ muốn xem nhất.
 */
describe('Farm — đường sang báo cáo', () => {
  it('hiện link báo cáo ngay khi lượt chạy kết thúc', () => {
    expect(source).toMatch(/job\.status !== 'running' && job\.logs\.length > 0 && latestFarmRun/);
    expect(source).toMatch(/Xem báo cáo/);
    expect(source).toMatch(/params=\{\{ runId: latestFarmRun\.id \}\}/);
  });

  /** Nói luôn thu được báo cáo của mấy máy: một lượt farm chạy song song nhiều máy. */
  it('nói số máy đã thu được báo cáo', () => {
    expect(source).toMatch(/Đã thu báo cáo của \$\{latestFarmRun\.runDirs\.length\} máy/);
  });
});
