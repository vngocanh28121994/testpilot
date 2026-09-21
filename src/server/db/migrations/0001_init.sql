-- Bộ bảng đầu tiên của control plane.
--
-- Viết bằng phần giao nhau của Postgres và SQLite, cộng ba chỗ thay thế mà
-- `dialect.ts` điền: {{json}}, {{timestamp}}, {{bool}}. Vì sao phải chạy được
-- cả hai: chế độ `embedded` (bản local hôm nay) không được bắt người dùng cài
-- Postgres chỉ để mở một công cụ chạy trên máy họ — xem mục 9 của tài liệu
-- kiến trúc. Một schema, hai nơi lưu.
--
-- Quy ước: mọi mốc thời gian là chuỗi ISO-8601 UTC do ứng dụng sinh, không
-- dùng NOW() của DB. Hai DB hiểu NOW() khác nhau, và một mốc do runner ở múi
-- giờ khác sinh ra thì DB không biết gì để mà đúng.

CREATE TABLE IF NOT EXISTS org (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  {{timestamp}} NOT NULL
);

CREATE TABLE IF NOT EXISTS app_user (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  {{timestamp}} NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email ON app_user (email);

-- Một người có thể ở nhiều tổ chức, với vai khác nhau ở mỗi nơi.
CREATE TABLE IF NOT EXISTS membership (
  org_id   TEXT NOT NULL REFERENCES org (id),
  user_id  TEXT NOT NULL REFERENCES app_user (id),
  role     TEXT NOT NULL CHECK (role IN ('admin', 'maintainer', 'runner_user', 'viewer')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS runner (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES org (id),
  name              TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('embedded', 'lab', 'personal', 'farm')),
  -- Chủ sở hữu: có với runner `personal`, rỗng với runner của tổ chức.
  owner_user_id     TEXT REFERENCES app_user (id),
  os                TEXT NOT NULL,
  arch              TEXT NOT NULL,
  protocol_version  TEXT NOT NULL,
  agent_version     TEXT NOT NULL,
  -- Chỉ giữ hash. Token hiện một lần lúc tạo rồi không bao giờ đọc lại được.
  token_hash        TEXT NOT NULL,
  visibility        TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
  state             TEXT NOT NULL CHECK (state IN ('online', 'offline', 'draining')),
  last_seen_at      {{timestamp}},
  created_at        {{timestamp}} NOT NULL
);
CREATE INDEX IF NOT EXISTS runner_by_org ON runner (org_id, state);

CREATE TABLE IF NOT EXISTS runner_capability (
  runner_id  TEXT NOT NULL REFERENCES runner (id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (runner_id, key)
);

CREATE TABLE IF NOT EXISTS device (
  id            TEXT PRIMARY KEY,
  runner_id     TEXT NOT NULL REFERENCES runner (id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL REFERENCES org (id),
  platform      TEXT NOT NULL CHECK (platform IN ('web', 'android', 'ios')),
  name          TEXT NOT NULL,
  udid          TEXT,
  os_version    TEXT,
  visibility    TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
  state         TEXT NOT NULL CHECK (state IN ('idle', 'leased', 'busy', 'offline', 'quarantined')),
  -- Vì sao không dùng được. Bắt buộc về mặt quy ước với offline/quarantined:
  -- một thiết bị biến mất mà không nói lý do là thứ khiến người ta đi soi cáp.
  state_reason  TEXT,
  updated_at    {{timestamp}} NOT NULL
);
CREATE INDEX IF NOT EXISTS device_by_org_state ON device (org_id, state);

CREATE TABLE IF NOT EXISTS device_tag (
  device_id  TEXT NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (device_id, key)
);

CREATE TABLE IF NOT EXISTS job (
  id                   TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL REFERENCES org (id),
  created_by           TEXT NOT NULL REFERENCES app_user (id),
  kind                 TEXT NOT NULL CHECK (
                         kind IN ('run_suite', 'gen', 'workflow', 'pom', 'crawl', 'prereq', 'device_scan')
                       ),
  state                TEXT NOT NULL CHECK (
                         state IN ('queued', 'assigned', 'running', 'succeeded',
                                   'failed', 'cancelled', 'interrupted')
                       ),
  priority             INTEGER NOT NULL,
  requested_at         {{timestamp}} NOT NULL,
  started_at           {{timestamp}},
  finished_at          {{timestamp}},
  runner_id            TEXT REFERENCES runner (id),
  payload              {{json}} NOT NULL,
  result               {{json}},
  attempt              INTEGER NOT NULL,
  cancel_requested_at  {{timestamp}}
);
-- Truy vấn nóng nhất của scheduler: job đang chờ của một tổ chức, ưu tiên trước.
CREATE INDEX IF NOT EXISTS job_queue ON job (org_id, state, priority, requested_at);

-- Bảng nối thay cho mảng: Postgres có device_ids[], SQLite không, và một lượt
-- chạy nhiều thiết bị là chuyện bình thường chứ không phải ngoại lệ.
CREATE TABLE IF NOT EXISTS job_device (
  job_id     TEXT NOT NULL REFERENCES job (id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL REFERENCES device (id),
  PRIMARY KEY (job_id, device_id)
);

-- Dòng đời của job. `seq` là thứ cho phép UI nối lại sau khi server restart
-- hoặc tab đóng; không có nó thì log chỉ tồn tại trên đúng đường dây SSE đã mở.
CREATE TABLE IF NOT EXISTS job_event (
  job_id   TEXT NOT NULL REFERENCES job (id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  at       {{timestamp}} NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('log', 'stage', 'artifact', 'warning')),
  payload  {{json}} NOT NULL,
  PRIMARY KEY (job_id, seq)
);

-- Giữ chỗ thiết bị.
--
-- `UNIQUE (device_id)` là toàn bộ cơ chế loại trừ: một chiếc máy chỉ chạy được
-- một test tại một thời điểm, và điều đó phải do DB bảo đảm chứ không do mã
-- scheduler nhớ giữ. Hai scheduler chạy song song thì bản thua nhận lỗi ràng
-- buộc, không nhận một chiếc điện thoại đang bận.
CREATE TABLE IF NOT EXISTS lease (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  job_id       TEXT NOT NULL REFERENCES job (id) ON DELETE CASCADE,
  acquired_at  {{timestamp}} NOT NULL,
  expires_at   {{timestamp}} NOT NULL,
  renewed_at   {{timestamp}}
);
CREATE UNIQUE INDEX IF NOT EXISTS lease_one_per_device ON lease (device_id);
CREATE INDEX IF NOT EXISTS lease_expiry ON lease (expires_at);

CREATE TABLE IF NOT EXISTS artifact (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES job (id) ON DELETE CASCADE,
  org_id      TEXT NOT NULL REFERENCES org (id),
  kind        TEXT NOT NULL CHECK (
                kind IN ('report', 'screenshot', 'video', 'trace', 'log', 'apk')
              ),
  storage_key TEXT NOT NULL,
  bytes       INTEGER,
  sha256      TEXT,
  created_at  {{timestamp}} NOT NULL,
  expires_at  {{timestamp}}
);
CREATE INDEX IF NOT EXISTS artifact_by_job ON artifact (job_id);

-- Dữ liệu dùng chung, một dòng cho mỗi object có phiên bản.
-- `kind` khớp với `src/core/stores.ts`; store scope `device` KHÔNG có mặt ở đây,
-- và đó là chủ ý: cache của một chiếc máy không thuộc về chỗ dùng chung.
CREATE TABLE IF NOT EXISTS registry_object (
  org_id      TEXT NOT NULL REFERENCES org (id),
  kind        TEXT NOT NULL,
  key         TEXT NOT NULL,
  revision    TEXT NOT NULL,
  body        {{json}} NOT NULL,
  updated_by  TEXT REFERENCES app_user (id),
  updated_at  {{timestamp}} NOT NULL,
  PRIMARY KEY (org_id, kind, key)
);

-- Runner ĐỀ XUẤT, không ghi thẳng. Xem mục 4b của tài liệu kiến trúc: nếu
-- runner ghi thẳng thì máy A heal ra một locator, máy B heal ra locator khác,
-- và bản ghi sau xoá bản trước.
CREATE TABLE IF NOT EXISTS registry_proposal (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES org (id),
  kind           TEXT NOT NULL,
  key            TEXT NOT NULL,
  base_revision  TEXT,
  patch          {{json}} NOT NULL,
  source_job_id  TEXT REFERENCES job (id),
  state          TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'superseded')),
  reviewed_by    TEXT REFERENCES app_user (id),
  reviewed_at    {{timestamp}},
  created_at     {{timestamp}} NOT NULL
);
CREATE INDEX IF NOT EXISTS proposal_pending ON registry_proposal (org_id, state, created_at);

-- Chỉ con trỏ tới secret manager. Giá trị không bao giờ nằm trong bảng này.
CREATE TABLE IF NOT EXISTS secret_ref (
  org_id       TEXT NOT NULL REFERENCES org (id),
  name         TEXT NOT NULL,
  backend      TEXT NOT NULL,
  backend_key  TEXT NOT NULL,
  updated_by   TEXT REFERENCES app_user (id),
  updated_at   {{timestamp}} NOT NULL,
  PRIMARY KEY (org_id, name)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      TEXT PRIMARY KEY,
  org_id  TEXT NOT NULL REFERENCES org (id),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT NOT NULL,
  at      {{timestamp}} NOT NULL,
  detail  {{json}}
);
CREATE INDEX IF NOT EXISTS audit_by_org_time ON audit_log (org_id, at);
