/**
 * Hiện thực repo đầu tiên: chính các file JSON đang dùng.
 *
 * Nó cố tình KHÔNG thông minh hơn bản hôm nay. Mục đích là để P1 tách route
 * được mà không đổi một hành vi nào — bản Postgres đến sau, và test parity
 * ([__tests__/fileRepoParity.test.ts](./__tests__/fileRepoParity.test.ts)) là
 * thứ chứng minh hai hiện thực nói cùng một câu.
 *
 * Một điều bản này làm thêm so với code hiện tại: `revision`. File JSON không
 * có số phiên bản, nên dùng hash nội dung — cùng cách `configRevision()` trong
 * server.ts đang làm cho config. Nhờ vậy ghi có đối chiếu chạy được ngay trên
 * file, trước khi có DB, và P1 không phải chờ P2.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localProposals } from '../proposals/memoryStore.js';
import { localLeases } from './leaseRepo.js';
import { localQueue } from '../queue/memoryQueue.js';
import { Registry } from '../../core/registry.js';
import { History } from '../../core/history.js';
import type { WorkflowRun } from '../../core/history.js';
import { listRuns } from '../../core/runstore.js';
import type { RunMeta } from '../../core/runstore.js';
import type { ElementRegistry } from '../../core/types.js';
import {
  revisionOf,
  RevisionConflictError,
  type JobRepo,
  type RegistryRepo,
  type Repos,
  type RunRepo,
  type Versioned,
} from './repo.js';

/**
 * Phiên bản tính từ NỘI DUNG đã parse, không từ byte của file.
 *
 * Khác nhau ở một chỗ quan trọng: `prettier` chạy qua, một dấu xuống dòng đổi,
 * hay `JSON.stringify` đổi cách thụt lề — byte đổi, nội dung thì không. Tính
 * theo byte nghĩa là mọi người đang mở màn hình sẽ nhận 409 sau một lần định
 * dạng lại file, dù chẳng ai sửa gì.
 */
async function fileRevision(file: string): Promise<string | undefined> {
  if (!existsSync(file)) return undefined;
  try {
    return revisionOf(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return undefined;
  }
}

export class FileRegistryRepo implements RegistryRepo {
  constructor(private readonly file: string) {}

  async read(): Promise<Versioned<ElementRegistry>> {
    const registry = await Registry.load(this.file);
    return { data: registry.raw, revision: await fileRevision(this.file) };
  }

  async write(next: ElementRegistry, baseRevision?: string): Promise<Versioned<ElementRegistry>> {
    await this.assertUnchanged(baseRevision);
    await writeFile(this.file, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return { data: next, revision: revisionOf(next) };
  }

  /**
   * Gộp qua chính `Registry.mergeFrom()`, không tự viết lại phép gộp.
   *
   * Phép gộp ấy có luật riêng cho từng loại trường — ứng viên thì hợp nhất,
   * bộ đếm sức khoẻ thì cộng dồn, `lastHealedAt` thì lấy mốc mới hơn. Viết lại
   * ở đây là tạo ra bản thứ hai sẽ lệch dần khỏi bản gốc.
   */
  async merge(delta: ElementRegistry): Promise<Versioned<ElementRegistry>> {
    const registry = await Registry.load(this.file);
    registry.mergeFrom(delta);
    await registry.save();
    return { data: registry.raw, revision: await fileRevision(this.file) };
  }

  private async assertUnchanged(baseRevision?: string): Promise<void> {
    // Không nói mình dựa trên bản nào thì không có gì để đối chiếu. CLI và
    // script cũ ghi thẳng như thế, và chặn chúng lại là phá việc đang chạy —
    // cùng lựa chọn mà `PUT /api/config` đã làm.
    if (!baseRevision) return;
    const current = await fileRevision(this.file);
    if (current !== baseRevision) throw new RevisionConflictError(baseRevision, current);
  }
}

export class FileJobRepo implements JobRepo {
  constructor(private readonly file = 'registry/history.json') {}

  async list(): Promise<WorkflowRun[]> {
    return (await History.load(this.file)).list();
  }

  async find(id: string): Promise<WorkflowRun | undefined> {
    return (await History.load(this.file)).find(id);
  }

  async closeInterrupted(): Promise<number> {
    const history = await History.load(this.file);
    const closed = history.closeInterrupted();
    if (closed > 0) await history.save();
    return closed;
  }
}

export class FileRunRepo implements RunRepo {
  constructor(private readonly root: string) {}

  async list(): Promise<RunMeta[]> {
    return listRuns(this.root);
  }

  async find(id: string): Promise<RunMeta | undefined> {
    return (await listRuns(this.root)).find((run) => run.id === id);
  }
}

/** Bộ repo cho chế độ `embedded` và cho P1, dựng từ `config.paths`. */
export function fileRepos(paths: { registry: string; runs: string }): Repos {
  return {
    registry: new FileRegistryRepo(path.resolve(paths.registry)),
    jobs: new FileJobRepo(),
    runs: new FileRunRepo(paths.runs),
    // Lease sống trong bộ nhớ, và là MỘT bản cho cả tiến trình — `fileRepos()`
    // được gọi lại mỗi request. Xem `leaseRepo.ts`.
    leases: localLeases,
    // Cùng lý do: hàng đợi mới mỗi request nghĩa là job vừa tạo biến mất ở
    // request kế tiếp.
    queue: localQueue,
    // Và cùng lý do lần thứ ba: đề xuất tạo ở request này phải còn ở request sau.
    proposals: localProposals,
  };
}
