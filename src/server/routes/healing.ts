/**
 * Healing và các cặp element nghi trùng vai.
 *
 * Ba route này đọc và ghi registry, nên chúng là nhóm đầu tiên chạm vào dữ
 * liệu dùng chung. Ở P4.4 chính chúng trở thành màn duyệt `registry_proposal`:
 * runner gửi đề xuất, người duyệt bấm ở đây. Hôm nay hành vi giữ nguyên từng
 * dòng — chỉ đổi chỗ ở.
 */
import { Registry } from '../../core/registry.js';
import { DuplicateReviewStore } from '../../core/duplicateReview.js';
import { findDuplicateElements } from '../../core/duplicateElements.js';
import { assessLocatorQuality } from '../../core/locatorQuality.js';
import { HealingStore } from '../../healing/HealingStore.js';
import { loadConfig, type TestPilotConfig } from '../../config.js';
import type { ElementDef, LocatorCandidate, Platform } from '../../core/types.js';
import type { DuplicateElementView, DuplicateReviewRequest, HealingResponse } from '../../ui/contracts.js';
import { RevisionConflictError, type Repos } from '../db/repo.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

async function healingState(cfg: TestPilotConfig, repos: Repos): Promise<HealingResponse> {
  const healing = await HealingStore.load(cfg.paths.healingDb);
  const imported = await healing.backfill(cfg.paths.runs);
  if (imported > 0) await healing.save();
  // Registry qua repo, không qua đĩa: ở chế độ server nó nằm trong Postgres
  // của đúng tổ chức người gọi, và handler này không cần biết điều đó.
  const registry = Registry.fromData((await repos.registry.read()).data);
  const records = healing.records().map((record) => ({
    ...record,
    // `current` in healing telemetry is a historical snapshot: the candidate
    // that failed when this event happened. Expose today's actual primary
    // separately so the review table never presents the snapshot as live state.
    primary: registry.raw.elements[record.elementId]?.candidates[record.platform]?.[0] ?? null,
    quality: assessLocatorQuality(record.proposed),
  }));
  return {
    policy: { minSuccesses: 3, minRuns: 2 },
    records,
    duplicates: await pendingDuplicates(cfg, registry),
    summary: {
      total: records.length,
      proposed: records.filter((item) => item.status === 'proposed').length,
      watching: records.filter((item) => item.status === 'watching').length,
      applied: records.filter((item) => item.status === 'applied').length,
      rejected: records.filter((item) => item.status === 'rejected').length,
    },
  };
}

/**
 * Cặp element bị nghi trùng vai, còn chờ người duyệt.
 *
 * Danh sách nghi vấn tính lại từ registry mỗi lần hỏi; chỉ quyết định là được
 * lưu. Nên một cặp hết nghi sẽ tự biến mất, và một cặp đã bị bấm "không phải
 * trùng" thì không bao giờ quay lại — điều kiện để danh sách này về được 0 và
 * vì thế còn được đọc.
 */
async function pendingDuplicates(
  cfg: TestPilotConfig,
  registry: Registry,
): Promise<DuplicateElementView[]> {
  const review = await DuplicateReviewStore.load(cfg.paths.duplicateReviewDb);
  const pairs = review.pending(findDuplicateElements(registry.raw.elements));
  return pairs.map((pair) => {
    const strong = registry.raw.elements[pair.strong]!;
    const weak = registry.raw.elements[pair.weak]!;
    const approved = parseWinnerKey(pair.strongKey);
    return {
      strong: { id: pair.strong, label: strong.label, wins: totalWins(strong) },
      weak: { id: pair.weak, label: weak.label, wins: totalWins(weak) },
      sharedLocator: pair.strongKey,
      share: pair.share,
      weakAlreadyHasIt: approved !== undefined
        && Object.values(weak.candidates).some((list) => (list ?? []).some((candidate) =>
          candidate.strategy === approved.strategy
          && candidate.value === approved.value
          && candidate.approved === true)),
    };
  });
}

/**
 * `strategy:value[:name]` ngược lại thành một candidate.
 *
 * `value` được phép chứa dấu hai chấm — một selector CSS đầy rẫy — nên chỉ cắt
 * ở dấu ĐẦU TIÊN, và phần `name` chỉ tồn tại với strategy `role`, nơi tên là
 * một phần của danh tính. Cắt tham lam ở đây sẽ lặng lẽ dựng ra một locator
 * khác với cái đã thắng.
 */
function parseWinnerKey(key: string): LocatorCandidate | undefined {
  const first = key.indexOf(':');
  if (first <= 0) return undefined;
  const strategy = key.slice(0, first) as LocatorCandidate['strategy'];
  const rest = key.slice(first + 1);
  if (strategy === 'role') {
    const split = rest.lastIndexOf(':');
    if (split > 0) {
      return {
        strategy,
        value: rest.slice(0, split),
        name: rest.slice(split + 1),
        weight: 1,
        origin: 'healed',
      };
    }
  }
  return { strategy, value: rest, weight: 1, origin: 'healed' };
}

function totalWins(element: ElementDef): number {
  return Object.values(element.health?.winners ?? {})
    .reduce<number>((sum, n) => sum + n, 0);
}

