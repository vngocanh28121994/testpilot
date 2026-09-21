# Bản đồ route — danh sách việc của P1

Đây **không phải tài liệu để đọc**, mà là danh sách việc: 52 route trong
`handle()` của [src/ui/server.ts](src/ui/server.ts), mỗi route thuộc về đâu sau khi tách, và nằm ở
file nào. Kiến trúc: [FARM-ARCHITECTURE.md](FARM-ARCHITECTURE.md) · Kế hoạch: [FARM-PLAN.md](FARM-PLAN.md).

## Ký hiệu

| Ký hiệu | Nghĩa |
|---|---|
| **CP** | Control plane. Đọc/ghi DB, không `spawn` gì cả |
| **JOB** | Thành job: API chỉ tạo job và trả `jobId` (CP), runner thực thi |
| **R** | Runner. Chạm thiết bị hoặc tiến trình cục bộ; **không** được tồn tại trên control plane |
| **LOCAL** | Chỉ còn ở chế độ `embedded`. Chế độ server phải trả 404 |

Đếm: **CP 34 · JOB 8 · R 9 · LOCAL 1**.

> **Sửa ngày 2026-09-21 (P1.2 nhóm 5).** `POST /api/builds/source` từng bị xếp vào **R** vì cái tên
> nghe như đi đọc thiết bị. Đọc kỹ thì nó chỉ ghi một cờ `useInstalledApp` vào config — thuần
> control plane. Phân loại sai theo hướng ấy sẽ kéo cả `saveConfig` sang máy người dùng, nên sửa
> bản đồ thay vì chuyển nhầm route.

---

## CP — `src/server/routes/`

### `state.ts`
| Dòng | Route | Ghi chú khi chuyển |
|---|---|---|
| 228 | `GET /api/state` | Payload lớn nhất và là thứ mọi màn hình dựa vào. Đọc từ DB thay vì quét đĩa; `configRevision` giữ nguyên ý nghĩa |

### `config.ts`
| Dòng | Route | Ghi chú |
|---|---|---|
| 231 | `PUT /api/config` | Đã có `baseRevision` → 409. Giữ nguyên mẫu ấy cho mọi ghi khác |
| 259 | `POST /api/model-key` | Ghi vào secret manager theo `org_id`, không ghi `.testpilot.secrets.json` |
| 286 | `GET /api/confluence-auth` | Chỉ trả boolean, giữ nguyên |
| 295 | `POST /api/confluence-auth` | **Bỏ `process.env.CONFLUENCE_API_TOKEN = token`** ([:307](src/ui/server.ts)) — token của một người thành token của cả tiến trình |
| 314 | `GET /api/models` | Danh sách model; cache theo tổ chức |
| 311 | `POST /api/mcp/tools` | Dò MCP. Chạy trên CP được vì chỉ gọi mạng, không chạm thiết bị |

### `feature.ts`
| Dòng | Route | Ghi chú |
|---|---|---|
| 593 | `PUT /api/feature` | **Mẫu chuẩn**: đã nhận `baseRevision`, đã trả 409 |
| 685 | `POST /api/feature/review` | Cần vai `maintainer` |
| 749 | `POST /api/feature/known-issue` | `maintainer` |
| 781 | `POST /api/feature/review-bulk` | `maintainer`. Ghi nhiều object → một transaction |
| 956 | `POST /api/feature/normalize` | Gọi LLM, không chạm thiết bị |
| 928 | `GET /api/vocabulary` | Tĩnh |
| 964 | `GET /api/actions` | Từ DB |
| 970 | `POST /api/actions/review` | `maintainer` |

### `registry.ts` (mới — chưa có route tương ứng hôm nay)
| Route | Ghi chú |
|---|---|
| `GET/PUT /api/registry/elements` | Tách khỏi `state`; mọi ghi kèm `baseRevision` |
| `GET /api/registry/proposals`, `POST .../review` | Đề xuất từ runner (P4.4) |

### `healing.ts`
| Dòng | Route | Ghi chú |
|---|---|---|
| 322 | `GET /api/healing` | Đọc sổ append-only theo `org_id` |
| 327 | `POST /api/healing/review` | Trở thành đường duyệt `registry_proposal` |
| 362 | `POST /api/healing/duplicate` | Như trên |

### `run.ts` (phần đọc)
| Dòng | Route | Ghi chú |
|---|---|---|
| 513 | `GET /api/run/active` | Đọc bảng `job` thay vì RAM ([activeRuns.ts](src/ui/activeRuns.ts)) |
| 522 | `GET /api/run/attach` | **Thêm `since=<seq>`** — đây là đường nối lại sau khi server restart |
| 1017 | `GET /api/run/log` | Đọc `job_event` |
| 317 | `GET /api/history` | Bảng `job` |

### `report.ts`
| Dòng | Route | Ghi chú |
|---|---|---|
| — | `GET /runs/*`, `/reports/*`, `/artifacts/*` ([:1218](src/ui/server.ts)) | Chuyển sang link có chữ ký của S3. **Giữ nguyên kiểm tra path traversal** đang có, và viết test cho nó |
| — | SPA fallback ([:1227](src/ui/server.ts)) | Giữ nguyên |

### `device.ts` (mới)
| Route | Ghi chú |
|---|---|
| `GET /api/devices` | Hợp nhất báo cáo `devices` từ mọi runner |
| `POST /api/devices/:id/quarantine` · `/release` | Việc của màn quản lý thiết bị (P3.5) |
| `GET /api/runners`, `POST /api/runners/token` | Đăng ký runner (P4.1) |

