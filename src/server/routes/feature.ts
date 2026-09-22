/**
 * Feature file: lưu, duyệt, gắn known issue, chuẩn hoá.
 *
 * Nhóm ghi nhiều nhất trong đợt tách này, và cũng là nhóm đã sẵn có thứ mọi
 * store dùng chung rồi sẽ cần: `baseRevision` + 409. Mẫu ấy có trước kế hoạch
 * farm, và `RegistryRepo` ở P0.2 chỉ là cùng một ý tưởng áp cho registry.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { loadConfig, type TestPilotConfig } from '../../config.js';
import { Registry } from '../../core/registry.js';
import { ActionRegistry } from '../../actions/ActionRegistry.js';
import { expandApprovedActions } from '../../actions/expandActions.js';
import { normalizeFeatureTags } from '../../core/tagTaxonomy.js';
import { KnownIssueStore } from '../../core/knownIssues.js';
import { ScenarioReviewStore, scenarioBlocks } from '../../core/scenarioReview.js';
import { prepareExecutableDraft } from '../../genspec/draft.js';
import { normalizeFeatureDraft } from '../../genspec/normalizeDraft.js';
import { pickModel } from '../../llm/client.js';
import { syncPomProject } from '../../pom/sync.js';
import { parseFeature } from '../../steps/binding.js';
import { RevisionConflictError } from '../db/repo.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

/**
 * Dấu vân của file config lúc này, để phát hiện ghi đè lên một bản đã cũ.
 *
 * Chuyện đã xảy ra và dựng lại được: mở màn Cấu hình → sang màn Bản build tải
 * một bản lên (server ghi vào config ngay) → quay lại bấm Lưu. Màn Cấu hình gửi
 * lại đúng bản nó chụp lúc mở, trong đó chưa có bản build kia, và server ghi đè
 * toàn bộ. HTTP 200, không một lời nào, và `build/sit/app-sit.ipa` nằm lại trên
 * đĩa như một file mồ côi không ai trỏ tới.
 *
 * Đọc thẳng file thay vì hash cấu hình đã parse: mặc định của schema có thể đổi
 * theo phiên bản, còn file thì là thứ hai bên thật sự tranh nhau ghi.
 */