export const healingRoutes: RouteTable = {
  'GET /api/healing': async (req, res, url, ctx) => {
    const cfg = await loadConfig(ctx.configFile);
    return json(res, 200, await healingState(cfg, ctx.repos));
  },

  'POST /api/healing/review': async (req, res, url, ctx) => {
    const body = await readJson<{ id: string; action: 'apply' | 'reject' }>(req);
    if (!body.id || !['apply', 'reject'].includes(body.action)) {
      return json(res, 400, { error: 'Healing action không hợp lệ.' });
    }
    const cfg = await loadConfig(ctx.configFile);
    const healing = await HealingStore.load(cfg.paths.healingDb);
    const record = healing.records().find((item) => item.id === body.id);
    if (!record) return json(res, 404, { error: 'Không tìm thấy đề xuất healing.' });

    if (body.action === 'apply') {
      // Đọc kèm phiên bản, ghi kèm phiên bản. Duyệt healing là một lệnh ghi
      // vào dữ liệu dùng chung, nên nó phải biết mình đang ghi đè ai — hai
      // người cùng mở màn Healing Center là chuyện bình thường.
      const { data, revision } = await ctx.repos.registry.read();
      const registry = Registry.fromData(data);
      registry.promoteCandidate(record.elementId, record.platform, record.proposed);
      try {
        await ctx.repos.registry.write(registry.raw, revision);
      } catch (err) {
        if (err instanceof RevisionConflictError) {
          return json(res, 409, { error: err.message });
        }
        throw err;
      }
      healing.review(body.id, 'applied');
    } else {
      healing.review(body.id, 'rejected');
    }
    await healing.save();
    return json(res, 200, await healingState(cfg, ctx.repos));
  },

  /**
   * Quyết định về một cặp element bị nghi trùng vai.
   *
   * `merge` cố ý KHÔNG xoá bản ghi nào và KHÔNG đụng tới alias. Step bind vào
   * element theo id, nên xoá một bản ghi là làm hỏng mọi bước trỏ vào nó; và
   * registry còn từ chối load khi một alias trùng label của element khác, nên
   * "gộp tên" bằng một nút bấm là cách nhanh nhất để hỏng cả registry.
   *
   * Thứ thực sự chữa được lượt chạy nhỏ hơn thế nhiều: mang locator mà cả hai
   * bên đều đã chứng minh sang bên yếu, đặt làm primary đã duyệt. Bước đang
   * hỏng chạy lại được ngay, hai bản ghi vẫn nguyên, và việc gộp thật — nếu
   * có — vẫn là quyết định của con người trong code review.
   */
  'POST /api/healing/duplicate': async (req, res, url, ctx) => {
    const body = await readJson<DuplicateReviewRequest>(req);
    if (!body.strong || !body.weak || !['merge', 'distinct'].includes(body.action)) {
      return json(res, 400, { error: 'Quyết định trùng vai không hợp lệ.' });
    }
    const cfg = await loadConfig(ctx.configFile);
    const { data: registryData, revision } = await ctx.repos.registry.read();
    const registry = Registry.fromData(registryData);
    // Khớp theo CẶP, không theo thứ tự client gửi. Hướng mạnh/yếu do bằng
    // chứng quyết định và đổi được giữa hai lần tải trang — một lượt chạy
    // thêm vài lần thắng cho bên kia là đủ. Nhận theo thứ tự client thì một
    // màn hình mở hơi lâu sẽ báo "cặp không còn trong danh sách", còn tệ hơn
    // là nó mở đường cho việc gộp ngược hướng.
    const wanted = [body.strong, body.weak].sort().join('::');
    const pair = findDuplicateElements(registry.raw.elements)
      .find((item) => [item.strong, item.weak].sort().join('::') === wanted);
    if (!pair) return json(res, 404, { error: 'Cặp này không còn trong danh sách nghi vấn.' });

    if (body.action === 'merge') {
      const approved = parseWinnerKey(pair.strongKey);
      if (!approved) return json(res, 400, { error: `Không dựng được locator từ "${pair.strongKey}".` });
      const weak = registry.raw.elements[pair.weak]!;
      // Chỉ những nền tảng element ấy đã có candidate. Thêm locator cho một
      // nền tảng nó chưa từng chạy là bịa ra một khẳng định chưa ai kiểm.
      const platforms = (Object.keys(weak.candidates) as Platform[])
        .filter((platform) => (weak.candidates[platform]?.length ?? 0) > 0);
      if (platforms.length === 0) {
        return json(res, 400, { error: `"${pair.weak}" chưa có candidate ở nền tảng nào để thăng hạng.` });
      }
      try {
        for (const platform of platforms) registry.promoteCandidate(pair.weak, platform, approved);
      } catch (err) {
        return json(res, 400, { error: (err as Error).message });
      }
      try {
        // Ghi kèm phiên bản đã đọc ở đầu handler. Quyết định "gộp" dựa trên
        // danh sách cặp nghi vấn tính từ CHÍNH bản đó — nếu registry đã đổi
        // giữa chừng thì danh sách ấy cũng đã khác, và ghi tiếp là quyết định
        // dựa trên một màn hình đã cũ.
        await ctx.repos.registry.write(registry.raw, revision);
      } catch (err) {
        if (err instanceof RevisionConflictError) return json(res, 409, { error: err.message });
        throw err;
      }
    }

    const review = await DuplicateReviewStore.load(cfg.paths.duplicateReviewDb);
    review.decide(pair.strong, pair.weak, body.action === 'merge' ? 'merged' : 'distinct');
    await review.save();
    return json(res, 200, await healingState(cfg, ctx.repos));
  },
};
