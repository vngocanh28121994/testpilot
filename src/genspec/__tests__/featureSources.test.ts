import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { SourceDoc } from '../../ingest/types.js';
import {
  canonicalSourceRef,
  FeatureSourceStore,
  featureSourceKey,
  requirementSourceKey,
} from '../featureSources.js';

const doc = (ref: string, title = 'Chức năng Thêm mã cổ phiếu'): SourceDoc => ({
  kind: 'confluence',
  ref,
  title,
  text: 'Sau khi xoá, mã không ảnh hưởng tới danh mục khác',
  fetchedAt: '2026-09-13T00:00:00.000Z',
});

describe('canonical ownership of generated features', () => {
  it('uses the Confluence page id, not its mutable title or URL slug', () => {
    const a = doc('https://digital-horus.atlassian.net/wiki/spaces/SD/pages/196994/Chuc-nang-cu');
    const b = doc('https://digital-horus.atlassian.net/wiki/spaces/SD/pages/196994/Ten-hoan-toan-moi?x=1');
    assert.equal(featureSourceKey([a]), featureSourceKey([b]));
    assert.equal(canonicalSourceRef(a.ref), 'confluence:digital-horus.atlassian.net:196994');
  });

  it('does not mint a new feature when the root document discovers linked evidence', () => {
    const root = doc('https://digital-horus.atlassian.net/wiki/pages/196994/Stock');
    const linked = doc('https://figma.com/design/abc123/Board');
    assert.equal(featureSourceKey([root]), featureSourceKey([root, linked]));
  });

  it('keeps the first canonical file when a later model chooses another name', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'feature-source-'));
    const file = path.join(dir, 'feature-sources.json');
    const first = await FeatureSourceStore.load(file);
    first.bind([doc('https://digital-horus.atlassian.net/wiki/pages/196994/Old')], 'them-ma-co-phieu.feature', 'Thêm mã cổ phiếu');
    await first.save();

    const later = await FeatureSourceStore.load(file);
    const owned = later.entry([doc('https://digital-horus.atlassian.net/wiki/pages/196994/New')]);
    assert.equal(owned?.file, 'them-ma-co-phieu.feature');
    later.bind([doc('https://digital-horus.atlassian.net/wiki/pages/196994/New')], 'ten-ai-vua-nghi-ra.feature', 'Tên AI vừa nghĩ ra');
    await later.save();

    const saved = JSON.parse(await readFile(file, 'utf8')) as { entries: Record<string, { file: string }> };
    assert.equal(Object.values(saved.entries)[0]?.file, 'them-ma-co-phieu.feature');
  });

  it('gives the same requirement a stable key when source numbering changes', () => {
    const ref = 'https://digital-horus.atlassian.net/wiki/pages/196994/X';
    assert.equal(
      requirementSourceKey(ref, '  Mã KHÔNG ảnh hưởng tới danh mục khác  '),
      requirementSourceKey(ref, 'Mã KHÔNG  ảnh hưởng tới danh mục khác'),
    );
  });
});