export function featureRevision(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Tìm một kịch bản theo id, trả về kèm tên file và hash nội dung hiện tại.
 *
 * Id là khoá duy nhất đi xuyên toàn hệ thống — report, registry, POM đều dùng
 * nó — nên đây là chỗ duy nhất cần biết id nằm trong file nào.
 */
async function findScenarioById(
  cfg: TestPilotConfig,
  scenarioId: string,
  registry: Registry,
): Promise<{ filename: string; name: string; contentHash: string } | null> {
  if (!existsSync(cfg.paths.features)) return null;
  const files = (await readdir(cfg.paths.features)).filter((f) => f.endsWith('.feature')).sort();
  for (const filename of files) {
    const uri = path.join(cfg.paths.features, filename);
    const content = await readFile(uri, 'utf8');
    try {
      const spec = parseFeature(uri, content, registry);
      const scenario = spec.scenarios.find((item) => item.id === scenarioId);
      if (!scenario) continue;
      const block = scenarioBlocks(content).find((b) => b.name === scenario.name);
      if (!block) return null;
      return { filename, name: scenario.name, contentHash: block.contentHash };
    } catch {
      // File không parse được thì bỏ qua: nó đã hiện lỗi ở chỗ khác rồi.
    }
  }
  return null;
}

export const featureRoutes: RouteTable = {
  'PUT /api/feature': async (req, res, url, ctx) => {
    const { filename, content, create, baseRevision } = await readJson<{
      filename: string; content: string; create?: boolean; baseRevision?: string;
    }>(req);
    const cfg = await loadConfig(ctx.configFile);
    const name = path.basename(filename);
    if (!/^[\w.-]+\.feature$/.test(name)) return json(res, 400, { error: 'Tên file không hợp lệ' });
    const file = path.resolve(cfg.paths.features, name);
    if (!file.startsWith(path.resolve(cfg.paths.features) + path.sep)) return json(res, 403, { error: 'forbidden' });
    // Saving an edit overwrites by design; creating must not. Without this the
    // endpoint answers "new file called X" and "replace everything in X" the
    // same way, and a name collision silently discards someone's scenarios.
    if (create && existsSync(file)) {
      return json(res, 409, { error: `features/${name} đã tồn tại.` });
    }
    if (!create && baseRevision && existsSync(file)) {
      const current = await readFile(file, 'utf8');
      const currentRevision = featureRevision(current);
      if (currentRevision !== baseRevision) {
        return json(res, 409, {
          error:
            `Kịch bản ${name} đã được workflow hoặc người dùng khác cập nhật. ` +
            'Nội dung cũ không được ghi đè. Hãy đóng editor và mở lại bản mới nhất.',
          revision: currentRevision,
        });
      }
    }
    const normalizedTags = normalizeFeatureTags(content);
    // `registryRevision`, không phải `revision`: biến `revision` ở dưới là hash
    // của NỘI DUNG FEATURE vừa lưu, một thứ khác hẳn. Hai phiên bản trong cùng
    // một handler, và đặt trùng tên là cách để lẫn chúng vào nhau.
    const { data: registryData, revision: registryRevision } = await ctx.repos.registry.read();
    const registry = Registry.fromData(registryData);
    // Nở action đã duyệt TRƯỚC khi biên dịch, y như đường "Chuẩn hoá".
    //
    // Thiếu bước này thì một action đã duyệt chỉ chạy được nếu người dùng
    // nhớ bấm "Chuẩn hoá" trước: bấm thẳng "Lưu" thì câu macro không nở, bản
    // nháp biên dịch hỏng, và vòng tự sửa của AI viết lại nó thành câu khác.
    // Cùng một bản nháp, hai nút, hai kết quả — và không ai biết trước.
    const expanded = expandApprovedActions(
      normalizedTags.content,
      await ActionRegistry.load(cfg.paths.actionsDb),
    );
    // Saving from the business editor is a compile operation, not a raw file
    // write. Resolve natural wording and binding mistakes first so the user
    // never has to understand the controlled vocabulary or registry ids.
    const prepared = await prepareExecutableDraft(expanded.content, registry, {
      model: pickModel(cfg.llm.model),
      uri: file,
      maxRepairs: 2,
    });
    const savedContent = prepared.content.trimEnd() + '\n';
    // `prepareExecutableDraft` có thể HỌC element mới trong lúc biên dịch bản
    // nháp, nên đây là một lệnh ghi vào dữ liệu dùng chung — dù người dùng chỉ
    // nghĩ mình đang lưu một file feature.
    try {
      await ctx.repos.registry.write(registry.raw, registryRevision);
    } catch (err) {
      if (err instanceof RevisionConflictError) return json(res, 409, { error: err.message });
      throw err;
    }
    await writeFile(file, savedContent, 'utf8');
    const revision = featureRevision(savedContent);
    // Saving is not approval. New or changed content is pending until the
    // user explicitly accepts that exact hash in Scenario Review.
    const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
    const review = reviews.syncFile(name, savedContent, {
      defaultStatus: 'pending',
      source: 'manual',
    });
    await reviews.save();

    // Remove pending/rejected scenarios from managed specs immediately. Page
    // methods already learned remain reusable, but no unapproved test may be
    // projected into executable generated specs.
    try {
      const pom = await syncPomProject({
        featuresDir: cfg.paths.features,
        registryPath: cfg.paths.registry,
        scenarioReviewPath: cfg.paths.scenarioReviewDb,
      });
      return json(res, 200, {
        ok: true,
        revision,
        review,
        pom: pom.changes,
        ...(pom.warnings ? { pomWarnings: pom.warnings } : {}),
        content: savedContent,
        tagsNormalized: normalizedTags.changed,
        autoRepaired: prepared.repaired,
      });
    } catch (err) {
      return json(res, 200, {
        ok: true,
        revision,
        review,
        content: savedContent,
        tagsNormalized: normalizedTags.changed,
        autoRepaired: prepared.repaired,
        pomWarning: `Đã lưu feature nhưng chưa đồng bộ POM: ${(err as Error).message}`,
      });
    }
  },

  'POST /api/feature/review': async (req, res, url, ctx) => {
    const body = await readJson<{
      filename: string;
      scenarioName: string;
      decision: 'approve' | 'reject';
    }>(req);
    if (!body.filename || !body.scenarioName || !['approve', 'reject'].includes(body.decision)) {
      return json(res, 400, { error: 'Quyết định duyệt kịch bản không hợp lệ.' });
    }
    const cfg = await loadConfig(ctx.configFile);
    const name = path.basename(body.filename);
    if (!/^[\w.-]+\.feature$/.test(name)) return json(res, 400, { error: 'Tên file không hợp lệ' });
    const file = path.resolve(cfg.paths.features, name);
    if (!file.startsWith(path.resolve(cfg.paths.features) + path.sep) || !existsSync(file)) {
      return json(res, 404, { error: 'Không tìm thấy feature file.' });
    }
    const content = await readFile(file, 'utf8');
    const registry = Registry.fromData((await ctx.repos.registry.read()).data);
    // Approval is a stronger gate than saving: the complete file must bind
    // successfully before any one scenario is allowed into execution.
    parseFeature(file, content, registry);
    const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
    reviews.syncFile(name, content, { defaultStatus: 'pending', source: 'manual' });
    const review = reviews.review(name, body.scenarioName, content, body.decision);
    await reviews.save();
    try {
      const pom = await syncPomProject({
        featuresDir: cfg.paths.features,
        registryPath: cfg.paths.registry,
        scenarioReviewPath: cfg.paths.scenarioReviewDb,
      });
      return json(res, 200, {
        ok: true, review, pom: pom.changes,
        ...(pom.warnings ? { pomWarnings: pom.warnings } : {}),
      });
    } catch (err) {
      // The review decision is already durable and the CLI gate reads it
      // directly. Surface projection trouble as a warning instead of making
      // the UI claim that approval itself failed after it was persisted.
      return json(res, 200, {
        ok: true,
        review,
        pomWarning: `Đã lưu quyết định duyệt nhưng chưa đồng bộ POM: ${(err as Error).message}`,
      });
    }
  },

  /**
   * Gắn hoặc gỡ nhãn Known issue cho một kịch bản.
   *
   * Chỉ con người mới gắn được — không có đường nào cho máy tự gắn, và đó là
   * chủ ý: một nhãn tự động sẽ biến thành cách để suite tự làm mình xanh.
   */
  /**
   * Gắn hoặc gỡ nhãn Known issue cho một kịch bản.
   *
   * Khoá theo `scenarioId`, không theo tên file + tên kịch bản. Lý do rất
   * thực tế: người ta biết một kịch bản là Known issue SAU KHI đọc report,
   * mà report chỉ có id — nó không mang theo tên file. Khoá theo id thì cả
   * bảng Kịch bản lẫn report đều gọi được cùng một endpoint.
   *
   * Chỉ con người mới gắn được — không có đường nào cho máy tự gắn, và đó là
   * chủ ý: một nhãn tự động sẽ biến thành cách để suite tự làm mình xanh.
   */
  'POST /api/feature/known-issue': async (req, res, url, ctx) => {
    const body = await readJson<{ scenarioId: string; note?: string; remove?: boolean }>(req);
    if (!body.scenarioId) return json(res, 400, { error: 'Thiếu scenarioId.' });

    const cfg = await loadConfig(ctx.configFile);
    const known = await KnownIssueStore.load(cfg.paths.knownIssuesDb);
    if (body.remove) {
      const removed = known.unmark(body.scenarioId);
      await known.save();
      return json(res, 200, { ok: true, removed });
    }

    const note = (body.note ?? '').trim();
    if (!note) {
      // Một nhãn không kèm lý do thì năm sau không ai giải thích được vì sao
      // kịch bản này được miễn.
      return json(res, 400, { error: 'Hãy ghi lý do vì sao sản phẩm chưa đáp ứng.' });
    }

    const found = await findScenarioById(
      cfg,
      body.scenarioId,
      Registry.fromData((await ctx.repos.registry.read()).data),
    );
    if (!found) return json(res, 404, { error: 'Không tìm thấy kịch bản nào mang id đó.' });
    const issue = known.mark({
      id: body.scenarioId,
      filename: found.filename,
      scenarioName: found.name,
      contentHash: found.contentHash,
      note,
    });
    await known.save();
    return json(res, 200, { ok: true, issue });
  },

  'POST /api/feature/review-bulk': async (req, res, url, ctx) => {
    const body = await readJson<{
      items: Array<{ filename: string; scenarioName: string }>;
      decision: 'approve' | 'reject';
    }>(req);
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 5_000
        || !['approve', 'reject'].includes(body.decision)) {
      return json(res, 400, { error: 'Danh sách kịch bản cần duyệt không hợp lệ.' });
    }

    const cfg = await loadConfig(ctx.configFile);
    const registry = Registry.fromData((await ctx.repos.registry.read()).data);
    const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
    const files = new Map<string, string>();
    const unique = new Map<string, { filename: string; scenarioName: string }>();

    for (const item of body.items) {
      const name = path.basename(item.filename ?? '');
      if (!/^[\w.-]+\.feature$/.test(name) || !item.scenarioName) {
        return json(res, 400, { error: 'Có kịch bản hoặc feature file không hợp lệ.' });
      }
      const file = path.resolve(cfg.paths.features, name);
      if (!file.startsWith(path.resolve(cfg.paths.features) + path.sep) || !existsSync(file)) {
        return json(res, 404, { error: `Không tìm thấy feature file ${name}.` });
      }
      if (!files.has(name)) {
        const content = await readFile(file, 'utf8');
        parseFeature(file, content, registry);
        files.set(name, content);
        reviews.syncFile(name, content, { defaultStatus: 'pending', source: 'manual' });
      }
      unique.set(`${name}::${item.scenarioName}`, { filename: name, scenarioName: item.scenarioName });
    }

    const reviewed = [];
    for (const item of unique.values()) {
      reviewed.push(reviews.review(
        item.filename,
        item.scenarioName,
        files.get(item.filename)!,
        body.decision,
      ));
    }
    await reviews.save();

    try {
      const pom = await syncPomProject({
        featuresDir: cfg.paths.features,
        registryPath: cfg.paths.registry,
        scenarioReviewPath: cfg.paths.scenarioReviewDb,
      });
      return json(res, 200, {
        ok: true, reviewed: reviewed.length, reviews: reviewed, pom: pom.changes,
        ...(pom.warnings ? { pomWarnings: pom.warnings } : {}),
      });
    } catch (err) {
      return json(res, 200, {
        ok: true,
        reviewed: reviewed.length,
        reviews: reviewed,
        pomWarning: `Đã duyệt ${reviewed.length} kịch bản nhưng chưa đồng bộ POM: ${(err as Error).message}`,
      });
    }
  },

  'POST /api/feature/normalize': async (req, res, _url, ctx) => {
    const { content } = await readJson<{ content: string }>(req);
    const cfg = await loadConfig(ctx.configFile);
    const registry = Registry.fromData((await ctx.repos.registry.read()).data);
    const actions = await ActionRegistry.load(cfg.paths.actionsDb);
    return json(res, 200, await normalizeFeatureDraft(content, registry, actions, pickModel(cfg.llm.model)));
  },
};