### `farm.ts` (chỉ phần đọc AWS)
| Dòng | Route | Ghi chú |
|---|---|---|
| 1062 | `GET /api/aws` | Trạng thái credential; đổi sang IAM role |
| 1065 | `GET /api/farm/projects` | Gọi AWS SDK, không chạm thiết bị → ở lại CP |
| 1068 | `GET /api/farm/pools` | CP |
| 1075 | `GET /api/farm/devices` | CP |
| 1080 | `POST /api/farm/pool` | CP |

### `builds.ts`
| Dòng | Route | Ghi chú |
|---|---|---|
| 853 | `POST /api/app/upload` | Nhận APK/IPA → **S3**, không ghi đĩa server. Runner tải về khi nhận job |
| 992 | `POST /api/builds/source` | ✅ đã chuyển sang `routes/builds.ts`. Chỉ ghi cờ `useInstalledApp` vào config |
| 982 | `GET /api/builds` | Danh mục build trong DB + S3, thay cho việc quét đĩa |

---

## JOB — API tạo job (CP), runner thực thi

| Dòng | Route | `kind` | Ghi chú |
|---|---|---|---|
| 544 | `POST /api/run` | `run_suite` | **Đổi nghĩa**: trả `jobId` thay vì stream. UI tạo job rồi `attach` — `streamJob()` đã hỗ trợ `GET` ([ui/src/lib/streamJob.ts](ui/src/lib/streamJob.ts)) |
| 590 | `POST /api/run/stop` | — | Thành `job.cancel` qua relay |
| 417 | `POST /api/gen` | `gen` | Không chạm thiết bị, nhưng vẫn `spawn` CLI → là job. Chạy được trên runner phía server |
| 408 | `POST /api/studio/save` | `gen` | Cùng đường với `gen` |
| 438 | `POST /api/workflow/answers` | `workflow` | Orchestration nhiều chặng ([:2377](src/ui/server.ts)) |
| 461 | `POST /api/workflow/complete` | `workflow` | |
| 490 | `POST /api/workflow/abandon` | — | Huỷ job |
| 425 | `GET /api/workflow/questions` | — | Thuần đọc → thực ra là **CP**, để ở đây cho liền mạch |
| 1096 | `POST /api/farm/run` | `run_suite` | Runner `mode=farm` |
| 1128 | `POST /api/farm/pull` | `farm_pull` | |

---

## R — `src/runner/`, tuyệt đối không để lại trên control plane

Mười route này là lý do mục 12 của tài liệu kiến trúc tồn tại: chúng `spawn` tiến trình
trên chính máy chạy chúng.

| Dòng | Route | Chuyển thành |
|---|---|---|
| 1032 | `GET /api/preflight` | Báo cáo `hello`/`devices` của runner; CP chỉ hiển thị lại |
| 1162 | `POST /api/prereq/appium` | job `prereq`, hoặc việc nội bộ của runner |
| 1165 | `POST /api/prereq/appium/restart` | như trên |
| 1168 | `GET /api/prereq/appium/status` | trường trong `heartbeat` |
| 1171 | `GET /api/prereq/adb` | trường trong `devices` |
| 1174 | `GET /api/prereq/xcode` | `runner_capability` |
| 1177 | `GET /api/prereq/ios-devices` | `devices` |
| 1188 | `GET /api/prereq/ios-names` | `devices` |
| 1206 | `POST /api/prereq/ios-trust` | job `prereq` — chỉ chủ runner được gọi |
| 1209 | `POST /api/prereq/driver` | job `prereq`. Hôm nay là `spawn('appium', ['driver','install', …])` ([:4249](src/ui/server.ts)) — phải đi qua sandbox danh sách cho phép |

---

## LOCAL — chỉ còn ở chế độ embedded

| Dòng | Route | Vì sao |
|---|---|---|
| 1203 | `POST /api/prereq/ios-tunnel` | Mở **Terminal của máy** bằng `osascript` ([:4082](src/ui/server.ts)). Trên server nó vô nghĩa, và nếu chạy được thì là lỗ hổng |
| 1057 | `POST /api/aws/login` | SSO tương tác, chờ người bấm. Chế độ server dùng IAM role |

---

## Thứ tự làm ở P1.2

Tách theo mức rủi ro tăng dần, mỗi file một commit, chạy `npm run typecheck && npm test` sau
mỗi bước:

1. `vocabulary`, `actions`, `models`, `history` — thuần đọc, không state.
2. `config`, `confluence-auth`, `model-key` — có ghi, nhưng không stream.
3. `feature*`, `healing*`, `studio` — ghi nhiều, đã có mẫu `baseRevision`.
4. `builds`, `app/upload` — có file lớn và `Range`.
5. `prereq/*`, `preflight` — **cả cụm sang `src/runner/`**, đây là bước tách thật sự.
6. `run`, `run/stop`, `run/active`, `run/attach`, `run/log` — đụng tới SSE và vòng đời job.
7. `farm/*`, `aws/*` — cuối, vì phụ thuộc AWS và khó test nhất.
8. `workflow/*` — cuối cùng, vì nó gọi tất cả những thứ trên.

Điều kiện hoàn thành cả P1.2: `src/ui/server.ts` không còn `case` nào, và
`grep -n "child_process" src/server/` không ra kết quả.
