/**
 * "Lượt này lấy app ở đâu" là câu hỏi của từng lượt chạy, không phải của cấu hình.
 *
 * Nhu cầu đổi theo buổi: sáng chạy trên bản vừa cắm máy cài tay, chiều chạy lại
 * sau khi có bản build mới. Bắt người dùng vào sửa config giữa hai lượt là bắt
 * họ rời khỏi màn hình đang làm việc để đổi một thứ đáng lẽ nằm ngay đó, cạnh
 * ô chọn môi trường.
 *
 * Test đọc chính mã nguồn: luồng đi qua một tiến trình con và một CLI, nên thứ
 * duy nhất kiểm được mà không dựng cả máy thật là các mắt nối có khớp nhau không.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const run = readFileSync('src/cli/run.ts', 'utf8');
const parallel = readFileSync('src/cli/run-parallel.ts', 'utf8');
const server = readFileSync('src/ui/server.ts', 'utf8');
/**
 * Phần chạy suite sang `src/runner/execute.ts` ở P1 (2026-09-21): nó sinh tiến
 * trình CLI nên nó thuộc về runner, không thuộc về phần phục vụ HTTP. Cờ
 * `--app-source` vẫn phải đi hết đường từ giao diện xuống CLI — chỉ đổi chỗ đọc.
 */
const execute = readFileSync('src/runner/execute.ts', 'utf8');
/** Cụm workflow sang `src/server/routes/workflow.ts` ở chặng cuối P1.2. */
const workflow = readFileSync('src/server/routes/workflow.ts', 'utf8');
const runner = readFileSync('ui/src/panels/Runner/index.tsx', 'utf8');
const studio = readFileSync('ui/src/panels/Studio/index.tsx', 'utf8');

describe('nguồn app của một lượt chạy', () => {
  it('CLI nhận --app-source và chỉ chấp nhận hai giá trị', () => {
    assert.match(run, /--app-source/);
    assert.match(run, /must be device \| upload/);
  });

  /**
   * Không truyền cờ thì giữ nguyên hành vi cũ theo config. Script và lịch chạy
   * đã có từ trước không được đổi cách chạy chỉ vì một cờ mới ra đời.
   */
  it('không truyền cờ thì theo useInstalledApp trong config', () => {
    assert.match(run, /args\.appSource\s*\n?\s*\?\s*args\.appSource === 'device'/);
    assert.match(run, /useInstalledApp/);
  });

  /**
   * `--app-source device` trả lời đúng câu mà bộ chặn môi trường hỏi — lượt này
   * không cài gì, nên không có chuyện cài nhầm bản của môi trường mặc định.
   */
  it('chọn bản trên máy thì bộ chặn môi trường không chặn nữa', () => {
    assert.match(run, /args\.appSource !== 'device'\s*\)?\s*\{?\s*\n?\s*assertEnvPackage/);
  });

  it('server chuyển cờ xuống cả lượt đơn lẫn lượt song song', () => {
    assert.match(execute, /'--app-source', appSource/);
    assert.match(parallel, /'--app-source', args\.appSource/);
  });

  it('bản build tải lên được cài thật trên thiết bị', () => {
    assert.match(execute, /appSource === 'upload' && platform !== 'web' \? \['--reinstall'\]/);
    assert.match(execute, /appSource === 'upload' \? \['--reinstall'\]/);
  });

  it('workflow chạy đồng thời các nền tảng local', () => {
    assert.match(studio, /const PLATFORMS = \['web', 'android', 'ios'\] as const/);
    assert.match(workflow, /Promise\.all\(execution\.platforms\.map\(async \(platform\)/);
  });

  it('workflow song song cô lập shared writes rồi chỉ gộp một lần', () => {
    assert.match(workflow, /const deferSharedWrites = execution\.platforms\.length > 1/);
    assert.match(execute, /deferSharedWrites \? \['--defer-shared-writes'\] : \[\]/);
    assert.match(workflow, /localOutcomes\.flatMap\(\(outcome\) => outcome\.runDirs\)/);
    assert.match(workflow, /await mergeRunLearnings\(\{/);
  });

  it('lượt chạy riêng lẻ giữ nguyên cơ chế ghi dữ liệu hiện tại', () => {
    assert.match(execute, /deferSharedWrites = false/);
    assert.match(workflow, /execution\.platforms\.length > 1/);
  });

  it('hai màn chạy đều hỏi, và mặc định là bản có sẵn trên thiết bị', () => {
    for (const [name, source] of [['Local Runner', runner], ['Studio', studio]] as const) {
      assert.match(source, /Nguồn app/, `${name} phải hỏi nguồn app`);
      assert.match(source, /Bản có sẵn trên thiết bị/, name);
      assert.match(source, /Bản build đã tải lên/, name);
      assert.match(source, /'device'/, `${name} phải mặc định bản trên thiết bị`);
    }
  });

  /**
   * Web không cài gì cả, nên hỏi ở đó là hỏi một câu vô nghĩa.
   */
  it('không hỏi khi chạy web', () => {
    assert.match(runner, /platform !== 'web' && \(\s*\n?\s*<Field label="Nguồn app">/);
    assert.match(run, /platform === 'web'\s*\n?\s*\?\s*false/);
  });
});
