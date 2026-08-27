# Kế hoạch nâng cấp TestPilot UI theo chuẩn `sen/frontend`

**Đối tượng:** `src/ui/` của TestPilot (`/Users/toanphung/public-project/testpilot`)
**Chuẩn tham chiếu:** `/Users/toanphung/Documents/Source/Real/sen/frontend`
**Chiến lược:** Strangler — dựng app mới song song, cuốn chiếu từng trang, UI cũ không bao giờ gãy.
**Trạng thái:** đã review kiến trúc, đã đối chiếu từng con số với mã nguồn thật (xem §12 — nhật ký kiểm chứng).

---

## 1. Tóm tắt điều hành

TestPilot có một bảng điều khiển khá lớn nhưng viết bằng vanilla JS không bundler: **5.826 dòng
`app.js`**, **2.018 dòng CSS**, **1.042 dòng HTML**, **12 trang**, **0 test FE**, **0 lint**, **0 type**.
Backend của nó (`src/ui/server.ts`, 3.329 dòng, 41 route) thì lành mạnh và **gần như không cần đụng tới**
— ngoại lệ duy nhất là tầng contract type ở §6.1b và một nhánh static ở §5.2.

Kế hoạch này thay tầng client bằng đúng stack mà `sen/frontend` đang dùng — Vite + React 19 +
TanStack Router/Query + Tailwind 4 + shadcn/ui + Vitest + Playwright + ESLint/Prettier/Husky — theo
lối cuốn chiếu: app mới mount ở `/next/`, app cũ giữ nguyên ở `/`, cả hai gọi chung một tầng `/api/*`.
Chỉ khi trang cuối cùng sang bờ mới thì mới đổi chỗ.

**Ước lượng: 25–34 ngày công**, chia 7 phase. Phase 0–3 (nền móng, ~8–11 ngày) là phần bắt buộc phải
xong trước; từ Phase 4 trở đi có thể chia người làm song song theo trang.

> **Đọc §6 và §11 trước khi gõ dòng code đầu tiên.** §6 là các quyết định cố ý lệch khỏi `sen`; §11 là
> bộ khung file + đoạn code mẫu đủ để bắt đầu ngay. Bốn hạng mục đánh dấu **⛔ Chặn** trong §6 sẽ làm
> hỏng build nếu bỏ qua — chúng đã được kiểm chứng bằng `tsc` thật, không phải phỏng đoán.

---

## 2. Hiện trạng — đo đạc

### 2.1 Kích thước

| File | Dòng | Ghi chú |
|---|---:|---|
| `src/ui/server.ts` | 3.329 | node:http thuần, 41 route, **giữ nguyên trừ §6.1b** |
| `src/ui/public/app.js` | 5.826 | ES module, 176 hàm, ~30 biến `let` toàn cục |
| `src/ui/public/index.html` | 1.042 | 12 `<section data-page>` ẩn/hiện bằng `hidden` |
| `src/ui/public/style.css` | 2.018 | 1 bộ token, **chỉ light theme** |
| `flatpickr.min.js/.css` | — | date-picker vendor sẵn; **chỉ 3 lần dùng** trong `app.js` |

### 2.2 Phân bổ `app.js` theo trang

Đọc từ các banner section trong file — đây là cơ sở để ước lượng công:

| Vùng | Dòng | Số dòng | Độ khó |
|---|---|---:|---|
| Boot / chrome / nav / router | 116–332 | 216 | thay bằng TanStack Router |
| `api()` + state toàn cục | 332–360 | 28 | thay bằng TanStack Query |
| **Scenario Studio** | 360–951 | **591** | Cao — form config + env editor + accounts + sources |
| Recent scenarios / history | 951–1074 | 123 | Thấp |
| **Healing Center** | 1074–1261 | **187** | Thấp — bảng + 1 mutation |
| Local Runner history | 1261–1370 | 109 | Thấp |
| Device Farm history | 1370–1444 | 74 | Thấp |
| Farm Run Detail | 1444–1562 | 118 | Trung bình — video player, Range |
| **Dashboard** | 1562–1601 | **39** | Rất thấp |
| **Scenario Review** | 1601–3540 | **1.939** | **Rất cao** — bảng, filter, tag, inline editor, bulk action, phân trang |
| Device picker | 3540–3585 | 45 | Thấp — component dùng chung |
| **Bản build** | 3585–4173 | **588** | Trung bình — upload file |
| **E2E runner + reports** | 4173–5061 | **888** | Cao — SSE, log stream |
| **AWS Device Farm** | 5061–5484 | **423** | Cao — pool, upload, log stream |
| Settings | 5484–5682 | 198 | Thấp |
| SSE over POST | 5682–5826 | 144 | Giữ logic, bọc thành hook |

### 2.3 Backend đã có sẵn — và những ràng buộc nó áp lên FE

- **41 route** `/api/*`, dispatch bằng `switch` trên chuỗi `` `${req.method} ${url.pathname}` ``
  (`server.ts:123`). Không có route động dạng `/:id` — tham số đi qua query string.
- **9 route dạng SSE-over-POST** qua helper `stream()` (`server.ts:2668`): `/api/gen`, `/api/run`,
  `/api/farm/run`, `/api/aws/login`, `/api/prereq/appium`, `/api/prereq/appium/restart`,
  `/api/prereq/driver`, `/api/workflow/complete`, và luồng continue-workflow. Dùng POST nên
  **`EventSource` không dùng được** — đây là ràng buộc thiết kế, không phải lựa chọn.
  Khung phát ra 4 loại event: `log` (string), `run` (WorkflowRun snapshot), `error` (string), `done` (`{ok}`).
- **`POST /api/app/upload` KHÔNG phải multipart.** Nó `pipeline(req, createWriteStream(temp))` —
  tức là **body thô của request chính là nội dung file**, còn `platform` / `filename` / `env` /
  `persist` nằm ở **query string** (`server.ts:537–590`). Gửi `FormData` sẽ ghi cả phần boundary
  của multipart vào file `.apk`. Xem §6.6.
- **Lỗi có hai hình dạng.** `api()` hiện tại (`app.js:335`) đọc `data.issues ? data.issues.join('\n')
  : (data.error ?? res.statusText)`. `PUT /api/config` trả mảng `issues` từ zod (`server.ts:135`);
  các route khác trả `{ error }`. Tầng client mới **phải giữ cả hai nhánh**.
- Static: `/runs/`, `/reports/`, `/artifacts/` (hardcode, `server.ts:773`) có hỗ trợ HTTP **Range**
  (video tua được). `serveFile()` gắn `cache-control: no-store` **cho mọi file** — xem R12.
- `PUT /api/config` đã validate bằng `ConfigSchema` (zod) ở server.
- **`server.ts` không `export` bất kỳ ký hiệu nào.** Mọi handler là hàm private, trả về object
  literal ẩn danh. Đây là gốc rễ của §6.1b.
- Port mặc định `4300`, đọc từ `process.env.TESTPILOT_UI_PORT` (`server.ts:86`).

---

## 3. Chuẩn đích — trích từ `sen/frontend`

| Hạng mục | `sen/frontend` dùng gì |
|---|---|
| Build | **Vite 8**, `base: './'` khi build, alias `@` → `./src`, dev proxy sang backend `:8888` |
| UI | **React 19.2** + `@vitejs/plugin-react` |
| Router | **TanStack Router** file-based, `autoCodeSplitting`, `routeTree.gen.ts` **có commit vào git** |
| Server state | **TanStack Query 5** + devtools; `queryClient` có policy riêng cho lỗi 401 |
| Client state | **Zustand 5** (`stores/{app,auth,analysis}Store.ts`) |
| Styling | **Tailwind 4** qua `@tailwindcss/vite` + **shadcn/ui** (`new-york`, base `slate`, `cssVariables: true`), CSS gốc ở **`src/index.css`**, `components.json#tailwind.config` để **rỗng** (Tailwind 4 không có file config) |
| Component | Radix UI + `lucide-react` + `class-variance-authority` + `tailwind-merge` |
| Bảng | **TanStack Table 8** (`components/data-table/`) |
| Chart | `recharts` |
| Toast | `sonner` |
| Date | `react-day-picker` + `date-fns` |
| Unit test | **Vitest 4** + jsdom + Testing Library + `@vitest/coverage-v8` |
| Mock API | **MSW 2** — `src/test/mocks/{server.ts,handlers/*}` |
| Property test | `fast-check` |
| E2E | **Playwright** — `testDir: ./e2e`, `webServer` tự bật dev server ở cổng 4173 |
| Lint | **ESLint 10** flat config: `js.recommended` + `tseslint.recommended` + `react-hooks` + `react-refresh` |
| Format | **Prettier 3** — `semi`, `singleQuote`, `trailingComma: all`, `printWidth: 100`, `tabWidth: 2`, `prettier-plugin-tailwindcss` |
| Hook | **Husky 9** + **lint-staged 15** ở `pre-commit` |
| TS | project references: `tsconfig.json` (solution) → `tsconfig.app.json` + `tsconfig.node.json`; `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax` |
| API client | `@hey-api/openapi-ts` sinh từ `openapi.json` của FastAPI |

### 3.1 Quy ước thư mục của `sen/frontend`

```
src/
  index.css        ← ĐÂY là file Tailwind 4 + token shadcn (không phải styles/)
  main.tsx         ← createRouter({ basepath }) + QueryClientProvider + ThemeProvider
  routeTree.gen.ts ← sinh tự động, CÓ commit
  components/
    ui/            ← shadcn primitives (sinh bằng CLI, không sửa tay)
    layout/        ← header.tsx, main.tsx, Sidebar khung trang
    data-table/    ← TanStack Table dùng chung
    <Feature>/     ← component có state riêng + __tests__/
  hooks/           ← hook dùng chung toàn app  + __tests__/
  lib/             ← thuần logic, không JSX (queryClient, config, datetime, number, utils) + __tests__/
  pages/           ← trang lớn có thư mục con hooks/ + __tests__/
  panels/<Name>/   ← đơn vị màn hình chính: index.tsx + <Name>Table.tsx + columns.tsx
                     + hooks/use*.ts (một file một hook) + __tests__/
  routes/          ← file-based routing; route file chỉ ghép Header + Main + <Panel/>, KHÔNG chứa logic
  stores/          ← zustand + __tests__/
  styles/          ← CSS phụ trợ lẻ (sen chỉ có 1 file override cho highlight.js)
  test/            ← setup.ts, utils.tsx (renderWithProviders/createQueryWrapper), mocks/
```

Ba điểm cốt lõi của quy ước này:

1. **`__tests__/` nằm cạnh code nó test.**
2. **`panels/<Name>/hooks/` chứa hook chỉ thuộc về panel đó** — hook dùng chung mới lên `src/hooks/`.
3. **`routes/*.tsx` là lớp mỏng.** Xem `sen/frontend/src/routes/_authenticated/sentry.tsx`: nó chỉ
   khai báo `validateSearch` và render `<Header>…</Header><Main><Panel/></Main>`. Toàn bộ logic ở
   `panels/`. Giữ đúng kỷ luật này thì `routeTree.gen.ts` sinh lại không bao giờ đụng logic.

### 3.2 Ba chỗ trong `sen` KHÔNG nên copy nguyên

| Chỗ | Vấn đề | Làm gì ở TestPilot |
|---|---|---|
| `tsconfig.app.json#exclude` loại `src/test/**` và `src/**/__tests__/**` | `tsc -b` **không bao giờ typecheck file test**. DoD "không còn `any`" thành vô nghĩa ở đúng chỗ dễ sinh `any` nhất | Thêm `tsconfig.test.json` phủ test, đưa vào `references` (§Phase 3) |
| `base: command === 'build' ? './' : '/'` | Base tương đối vỡ khi deep-link nhiều cấp (`/next/scenario/review` sẽ resolve asset thành `/next/scenario/assets/…`) | Dùng base tuyệt đối `/next/` rồi `/` (§6.5) |
| `src/App.tsx` + `App.css` | Rác còn lại từ template `create-vite`, không route nào dùng | Xoá ngay sau khi scaffold |

---

## 4. Khoảng cách cần lấp

| # | Hiện trạng TestPilot | Chuẩn `sen` | Mức |
|---|---|---|---|
| G1 | Không bundler, `<script type="module">` trực tiếp | Vite 8 | Chặn |
| G2 | Vanilla DOM (`el()` helper), 176 hàm | React 19 component | Chặn |
| G3 | Router bằng `location.hash` + `hidden` | TanStack Router file-based | Chặn |
| G4 | `let` toàn cục + `refresh()` gọi tay | TanStack Query + (rất ít) Zustand | Chặn |
| G5 | CSS thủ công 2.018 dòng, chỉ light | Tailwind 4 + shadcn + dark mode | Cao |
| G6 | 0 test FE | Vitest + Testing Library + MSW | Cao |
| G7 | 0 lint, 0 format, 0 hook, **0 CI** | ESLint + Prettier + Husky + lint-staged + CI | Cao |
| G8 | FE không có type | TS strict, project references | Cao |
| G9 | `fetch` trần, không type response | Tầng API có type — **cần contract, xem §6.1b** | Cao |
| G10 | `flatpickr` vendor trong repo (3 chỗ dùng) | `react-day-picker` + `date-fns` | Thấp |
| G11 | Bảng dựng tay (Scenario Review, Healing, Builds) | TanStack Table 8 | Trung bình |
| G12 | Không có e2e cho chính UI | Playwright `ui/e2e/` | Trung bình |
| G13 | `alert()` / `askConfirm()` tự chế | `sonner` + shadcn `AlertDialog` | Thấp |
| G14 | Job đang stream sống sót khi đổi trang (section chỉ bị `hidden`) | React unmount → stream chết | **Cao — xem R10** |

---

## 5. Kiến trúc strangler

### 5.1 Bố cục thư mục

```
testpilot/
  src/               ← backend (tsconfig include chỉ có "src/**/*.ts", .tsx không lọt vào)
    ui/server.ts     ← thêm 1 nhánh static /next/ (§5.2)
    ui/contracts.ts  ← ✨ MỚI: type contract của 41 route (§6.1b) — chỉ type, không runtime
    ui/public/       ← app cũ, sống nguyên vẹn tới ngày cutover
  ui/                ← ✨ app Vite mới (ngang hàng src/, giống sen đặt frontend/ ngang api/)
    index.html
    src/{api,components,hooks,lib,panels,routes,stores,test}
    src/index.css
    e2e/
    vite.config.ts  vitest.config.ts  eslint.config.js  playwright.config.ts
    tsconfig.json  tsconfig.app.json  tsconfig.node.json  tsconfig.test.json
    components.json
  .github/workflows/ci.yml   ← ✨ MỚI (§Phase 0)
```

**Vì sao đặt ngoài `src/`:** `tsconfig.json` của backend `include: ["src/**/*.ts"]` — chỉ `.ts`,
không `.tsx`. Đặt app React ngoài `src/` cho cách ly tuyệt đối: `npm run build` và `npm run typecheck`
của backend không bao giờ nhìn thấy nó, và ngược lại.

**Một npm project hay hai?** → **Một.** `ui/` **không có `package.json` riêng**; toàn bộ dependency
React nằm ở `package.json` gốc. Lý do bắt buộc: §6.1b import type xuyên qua `src/`, mà `src/config.ts`
lại `import { z } from 'zod'`. Nếu `ui/` là npm project riêng, TS phải resolve `zod` từ `ui/node_modules`
— nó sẽ đi ngược lên và tìm thấy ở gốc, nhưng đó là hành vi ngầm, dễ vỡ khi ai đó chạy `npm ci` trong
`ui/`. Một `node_modules` duy nhất thì không có gì để vỡ.

### 5.2 Hai chế độ chạy

**Chế độ phát triển** — không cần sửa `server.ts` dòng nào:

```
localhost:5173  (Vite dev, HMR)  ──proxy /api, /runs, /reports, /artifacts──►  localhost:4300 (server.ts)
localhost:4300  (UI cũ)                                                          giữ nguyên
```

Đúng khuôn mà `sen/frontend` đang dùng để proxy sang `:8888`.

**Chế độ một origin** — để kiểm chứng trước cutover:

```
GET /            → src/ui/public/index.html      (cũ)
GET /next/*      → dist/ui/app/                  (mới, vite build với base=/next/)
GET /api/*       → dùng chung
```

`server.ts` chỉ cần thêm một nhánh `/next/` **đặt trước** vòng lặp static hiện có, kèm SPA fallback:

```ts
// server.ts — chèn ngay trước `for (const dir of ['runs','reports','artifacts'] ...)`
const NEXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'ui', 'app');
if (req.method === 'GET' && url.pathname.startsWith('/next')) {
  const rel = url.pathname.replace(/^\/next\/?/, '') || 'index.html';
  const file = path.resolve(NEXT_DIR, rel);
  if (!file.startsWith(NEXT_DIR)) return json(res, 403, { error: 'forbidden' });
  // SPA fallback: mọi đường dẫn không phải file thật đều trả index.html cho router xử lý.
  return serveFile(res, existsSync(file) && statSync(file).isFile() ? file : path.join(NEXT_DIR, 'index.html'));
}
```

**Cutover = đổi `base` thành `/` và trỏ `PUBLIC_DIR` sang `dist/ui/app`** (§Phase 6).

### 5.3 Sơ đồ luồng

```
                        ┌──────────────── ui/ (Vite + React) ────────────────┐
                        │  routes/ (mỏng) → panels/<Name>/ → hooks/ → api/   │
                        │                        ↑                           │
                        │              stores/jobStore (chỉ job đang chạy)    │
                        └────────────────────────┬───────────────────────────┘
                                                 │ fetch + TanStack Query
                                                 │ streamJob() cho 9 route SSE
                        ┌────────────────────────▼───────────────────────────┐
   src/ui/public/ ─────►│           src/ui/server.ts  —  41 route            │
   (app cũ, song song)  │  GET /api/state · PUT /api/config · POST /api/run…  │
                        │  src/ui/contracts.ts ← type dùng chung hai bờ       │
                        └────────────────────────┬───────────────────────────┘
                                                 │
                            registry/ · runs/ · reports/ · CLI pipeline
```

---

## 6. Những chỗ cố ý lệch khỏi `sen/frontend`

Không copy nguyên xi. Các mục dưới đây là quyết định có lý do. **Bốn mục ⛔ đã được kiểm chứng bằng
`tsc` / đọc mã nguồn thật — bỏ qua là build gãy hoặc runtime sai, không phải "nice to have".**

### 6.1 ⛔ Không dùng `@hey-api/openapi-ts` — nhưng import type xuyên ranh giới CẦN hai chỉnh sửa

`sen/frontend` sinh client từ `openapi.json` của FastAPI. `server.ts` của TestPilot là `node:http`
thuần, **không có OpenAPI spec**, và viết spec cho 41 route chỉ để rồi sinh lại type là đi vòng.

Thay vào đó: app mới nằm cùng repo với backend, nên `import type` thẳng từ nguồn sự thật. **Nhưng
cách làm ngây thơ sẽ không compile.**

#### 6.1a ⛔ `tsconfig.app.json` phải có `"node"` trong `types`

`import type { TestPilotConfig } from '@core/config.js'` kéo `src/config.ts` vào TS program, và file
đó mở đầu bằng:

```ts
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
```

`import type` chỉ xoá **emit**, không xoá **typecheck**. Với `"types": ["vite/client"]` của `sen`,
TS báo lỗi thật:

```
src/config.ts(1,28): error TS2307: Cannot find module 'node:fs' or its corresponding type declarations.
src/config.ts(2,37): error TS2307: Cannot find module 'node:fs/promises' ...
src/config.ts(3,18): error TS2307: Cannot find module 'node:path' ...
```

**Sửa:** `"types": ["vite/client", "node"]` trong `tsconfig.app.json`. Đã kiểm chứng: với `"node"`,
`tsc` xanh — kể cả khi bật đủ `strict` + `verbatimModuleSyntax` + `erasableSyntaxOnly` +
`noUncheckedIndexedAccess`.

**Giá phải trả:** `process`, `Buffer`, `__dirname` trở thành global hợp lệ trong code trình duyệt.
Bù lại bằng ESLint (§6.1c).

**Phương án sạch hơn (tuỳ chọn, +0,5 ngày):** tách `ConfigSchema` sang `src/configSchema.ts` không
import `node:*`, để `src/config.ts` chỉ còn phần đọc/ghi file. Khi đó `ui/` chỉ cần type của `zod`,
không cần `@types/node`. Nếu chọn hướng này thì làm ở Phase 2, có `npm run typecheck` của backend làm cổng.

#### 6.1b ⛔ 39/41 route KHÔNG có type response — phải viết contract

Đây là lỗ hổng lớn nhất của bản kế hoạch đầu. `server.ts` **không `export` gì cả**; handler là hàm
private trả object literal ẩn danh:

```ts
case 'GET /api/healing':
  return json(res, 200, await healingState(cfg));   // healingState không export, không có kiểu trả về khai báo
```

Nên `import type` chỉ cho được đúng 4 thứ có tên: `TestPilotConfig`, `ScenarioSpec`, `RunReport`,
`Platform`. Còn lại — `/api/state`, `/api/healing`, `/api/history`, `/api/builds`, `/api/preflight`,
`/api/farm/*`, `/api/aws`, `/api/prereq/*` … — **không có gì để import**.

**Quyết định: tạo `src/ui/contracts.ts`** — một module *chỉ chứa type*, không import `node:*`, là hợp
đồng chung của cả hai bờ:

```ts
// src/ui/contracts.ts — KHÔNG import node:*, KHÔNG có giá trị runtime
import type { TestPilotConfig } from '../config.js';
import type { ScenarioSpec, RunReport, Platform } from '../core/types.js';

export type { TestPilotConfig, ScenarioSpec, RunReport, Platform };

export interface StateResponse {
  config: TestPilotConfig;
  configError: string | null;
  configFile: string;
  features: FeatureSummary[];
  elements: number;
  reports: ReportSummary[];
  runs: RunSummary[];
  /** Mật khẩu KHÔNG BAO GIỜ đi qua đây — chỉ cờ `hasPassword`. Xem R9. */
  accounts: Array<TestPilotConfig['accounts'][number] & { hasPassword: boolean }>;
  hasApiKey: boolean;
  modelKeys: { deepseek: boolean; gemini: boolean; anthropic: boolean };
  appBuilds: { android: Build; ios: Build };
  deviceEnv: Record<string, unknown>;
  envBuilds: Record<string, { android: Build; ios: Build }>;
  tagTaxonomy: TagTaxonomyView;
}

export interface ApiError { error: string }
export interface ApiValidationError { error: string; issues: string[] }
// … lần lượt cho 41 route
```

Rồi **gắn kiểu trả về tường minh cho handler ở `server.ts`**, để TS bắt lệch hợp đồng ngay tại nguồn:

```ts
async function state(): Promise<StateResponse> { … }        // trước: async function state() { … }
```

Đây là **thay đổi backend thứ hai và cuối cùng** của kế hoạch. Nó thuần khai báo — không đổi một dòng
logic nào — và `npm run typecheck` của backend là cổng chứng minh điều đó.

**Vì sao không chọn `ReturnType<typeof state>`:** phải `export` handler ra, làm rò rỉ bề mặt nội bộ
của server, và kiểu suy ra sẽ mang theo cả `Promise<{…}>` với các trường `undefined` mà TS suy rộng
— contract tường minh đọc được và ổn định hơn.

**Ngân sách: 1 ngày**, nằm ở Phase 2. Chia nhỏ: viết type cho 8 route mà Phase 4 trang 1–3 dùng
trước, phần còn lại bổ sung dần theo từng PR trang. **Không được để `any` làm chỗ trống** — dùng
`unknown` rồi thu hẹp.

#### 6.1c Kỷ luật ranh giới

- Alias `@core/*` → `../src/*` trong `tsconfig.app.json` (chỉ để TS đọc; **không** khai báo alias này
  trong `vite.config.ts` — nếu Vite không resolve được thì mọi import giá trị lọt lưới sẽ gãy lúc
  build, đúng như mong muốn).
- `verbatimModuleSyntax: true` là hàng rào chính: nó bắt lỗi ngay khi ai đó viết `import { X }` thay
  vì `import type { X }`.
- ESLint chặn thêm:

```js
// ui/eslint.config.js — bổ sung ngoài preset của sen
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['../../src/*', '@core/*'],
        importNamePattern: '^(?!type$).*',
        message: 'Chỉ được `import type` qua ranh giới ui/ → src/. Xem UI-MIGRATION-PLAN §6.1c.',
      }],
    }],
    'no-restricted-globals': ['error',
      { name: 'process', message: '@types/node có mặt vì §6.1a, nhưng đây là code trình duyệt.' },
      { name: '__dirname', message: 'Code trình duyệt.' },
    ],
  },
}
```

- **Cổng kiểm chứng cuối Phase 2:** `npm run ui:build && grep -rl "node:fs\|require(" dist/ui/app/assets/`
  phải **không ra kết quả nào**.

### 6.2 ⛔ SSE-over-POST cần hook riêng — và cần một store để job sống sót qua điều hướng

Query/Mutation trả một giá trị cuối; 9 route này trả một *dòng chảy*. Giữ nguyên bộ parse khung đã
chạy tốt trong `app.js:5690`, bọc lại thành hook.

**Nhưng có một hồi quy hành vi mà bản kế hoạch đầu bỏ sót (G14 / R10):** ở app cũ, các trang là
`<section hidden>` — chúng **không bị huỷ** khi đổi trang. Một farm run stream 20 phút vẫn tiếp tục
ghi log vào `<pre>` của nó trong lúc người dùng đi xem Scenario Review, và quay lại thì log còn
nguyên. Với TanStack Router, `<Outlet/>` **unmount** panel cũ → `useEffect` cleanup chạy → stream
đứt giữa chừng. Người dùng mất một lần chạy thật trên thiết bị thật.

**Kiến trúc bắt buộc:** stream **không được sở hữu bởi component**. Nó sống ở module scope, component
chỉ subscribe.

```
ui/src/lib/streamJob.ts     — port từ app.js streamInto(), thêm AbortSignal. Thuần, không React.
ui/src/stores/jobStore.ts   — zustand: Map<jobId, { logs: string[]; run: WorkflowRun|null;
                              status: 'idle'|'running'|'done'|'error'; abort: () => void }>
ui/src/hooks/useStreamJob.ts— { logs, run, status, start, abort } đọc/ghi jobStore
```

- `start()` gọi `streamJob()` và ghi từng frame vào `jobStore` — **không** vào `useState`.
- Unmount **không** abort. Chỉ nút "Dừng" hoặc `POST /api/run/stop` mới abort.
- Sau frame `done`, gọi `queryClient.invalidateQueries()` để phần còn lại của app đồng bộ lại.
  Đây là cầu nối duy nhất giữa hai mô hình state.
- Log buffer phải **có trần** (ví dụ giữ 5.000 dòng cuối). Một farm run dài có thể sinh hàng chục
  nghìn dòng; app cũ append thẳng vào DOM và đã chậm thấy rõ ở những run dài.
- `err.printed` (`app.js:5738`) là một quy ước thật: nó nói với caller rằng thông báo lỗi **đã** ở
  trên màn hình rồi, đừng `toast` lần nữa. Giữ nguyên cờ này.

Đây chính là lý do §10 câu 1 được chốt là **"có dùng Zustand, nhưng chỉ cho đúng việc này"**.

### 6.3 Prettier chỉ áp cho `ui/`, không format cả repo

`sen` để `.prettierrc` ở gốc monorepo và chạy `prettier --write ..` cho tất cả. Làm vậy ở TestPilot sẽ
format lại **200+ file backend** trong một commit — mất sạch `git blame` trên phần code đang chạy tốt.

- `.prettierrc` đặt ở gốc TestPilot (copy y hệt của `sen`).
- `.prettierignore` loại trừ `src/`, `scripts/`, `generated/`, `registry/`, `features/`,
  **và `ui/src/routeTree.gen.ts`** (file sinh tự động, format nó là tạo diff rác mỗi lần thêm route).
- `lint-staged` chỉ khớp `ui/**/*.{ts,tsx,css,json,md}`.
- Chuyện format cả backend là một quyết định riêng, làm sau, trong một commit chỉ-format.

### 6.4 Không nâng TypeScript lên `~6.0` cho cả repo

`sen` dùng TS `~6.0.2`; TestPilot đang `^5.7` (thực cài: **5.9.3**). Nâng cả repo là kéo theo rủi ro
build lên toàn bộ backend đang chạy ổn — không liên quan gì tới việc nâng FE.

**Đề xuất:** giữ một TS duy nhất cho repo ở dòng 5.9.x. Đã kiểm chứng 5.9.3 hỗ trợ đủ mọi cờ mà
`tsconfig.app.json` của `sen` dùng (`erasableSyntaxOnly`, `verbatimModuleSyntax`,
`allowImportingTsExtensions`, `noUncheckedIndexedAccess`). **Bỏ `"ignoreDeprecations": "6.0"`** khỏi
bản copy — cờ đó chỉ có nghĩa với TS 6.

Ghi lại chênh lệch so với `sen` như một khoản nợ có chủ đích.

### 6.5 ⛔ `base` và `basepath` phải đi cùng nhau

Bản kế hoạch đầu đặt Vite `base: '/next/'` nhưng không nói gì về router. Thiếu cái thứ hai thì
`/next/healing` sẽ rơi vào `notFoundComponent` — app chỉ chạy đúng ở đường dẫn gốc.

`sen` đã có sẵn khuôn này ở `src/main.tsx`: `createRouter({ basepath: config.apiBase || '/' })`.

**Ở TestPilot dùng một nguồn duy nhất là `import.meta.env.BASE_URL`** — Vite tự bơm giá trị `base` vào
đó, nên cutover chỉ phải sửa **một** chỗ:

```ts
// ui/src/main.tsx
const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,   // '/next/' khi build, '/' khi dev
  context: { queryClient },
  defaultPreload: 'intent',
});
```

Ba chỗ liên đới, phải nhất quán:

| Chỗ | Dev | Build (trước cutover) | Sau cutover |
|---|---|---|---|
| `vite.config.ts#base` | `/` | `/next/` | `/` |
| `main.tsx#basepath` | tự theo `BASE_URL` | tự theo `BASE_URL` | tự theo `BASE_URL` |
| `playwright.config.ts#baseURL` | `http://localhost:4173/` | `http://localhost:4300/next/` | `http://localhost:4300/` |

**Không dùng `base: './'` như `sen`.** Base tương đối chỉ đúng khi app luôn ở một cấp; deep-link
`/next/scenario/review` sẽ resolve asset thành `/next/scenario/assets/index-xxx.js` → 404.

### 6.6 ⛔ Upload build là raw body, không phải multipart

`POST /api/app/upload` đọc **thẳng body request thành file** (`pipeline(req, createWriteStream(temp))`,
`server.ts:558`). Tham số ở query string. Viết đúng:

```ts
// ui/src/api/upload.ts
export async function uploadBuild(
  file: File,
  params: { platform: 'android' | 'ios'; env?: string; persist?: boolean },
) {
  const qs = new URLSearchParams({
    platform: params.platform,
    filename: file.name,
    ...(params.env ? { env: params.env } : {}),
    ...(params.persist ? { persist: '1' } : {}),
  });
  const res = await fetch(`/api/app/upload?${qs}`, {
    method: 'POST',
    body: file,                                  // File là BodyInit — KHÔNG bọc FormData
    headers: { 'content-type': 'application/octet-stream' },
  });
  return unwrap(res);   // dùng chung bộ xử lý lỗi error/issues ở api/client.ts
}
```

- **Không** `new FormData()` — boundary của multipart sẽ nằm trong file `.apk`/`.ipa` và Appium sẽ
  từ chối bản build với một thông báo không nói gì về nguyên nhân.
- `fetch` với body là `File` **không có sự kiện tiến trình**. Một `.ipa` vài trăm MB sẽ trông như
  treo. Hoặc chấp nhận (hiện `app.js` cũng không có progress), hoặc dùng `XMLHttpRequest` cho riêng
  chỗ này để có `upload.onprogress`. **Đề xuất: dùng XHR** — đây là màn hình duy nhất cần nó, và
  chi phí là ~20 dòng.
- Phải kiểm chứng **body lớn đi qua Vite proxy** ngay ở Phase 2, không đợi tới Phase 4 trang 6.

### 6.7 `/api/state` là endpoint tổng hợp — cần một chiến lược query riêng

`GET /api/state` trả về **mười một** nhóm dữ liệu trong một response (config, features, elements,
reports, runs, accounts, hasApiKey, modelKeys, appBuilds, deviceEnv, envBuilds, tagTaxonomy), và
`refresh()` ở app cũ vẽ lại 6 panel mỗi lần gọi (`app.js:344`).

Bê nguyên vào React Query sẽ cho một `queryKey: ['state']` mà **mọi mutation đều phải invalidate**,
và mọi panel đều re-render — đúng cái vấn đề của app cũ, chỉ khác là bây giờ nó tốn thêm reconcile.

**Quy ước bắt buộc:**

```ts
// ui/src/hooks/useAppState.ts
const stateQuery = { queryKey: ['state'] as const, queryFn: () => api.get('/api/state') };

/** Mọi panel đọc lát cắt của mình qua `select` — React Query so sánh kết quả select,
 *  nên panel chỉ re-render khi đúng lát cắt đó đổi. */
export function useAppState<T>(select: (s: StateResponse) => T) {
  return useQuery({ ...stateQuery, select, staleTime: 5_000 });
}
export const useConfig    = () => useAppState((s) => s.config);
export const useAccounts  = () => useAppState((s) => s.accounts);
export const useAppBuilds = () => useAppState((s) => s.appBuilds);
```

- `structuralSharing` (mặc định bật) giữ nguyên tham chiếu cho nhánh không đổi — đây là thứ làm cho
  `select` thực sự cắt được re-render.
- **Không tách `/api/state` thành nhiều endpoint ở backend.** Ngoài phạm vi đợt này.
- Route nào có endpoint riêng (`/api/healing`, `/api/history`, `/api/builds`, …) thì dùng query key
  riêng, **không** đọc từ `['state']`.

---

## 7. Các phase

### Phase 0 — Nền móng chất lượng (không đụng UI cũ) · 1,5–2 ngày · ✅ **ĐÃ XONG**

**Mục tiêu:** dựng lint/format/hook/CI trước, để mọi dòng code mới sinh ra đã đúng chuẩn ngay từ đầu.

> **Trạng thái thực tế** — file đã tạo: `.prettierrc`, `.prettierignore`, `.husky/pre-commit`,
> `.github/workflows/ci.yml`, `ui/README.md`; `package.json` đã có `engines`, `prepare`, `lint-staged`.
> Dep đã cài: `prettier@^3.5.3`, `husky@^9.1.7`, `lint-staged@^15.4.3`.
> Nghiệm thu đã chạy và xanh (xem cuối mục này). Hai điểm lệch có chủ đích so với bản viết trước:
>
> 1. **`prettier-plugin-tailwindcss` hoãn sang Phase 1.** `.prettierrc` của `sen` khai báo plugin này,
>    nhưng việc của nó là sắp xếp class Tailwind — mà ở Phase 0 chưa có Tailwind và chưa có class nào.
>    Thêm plugin vào `.prettierrc` cùng lúc cài `tailwindcss` ở Phase 1, **trước khi** viết component
>    đầu tiên, để không phải reformat lại về sau.
> 2. **`.husky/pre-commit` KHÔNG dùng mặc định của `husky init`.** `husky init` ghi sẵn `npm test` —
>    mà `npm test` ở repo này chạy 835 test backend qua `node --test`. Đó là việc của CI, không phải
>    của một commit sửa một dòng CSS. Hook chỉ chạy `npx lint-staged`.
>
> Thêm một job so với bản viết trước: **`format`** — `prettier --check "ui/**"`. Không có nó thì
> `lint-staged` chỉ gác máy của người đã cài hook; ai commit từ máy chưa chạy `npm install` sẽ lọt.

| Việc | File |
|---|---|
| Prettier + ignore theo §6.3 | `.prettierrc`, `.prettierignore` |
| Husky 9 + lint-staged 15 | `.husky/pre-commit`, `package.json#lint-staged` |
| Siết `engines` cho Vite 8 | `package.json`: `"node": "^20.19.0 \|\| >=22.12.0"` |
| **CI** — cổng tự động, hiện repo chưa có | `.github/workflows/ci.yml` |
| **Không** copy `.npmrc` của `sen` | `sen` trỏ nexus nội bộ TCBS; TestPilot nằm ở `public-project/` |

`prepare` script: `sen` viết `cd .. && husky frontend/.husky` vì nó là monorepo. TestPilot là repo
đơn → chỉ cần `"prepare": "husky"`, và `.husky/pre-commit` chỉ có `npx lint-staged`.

CI tối thiểu — chạy trên mọi PR, hai job song song:

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npm run typecheck      # cổng bắt buộc — chứng minh backend không bị đụng
      - run: npm test
  ui:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npm run ui:lint        # 3 lệnh này thêm dần theo Phase 0→1→3
      - run: npm run ui:typecheck
      - run: npm run ui:test
```

> Job `ui` sẽ đỏ cho tới khi Phase 1 tạo ra các script đó. Tạo file ngay từ Phase 0 nhưng để job `ui`
> ở `continue-on-error: true`, gỡ cờ đó ở cuối Phase 1. Nếu project không dùng GitHub Actions, thay
> bằng một script `scripts/ci-local.sh` chạy đúng các lệnh trên và ghi vào DoD của mỗi PR.

**Nghiệm thu (bản đã sửa):** bản gốc nói "commit một file `.md` bất kỳ" — nhưng `lint-staged` chỉ
khớp `ui/**`, nên phép thử đó **luôn pass một cách rỗng**. Phép thử đúng là:

1. Sửa `ui/README.md` (thụt lề sai cố ý) và `src/config.ts` (thêm khoảng trắng thừa) trong **cùng một**
   commit.
2. `git commit` → file trong `ui/` được format lại; `src/config.ts` **không đổi một byte**.
3. `git diff HEAD~1 --stat -- src/` phải rỗng.

**Kết quả chạy thật:**

| Phép thử | Kết quả |
|---|---|
| `lint-staged` với 2 file staged ở hai bờ ranh giới | ✅ khớp **1** file (`ui/README.md`), bỏ qua `src/config.ts` |
| `ui/README.md` sau khi chạy | ✅ khoảng trắng thừa bị gom, dòng trống cuối bị cắt |
| `src/config.ts` sau khi chạy | ✅ khoảng trắng thừa **còn nguyên từng byte** — Prettier không hề đụng vào |
| `npx prettier --check "src/**/*.ts"` với `const    x   =    1` cố ý nhét vào `src/config.ts` | ✅ vẫn exit 0 → `.prettierignore` che thật, không phải may |
| `npx prettier --check "ui/**/*.{ts,tsx,css,json,md}"` | ✅ pass |
| `npm run typecheck` (backend) | ✅ exit 0 |
| `npm test` (backend) | ✅ **835 test / 218 suite / 0 fail** trong 6,8 s → job `backend` của CI xanh ngay từ ngày đầu |
| `git config core.hooksPath` | ✅ `.husky/_`, shim `pre-commit` có mặt |

---

### Phase 1 — Dựng khung app mới · 2,5–3,5 ngày · ✅ **ĐÃ XONG**

> **Trạng thái thực tế.** Khung chạy được ở cả ba chế độ: dev (`:5173`, HMR, proxy sang `:4300`),
> build (`dist/ui/app`, 327 kB / 103 kB gzip), và một-origin (`:4300/next/`). Bốn điều chỉnh so với
> bản viết trước, tất cả đều do chạy thật mới lộ ra — chi tiết ở §13.
>
> | # | Phát hiện | Sửa |
> |---|---|---|
> | 1 | **`composite: true` phá vỡ §6.1a.** Bật composite thì `import type` xuyên biên báo `TS6307: File 'src/config.ts' is not listed within the file list of project` — composite bắt mọi file phải nằm trong `include`, mà backend thì không. | Bỏ `composite`. `tsc -b` vẫn chạy (sen cũng không có composite). |
> | 2 | **Rule `no-restricted-imports` của ESLint gốc chặn nhầm `import type`.** `importNamePattern` khớp trên *tên* được import (`TestPilotConfig`), không phân biệt được type import. | Dùng `@typescript-eslint/no-restricted-imports` với `allowTypeImports: true`. |
> | 3 | **TypeScript KHÔNG gác được import giá trị xuyên biên.** `import { ConfigSchema } from '@core/config.js'` compile sạch, `tsc -b` thoát 0 — với tsc thì đó là một import hợp lệ từ một file `.ts`. Nó chỉ sai lúc bundle. | ESLint là hàng rào **duy nhất** của R2, không phải lớp thứ hai. Đã ghi lại trong `eslint.config.js`. |
> | 4 | **Vite 8 cảnh báo `__dirname`** — `configLoader: 'native'` sắp thành mặc định và không hỗ trợ nó. | Dùng `import.meta.dirname` ở `vite.config.ts` và `vitest.config.ts`. |

**Mục tiêu:** `/next/` mở lên được, có 1 route trắng, HMR chạy, build ra file, CI xanh.

1. `npm create vite@latest ui -- --template react-ts`, rồi:
   - **Xoá `ui/package.json`** — dependency về `package.json` gốc (§5.1). Chạy `npm i` ở gốc cho
     toàn bộ danh sách dep của `sen` (ghim đúng version, xem R6).
   - **Xoá `ui/src/App.tsx`, `ui/src/App.css`, `ui/src/assets/react.svg`** — rác template.
2. Chép & chỉnh 7 file config từ `sen/frontend`:
   - `vite.config.ts` — alias `@`, `tanstackRouter({ target:'react', autoCodeSplitting:true })`,
     `react()`, `tailwindcss()`; **proxy** `/api`, `/runs`, `/reports`, `/artifacts` →
     `http://localhost:${process.env.TESTPILOT_UI_PORT ?? 4300}`;
     `base: command === 'build' ? '/next/' : '/'` (§6.5); `build.outDir: '../dist/ui/app'`,
     `emptyOutDir: true`. **Bỏ** `injectDevConfig` — đó là chuyện SSO của `sen`.
   - `tsconfig.json` (solution) / `tsconfig.app.json` / `tsconfig.node.json` / **`tsconfig.test.json`**.
     Giữ bộ cờ strict của `sen`, và **ba sửa đổi bắt buộc**: `"types": ["vite/client", "node"]`
     (§6.1a), thêm `paths: { "@core/*": ["../src/*"] }`, bỏ `"ignoreDeprecations": "6.0"` (§6.4).
   - `eslint.config.js` — copy, **thêm** `no-restricted-imports` + `no-restricted-globals` (§6.1c) và
     `globalIgnores(['dist', 'src/routeTree.gen.ts'])`.
   - `vitest.config.ts` — copy, sửa `coverage.exclude` thành `['src/test/**', 'src/routeTree.gen.ts', '*.config.*']`.
   - `playwright.config.ts` — copy, `baseURL` theo bảng §6.5.
3. Tailwind 4 + shadcn: `components.json` copy từ `sen` (`new-york`, `slate`, `cssVariables: true`,
   `tailwind.config: ""`), `npx shadcn@latest init`. **CSS gốc là `ui/src/index.css`**, không phải
   `styles/` (§3.1).
4. TanStack Router + Query: `main.tsx` và `routes/__root.tsx` theo mẫu `sen`, **có `basepath`** (§6.5).
   `__root.tsx` giữ nguyên khuôn: `<Outlet/>` + `<Toaster duration={5000}/>` + devtools chỉ khi
   `import.meta.env.MODE === 'development'` + `notFoundComponent`.
   **Commit `ui/src/routeTree.gen.ts`** (giống `sen`) — CI không chạy Vite plugin trước khi typecheck.
5. `server.ts`: thêm nhánh static `/next/` + SPA fallback (§5.2). Đây là **thay đổi backend thứ nhất**.
6. `package.json` gốc — script mới:

```jsonc
{
  "ui:dev":       "vite --config ui/vite.config.ts",
  "ui:build":     "tsc -b ui && vite build --config ui/vite.config.ts",
  "ui:typecheck": "tsc -b ui",
  "ui:lint":      "eslint ui",
  "ui:test":      "vitest run --config ui/vitest.config.ts",
  "ui:test:e2e":  "playwright test --config ui/playwright.config.ts"
}
```

7. **Gắn cổng typecheck ngay, đừng đợi Phase 6.** `"typecheck": "tsc -p tsconfig.check.json && node --check src/ui/public/app.js && tsc -b ui"`.
   Từ giờ tới cutover, cả app cũ lẫn app mới đều được gác.
8. Thêm mục vào `.claude/launch.json` để tooling xem trước chạy được app mới:
   `{ "name": "testpilot-ui-next", "runtimeExecutable": "npm", "runtimeArgs": ["run","ui:dev"], "port": 5173 }`.
9. `.gitignore`: thêm `dist/ui/`. **Không** ignore `ui/src/routeTree.gen.ts`.

**Nghiệm thu:**
- `npm run ui` + `npm run ui:dev` → `:5173` render trang trắng có `<Toaster/>`; devtools hiện.
- `curl localhost:5173/api/state` (qua proxy) trả 200 với JSON có khoá `config`.
- `npm run ui:build` ra `dist/ui/app`; `:4300/next/` mở được cùng bản build đó.
- **Deep-link:** `:4300/next/khong-ton-tai` trả `notFoundComponent` của router, **không** trả 404 của
  `server.ts` và **không** trắng trang vì asset 404. Đây là phép thử của §6.5 — dễ bỏ sót nhất.
- `npm run ui:lint`, `npm run ui:typecheck` xanh; job `ui` trong CI bỏ được `continue-on-error`.

---

### Phase 2 — Contract + tầng API + design token · 3–3,5 ngày

**Mục tiêu:** mọi trang sau này chỉ việc gọi hook, không tự `fetch`. Đây là phase dài nhất trong nhóm
nền móng vì nó gánh thêm §6.1b.

1. **`src/ui/contracts.ts`** (§6.1b) — type cho 41 route. Ưu tiên 8 route mà Phase 4 trang 1–3 cần
   (`/api/state`, `/api/healing`, `/api/healing/review`, `/api/config`, `/api/model-key`,
   `/api/history`, `/api/preflight`, `/api/vocabulary`); phần còn lại bổ sung theo từng PR trang.
   Gắn kiểu trả về tường minh cho handler tương ứng trong `server.ts`.
2. `ui/src/api/routes.ts` — bảng route: path + method + type request/response, tham chiếu
   `@core/ui/contracts.js`. **Một chỗ duy nhất**; không route nào được viết literal chuỗi ở nơi khác.
3. `ui/src/api/client.ts` — `fetch` wrapper. **Phải giữ đủ hai nhánh lỗi** như `app.js:335`:

```ts
async function unwrap<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}) as unknown);
  if (!res.ok) {
    const e = data as Partial<ApiValidationError>;
    // `issues` là mảng lỗi zod của PUT /api/config. Bỏ nhánh này là mất toàn bộ
    // thông báo validate config — người dùng chỉ thấy "Bad Request".
    throw new Error(e.issues?.length ? e.issues.join('\n') : (e.error ?? res.statusText));
  }
  return data as T;
}
```

4. `ui/src/api/upload.ts` — §6.6 (raw body + XHR progress).
5. `ui/src/lib/queryClient.ts` — theo mẫu `sen`, **nhưng bỏ nhánh 401** (TestPilot không có auth) và
   nới `retry` cho nhóm route chậm: `/api/aws/*`, `/api/prereq/*`, `/api/farm/*` đặt `retry: 0` —
   thử lại một lệnh gọi AWS 30 giây là làm người dùng chờ 90 giây để nhận cùng một lỗi.
6. `ui/src/lib/streamJob.ts` + `ui/src/stores/jobStore.ts` + `ui/src/hooks/useStreamJob.ts` — §6.2.
7. `ui/src/hooks/useAppState.ts` — §6.7.
8. **Design token → `ui/src/index.css`** (Tailwind 4: `@import "tailwindcss"` + `@theme` + `@layer base`,
   **không có `tailwind.config.js`**). Ánh xạ token cũ sang biến shadcn và **bổ sung dark mode** —
   bản cũ chỉ có light:

   | Token cũ (`style.css`) | shadcn |
   |---|---|
   | `--bg` / `--fg` | `--background` / `--foreground` |
   | `--muted` / `--faint` | `--muted-foreground` |
   | `--line` / `--line-strong` | `--border` |
   | `--hover` / `--active` | `--accent` |
   | `--radius` | `--radius` |
   | `--pass-*` / `--fail-*` / `--run-*` | biến `--status-*` tự đặt trong `@theme` |

   Bốn màu trạng thái (`pass`/`fail`/`flaky`/`skip`) phải **đạt contrast AA trên cả hai theme** — đây
   là thứ dễ vỡ nhất khi thêm dark mode, và log console dùng chúng dày đặc.
9. `ui/src/components/layout/{header,main,Sidebar}.tsx` — khung trang + **14 mục NAV** đọc từ
   `app.js:71`: **8 mục thật** (Dashboard, App Automation Studio, Kịch bản, Healing Center, Bản build,
   Local Runner, Device Farm, Personal Settings) và **6 mục placeholder** có trường `why`
   (Gen History, DB Sources, Repositories, Team Configs, Zephyr, Job Management) — cả 6 cùng render
   trang `todo`. Giữ nguyên chuỗi `why` tiếng Việt.
10. `ThemeProvider` + `ThemeSwitch` theo `sen`.

**Nghiệm thu:**
- Sidebar + header render **đủ 14 mục**, chuyển light/dark mượt, token trạng thái đạt AA cả hai theme.
- `useStreamJob` chạy được `POST /api/prereq/appium` và in log ra màn hình — **qua Vite proxy**
  (R3: kiểm tra log hiện dần từng dòng, không dồn một cục lúc kết thúc).
- **Điều hướng sang trang khác rồi quay lại, log vẫn chảy tiếp và không mất dòng nào** (R10).
- Upload một file ~200 MB qua proxy tới `/api/app/upload` thành công (R14).
- `npm run ui:build && grep -rl "node:fs\|require(" dist/ui/app/assets/` → rỗng (R2).
- `npm run typecheck` (backend) xanh sau khi thêm contract.

---

### Phase 3 — Hạ tầng test · 2–2,5 ngày

**Mục tiêu:** viết được test *trước khi* migrate trang, không phải sau.

1. `ui/src/test/setup.ts` — copy từ `sen` (jest-dom, cleanup, memory localStorage, MSW lifecycle với
   `onUnhandledRequest: 'warn'`). **Thêm:** reset `jobStore` ở `afterEach` — store ở module scope
   (§6.2) sẽ rò trạng thái giữa các test nếu không dọn.
2. `ui/src/test/utils.tsx` — `renderWithProviders` + `createQueryWrapper` của `sen`, **thêm** wrapper
   Router: panel nào dùng `useNavigate`/`Link` sẽ ném lỗi nếu render trần.

```tsx
export function renderWithRouter(ui: React.ReactElement) {
  const rootRoute = createRootRoute({ component: () => <><Outlet /></> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => ui });
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
  return render(<QueryClientProvider client={testClient()}><RouterProvider router={router} /></QueryClientProvider>);
}
```

3. `ui/src/test/mocks/` — MSW handler cho 41 route, gom theo nhóm:
   `handlers/{state,config,workflow,scenario,healing,farm,prereq,builds,secrets}.ts` + `index.ts`.
   **Handler cho 9 route SSE phải trả `ReadableStream` khung `event:`/`data:` thật**, không phải JSON
   — nếu không thì `streamJob` không bao giờ được test thật sự:

```ts
http.post('/api/prereq/appium', () => {
  const enc = new TextEncoder();
  return new HttpResponse(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('event: log\ndata: "đang khởi động"\n\n'));
        c.enqueue(enc.encode('event: done\ndata: {"ok":true}\n\n'));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
});
```

4. **`tsconfig.test.json`** (§3.2) — phủ `src/test/**` + `src/**/__tests__/**`, `types: ["vitest/globals","node"]`,
   thêm vào `references` của `ui/tsconfig.json`. Không có nó thì `tsc -b ui` bỏ qua toàn bộ test và
   DoD "không còn `any`" là lời hứa suông ở đúng nơi hay có `any` nhất.
5. Playwright: `ui/playwright.config.ts` theo mẫu `sen` (`testDir: './e2e'`, `webServer` tự bật
   `ui:dev` ở cổng 4173); 1 smoke test "mở app, thấy sidebar 14 mục".

> **Lưu ý riêng của TestPilot:** repo này đã có Playwright cho *sản phẩm* (`src/drivers/web.ts`,
> `generated/tests/`). Playwright của `ui/e2e/` là **mục đích khác** — test chính bảng điều khiển.
> Đặt trong `ui/` và đặt tên script `ui:test:e2e` để không ai nhầm với `npm run run:web`.

**Nghiệm thu:** `npm run ui:test` xanh với ≥1 test cho `streamJob` (dùng ReadableStream mock ở trên),
≥1 test cho `client.ts` **phủ cả nhánh `issues`**, và ≥1 test cho `jobStore` (job sống sót qua unmount);
`npm run ui:test:e2e` xanh với smoke test; `tsc -b ui` typecheck cả file test.

---

### Phase 4 — Migrate trang · 12–17 ngày

Nguyên tắc mỗi trang: **1 PR = 1 trang**, gồm panel + hook + `__tests__/` + route + phần contract của
riêng nó, và trang tương ứng ở app cũ **không bị xoá**.

Thứ tự đi từ mỏng → dày, để lát cắt dọc đầu tiên chạm hết mọi tầng của stack:

| # | Trang | Dòng cũ | Ngày | Vì sao ở vị trí này |
|---|---|---:|---:|---|
| 1 | **Healing Center** | 187 | 1,5 | Lát cắt dọc mẫu: Query + Mutation + Table + toast. Ngắn, đọc-nhiều-ghi-ít. |
| 2 | Dashboard | 39 | 0,5 | Rẻ, tạo `components/data-table/` dùng lại về sau. |
| 3 | Settings | 198 | 1 | Form + secret (chỉ hiện cờ `hasPassword`/`modelKeys`, **không bao giờ** hiện giá trị — R9). |
| 4 | Scenario/E2E History | 232 | 1 | Bảng + phân trang + lọc theo ngày → thay `flatpickr` bằng `react-day-picker`. |
| 5 | Farm Run Detail | 118 | 1 | Video + HTTP Range — kiểm chứng static path qua proxy. |
| 6 | Bản build | 588 | 1,5 | Upload raw-body §6.6 + XHR progress. |
| 7 | **E2E Runner** | 888 | 2,5 | SSE thật + report nhúng. Chốt `useStreamJob`/`jobStore` cho các trang sau. |
| 8 | **AWS Device Farm** | 423 | 2 | Pool, upload, log stream, biến môi trường. Run dài nhất → là phép thử nặng nhất của R10. |
| 9 | **Scenario Studio** | 591 | 2,5 | Form nặng: sources, accounts, env editor, device picker. Lỗi validate hiện qua nhánh `issues` (§Phase 2.3). |
| 10 | **Scenario Review** | 1.939 | 4 | Lớn nhất: TanStack Table + filter tag + inline editor + bulk + phân trang. **Bắt buộc tách 3 PR.** Bộ lọc để ở **URL search param** của TanStack Router (`validateSearch`), không phải `useState` — chia sẻ link được, và back/forward chạy đúng. |
| 11 | Trang `todo` dùng chung | ~40 | 0,5 | Một component nhận `{label, why}`, phục vụ cả 6 mục NAV placeholder. |

**Definition of Done cho mỗi trang:**
- [ ] Tương đương tính năng với trang cũ (đối chiếu tay hai tab cạnh nhau, ghi vào PR).
- [ ] Contract của mọi route trang đó gọi đã có trong `src/ui/contracts.ts`, handler backend đã gắn
      kiểu trả về tường minh, `npm run typecheck` xanh.
- [ ] Có `__tests__/` cho panel và cho **từng** hook trong `hooks/`.
- [ ] MSW handler cho mọi route trang đó gọi (SSE thì phải là ReadableStream thật).
- [ ] `npm run ui:lint`, `npm run ui:typecheck`, `npm run ui:test` xanh; CI xanh.
- [ ] Không còn `any` (dùng `unknown` + thu hẹp); không `fetch` trực tiếp ngoài `api/`.
- [ ] Route file chỉ ghép layout + panel, không chứa logic (§3.1 điểm 3).
- [ ] Kiểm mắt ở **cả light và dark**.

---

### Phase 5 — E2E + đối chiếu · 2–2,5 ngày

1. Playwright e2e phủ 5 luồng chính: mở Studio → lưu config; chạy workflow (mock); duyệt scenario;
   xem healing; mở tab Device Farm.
2. **Đối chiếu song song:** mở `/` và `/next/` cạnh nhau, đi hết 12 trang, ghi lại lệch lạc vào một
   bảng checklist có tick từng mục (không phải "đã xem qua").
3. Kiểm tra dark mode và responsive trên toàn bộ trang.
4. Đo bundle size; `autoCodeSplitting` của TanStack Router đã bật sẵn — kiểm tra Scenario Review
   thực sự nằm ở chunk riêng.
5. **Chạy lại phép thử R10 trên một farm run thật** (không mock): bắt đầu run, đi qua 3 trang khác,
   quay lại — log phải liền mạch.

---

### Phase 6 — Cutover + dọn dẹp · 1,5–2 ngày

1. `vite.config.ts`: `base` `/next/` → `/`. `main.tsx` **không phải sửa** (đọc `BASE_URL`, §6.5).
   `playwright.config.ts#baseURL` bỏ hậu tố `/next/`.
2. `server.ts`: `PUBLIC_DIR` trỏ sang `dist/ui/app`; bỏ nhánh `/next/`; **giữ SPA fallback** — app
   mới là SPA, không còn `index.html` ở mọi đường dẫn nữa.
3. **`serveFile()` — sửa `cache-control`.** Hiện nó gắn `no-store` cho **mọi** file
   (`server.ts:2712`). Lý do ghi trong comment là "app.js được sửa khi đang chạy, không có
   cache-busting" — sau cutover thì Vite đã băm tên file, nên `no-store` chỉ còn nghĩa là tải lại
   toàn bộ bundle mỗi lần F5. Sửa thành: `index.html` → `no-store`; `/assets/*` (tên có hash) →
   `public, max-age=31536000, immutable`.
4. **Xoá** `src/ui/public/{app.js,index.html,style.css,flatpickr.min.js,flatpickr.min.css}` — chỉ sau
   khi Phase 5 đối chiếu xong. **Gắn tag `pre-ui-migration` trước khi xoá** để còn đường quay lại;
   `git revert` một commit xoá 8.900 dòng thì được, nhưng tag là thứ tìm lại được sau sáu tháng.
   Giữ `favicon.png`, `favicon.svg` (chuyển sang `ui/public/`).
5. `package.json`:
   - `build`: thêm `npm run ui:build`, bỏ `mkdir -p dist/ui/public && cp -R src/ui/public/. dist/ui/public/`.
   - `typecheck`: **bỏ `node --check src/ui/public/app.js`** — file không còn nữa; giữ `tsc -b ui`.
6. **`scripts/bundle-farm.sh:104` — loại `dist/ui` ra khỏi gói farm.** Dòng `cp -R dist "$STAGE/dist"`
   đang nhét cả UI vào zip gửi lên Device Farm, trong khi farm chỉ chạy `node dist/cli/run.js`. Hôm
   nay đó là vài chục KB thừa; sau khi có bundle React thì là vài trăm KB thừa **trên mỗi lần upload**.
   Sửa: giữ nguyên `cp -R`, thêm ngay sau đó một dòng xoá `"$STAGE/dist/ui"`.
7. Cập nhật tài liệu — hai chỗ sẽ sai sau cutover:
   - `README.md:108` — "`src/ui/` | Bảng điều khiển: `node:http` thuần, không framework, không bundler."
   - `ARCHITECTURE.md:168` — "`npm run ui` mở một `node:http` server không framework, không bundler."

---

## 8. Rủi ro & cách chặn

| # | Rủi ro | Mức | Cách chặn |
|---|---|---|---|
| R1 | **Scenario Review 1.939 dòng** nuốt mất lịch trình | Cao | Tách 3 PR: (a) bảng + filter, (b) inline editor, (c) bulk action. Làm sau cùng, khi mọi primitive đã sẵn. |
| R2 | Import xuyên ranh giới `ui/` → `src/` kéo code backend vào bundle | Cao | **Chỉ `import type`.** `verbatimModuleSyntax` + `no-restricted-imports` (§6.1c). Cổng kiểm bundle cuối Phase 2. |
| R3 | SSE-over-POST hỏng khi qua Vite proxy (buffering) | Trung bình | Test ngay ở Phase 2 với `/api/prereq/appium`, không đợi tới Phase 4 trang 7. Dấu hiệu hỏng: log dồn một cục lúc kết thúc thay vì chảy dần. |
| R4 | Reformat nhầm cả backend, mất `git blame` | Trung bình | `.prettierignore` + `lint-staged` chỉ khớp `ui/**` (§6.3). Nghiệm thu Phase 0 **đã sửa lại cho không rỗng**. |
| R5 | Nâng TS/dep kéo backend gãy | Trung bình | Không nâng TS cả repo (§6.4). `npm run typecheck` của backend là cổng bắt buộc mỗi PR, chạy trong CI. |
| R6 | Thêm ~600 package React vào repo đang gọn | Trung bình | Chấp nhận có ý thức. Không copy `.npmrc` nội bộ. Ghim version đúng như `sen` để hai project không lệch nhau. |
| R7 | Node/Vite không tương thích | Thấp | Vite 8 yêu cầu `^20.19.0 \|\| >=22.12.0`; máy đang chạy **Node v22.21.1 / npm 10.9.4** — thoả. Siết `engines` ở Phase 0 để CI không dùng Node cũ hơn. |
| R8 | Hai UI lệch tính năng trong lúc migrate | Thấp | Trong giai đoạn migrate, **sửa bug chỉ ở bản mới**; bản cũ đóng băng, chỉ vá lỗi chặn người dùng. |
| R9 | Secret lộ qua UI mới | Thấp nhưng nghiêm trọng | Giữ đúng bất biến hiện tại: server chỉ trả `hasPassword`/`modelKeys`/`hasApiKey`, không bao giờ trả giá trị (`server.ts:820`). Contract type ở §6.1b **phải khoá điều này bằng type**, và viết test khẳng định response không chứa khoá `password`. |
| **R10** | **Job đang stream chết khi đổi trang** — app cũ chỉ `hidden` section nên stream sống; React sẽ unmount | **Cao** | Stream sống ở module scope + `jobStore`, component chỉ subscribe (§6.2). Unmount **không** abort. Nghiệm thu ở Phase 2, thử lại với run thật ở Phase 5. Đây là hồi quy dễ lọt nhất vì test mock chạy trong mili-giây, còn farm run thì 20 phút. |
| **R11** | **Contract cho 39/41 route không tồn tại**, `server.ts` không export gì | **Cao** | `src/ui/contracts.ts` + kiểu trả về tường minh cho handler (§6.1b). Ngân sách 1 ngày ở Phase 2, bổ sung dần theo PR trang. Cấm dùng `any` làm chỗ trống. |
| **R12** | Sau cutover, `serveFile()` gắn `no-store` cho cả bundle đã băm tên → tải lại toàn bộ JS mỗi lần F5 | Trung bình | Tách cache policy `index.html` vs `/assets/*` (§Phase 6.3). |
| **R13** | Không có CI — mọi cổng chất lượng phụ thuộc vào việc người ta nhớ chạy lệnh | Trung bình | `.github/workflows/ci.yml` từ Phase 0 (§Phase 0). Nếu không dùng GitHub Actions thì phải có `scripts/ci-local.sh` tương đương và ghi vào DoD. |
| **R14** | Upload `.ipa` vài trăm MB qua Vite proxy hoặc qua `fetch` không progress | Trung bình | Raw body, không FormData (§6.6). XHR cho progress. Kiểm chứng bằng file lớn thật ở Phase 2, không đợi Phase 4 trang 6. |
| **R15** | `routeTree.gen.ts` bị Prettier/ESLint đụng vào → diff rác mỗi lần thêm route; hoặc bị gitignore → CI typecheck gãy | Thấp | Ignore ở Prettier + ESLint, **commit** vào git (giống `sen`). §6.3, §Phase 1.9. |

---

## 9. Tổng ước lượng

| Phase | Nội dung | Ngày công | Đổi so với bản đầu |
|---|---|---:|---|
| 0 | Nền móng chất lượng **+ CI** | 1,5 – 2 | +0,5 (CI) |
| 1 | Khung app Vite + Router + shadcn **+ basepath + cổng typecheck** | 2,5 – 3,5 | +0,5 |
| 2 | **Contract** + tầng API + design token + layout | 3 – 3,5 | +1 (§6.1b) |
| 3 | Hạ tầng test (Vitest, MSW-SSE, Playwright, tsconfig.test) | 2 – 2,5 | +0,5 |
| 4 | Migrate 12 trang | 12 – 17 | — |
| 5 | E2E + đối chiếu song song | 2 – 2,5 | +0,5 |
| 6 | Cutover + dọn dẹp | 1,5 – 2 | — |
| | **Tổng** | **25 – 34 ngày công** | +3 – 4 |

Phase 0–3 nối tiếp nhau (≈9–11,5 ngày, một người). Từ Phase 4, hai người có thể chạy song song theo
trang — đường găng khi đó là Scenario Review (4 ngày).

**Ba ngày cộng thêm không phải là phình phạm vi.** Chúng là công việc mà bản kế hoạch đầu đã ngầm
giả định là miễn phí: contract type (§6.1b) là điều kiện cần để có "tầng API có type" ở G9, còn CI
là điều kiện cần để mọi ô checkbox trong DoD có nghĩa.

---

## 10. Các câu hỏi đã chốt

Bản đầu để mở bốn câu. Đây là quyết định — không cần hỏi lại trước Phase 1.

1. **Zustand: CÓ, nhưng chỉ một store.** Bản đầu đề xuất bỏ hẳn vì "gần như toàn bộ state là server
   state". Đúng cho 11/12 trang — **nhưng sai cho `jobStore`** (§6.2 / R10). Một job đang stream
   không phải server state (Query không mô hình hoá được dòng chảy) và cũng không thể là component
   state (unmount là mất). Nó là client state có vòng đời dài hơn mọi component.
   → Cài `zustand`, tạo **đúng một** store: `ui/src/stores/jobStore.ts`. Thêm store thứ hai phải có
   lý do viết ra.
   → Bộ lọc của Scenario Review đi vào **URL search param** của TanStack Router, đúng như bản đầu
   nhận định. Không phải Zustand.
2. **Ngôn ngữ giao diện: giữ tiếng Việt, không đưa i18n vào phạm vi.** Giữ nguyên từng chuỗi hiện có,
   kể cả 6 đoạn `why` trong `NAV` và các thông báo lỗi tiếng Việt do server trả về
   (`'platform phải là android hoặc ios.'`, `'File rỗng.'`, …) — chúng đến từ backend, FE chỉ hiển thị.
3. **`recharts` cho Dashboard: KHÔNG trong đợt này.** Dashboard hiện là 4 ô số (39 dòng). Vẫn cài
   `recharts` theo danh sách dep của `sen` để hai project không lệch, nhưng không thêm biểu đồ nào.
   Giữ nguyên tính năng là mục tiêu của một cuộc migrate.
4. **Người đối chiếu ở Phase 5.** Nếu không có người thuộc lòng UI cũ:
   → Dùng chính TestPilot làm công cụ đối chiếu, hoặc dựng bộ ảnh chụp màn hình tham chiếu **trước
   khi** bắt đầu Phase 4: chụp cả 12 trang của app cũ ở trạng thái có dữ liệu, lưu vào
   **`ui/baseline/`**. Đây là 0,5 ngày và nó biến "đối chiếu" từ trí nhớ thành so ảnh.
   → **Không dùng `docs/`** — `.gitignore:8` đang loại cả thư mục đó, bộ ảnh sẽ không bao giờ vào git.
   → Nếu bỏ qua, cộng ~2 ngày vào Phase 5 và làm dày e2e ở Phase 3.

---

## 11. Bộ khung để bắt đầu code

Phần này tồn tại để một người (hoặc một AI) mở kế hoạch ra là gõ được ngay, không phải suy diễn.

### 11.1 Thứ tự file — 20 file đầu tiên, đúng thứ tự tạo

```
 1  .prettierrc                      §6.3   copy từ sen (gốc monorepo)
 2  .prettierignore                  §6.3   loại src/ scripts/ generated/ registry/ features/ ui/src/routeTree.gen.ts
 3  .husky/pre-commit                       npx lint-staged
 4  .github/workflows/ci.yml         §Ph0
 5  ui/vite.config.ts                §6.5   base + proxy 4300 + outDir ../dist/ui/app
 6  ui/tsconfig.json                        solution: references app/node/test
 7  ui/tsconfig.app.json             §6.1a  types:["vite/client","node"], paths @core/*, BỎ ignoreDeprecations
 8  ui/tsconfig.node.json
 9  ui/tsconfig.test.json            §3.2
10  ui/eslint.config.js              §6.1c  + no-restricted-imports/globals
11  ui/vitest.config.ts
12  ui/playwright.config.ts          §6.5   baseURL theo bảng
13  ui/components.json                      new-york / slate / cssVariables / config:""
14  ui/index.html
15  ui/src/index.css                 §Ph2.8 Tailwind 4 @theme + token shadcn + dark
16  ui/src/main.tsx                  §6.5   basepath: import.meta.env.BASE_URL
17  ui/src/routes/__root.tsx                Outlet + Toaster + devtools + notFound
18  src/ui/contracts.ts              §6.1b  ⛔ backend change #2
19  ui/src/api/client.ts             §Ph2.3 nhánh issues + error
20  ui/src/lib/streamJob.ts          §6.2
```

### 11.2 `ui/src/lib/streamJob.ts` — port từ `app.js:5690`

Bản gốc đã đúng; việc cần làm là tách phần **parse** khỏi phần **vẽ DOM**, và thêm `AbortSignal`.

```ts
export type JobFrame =
  | { type: 'log'; line: string }
  | { type: 'run'; run: WorkflowRun }
  | { type: 'error'; message: string }
  | { type: 'done'; ok: boolean };

export async function streamJob(
  path: string,
  body: unknown,
  onFrame: (f: JobFrame) => void,
  signal?: AbortSignal,
): Promise<{ lastRun: WorkflowRun | null; ok: boolean }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastRun: WorkflowRun | null = null;
  let failure: string | null = null;
  let ok = false;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Khung SSE ngăn nhau bằng dòng trống. Phần đuôi chưa đủ một khung được giữ lại
    // trong buffer — chia gói TCP không trùng ranh giới khung.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const raw = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || raw === undefined) continue;
      const data: unknown = JSON.parse(raw);

      if (event === 'log') onFrame({ type: 'log', line: data as string });
      else if (event === 'run') { lastRun = data as WorkflowRun; onFrame({ type: 'run', run: lastRun }); }
      else if (event === 'error') { failure = data as string; onFrame({ type: 'error', message: failure }); }
      else if (event === 'done') { ok = (data as { ok: boolean }).ok; onFrame({ type: 'done', ok }); }
    }
  }
  // `printed` giữ nguyên quy ước của app.js:5738 — lỗi đã hiện trên console rồi,
  // caller không được toast lần nữa.
  if (failure) throw Object.assign(new Error(failure), { printed: true });
  return { lastRun, ok };
}
```

### 11.3 `ui/src/stores/jobStore.ts` — vì sao stream không thuộc về component

```ts
import { create } from 'zustand';

const MAX_LOG_LINES = 5_000;   // farm run dài sinh hàng chục nghìn dòng

export interface Job {
  logs: string[];
  run: WorkflowRun | null;
  status: 'idle' | 'running' | 'done' | 'error';
  error: string | null;
  controller: AbortController | null;
}

interface JobState {
  jobs: Record<string, Job>;
  start: (id: string, path: string, body: unknown) => Promise<void>;
  abort: (id: string) => void;
  reset: (id: string) => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: {},
  async start(id, path, body) {
    // Đã chạy rồi thì không chạy chồng — hai stream cùng ghi vào một job là log lẫn lộn.
    if (get().jobs[id]?.status === 'running') return;
    const controller = new AbortController();
    set((s) => ({ jobs: { ...s.jobs, [id]: { logs: [], run: null, status: 'running', error: null, controller } } }));
    try {
      await streamJob(path, body, (f) => set((s) => ({ jobs: { ...s.jobs, [id]: applyFrame(s.jobs[id]!, f) } })), controller.signal);
      set((s) => ({ jobs: { ...s.jobs, [id]: { ...s.jobs[id]!, status: 'done', controller: null } } }));
    } catch (err) {
      set((s) => ({ jobs: { ...s.jobs, [id]: { ...s.jobs[id]!, status: 'error', error: (err as Error).message, controller: null } } }));
    }
    // Cầu nối duy nhất sang mô hình state kia.
    void queryClient.invalidateQueries();
  },
  abort(id) { get().jobs[id]?.controller?.abort(); },
  reset(id) { set((s) => { const { [id]: _, ...rest } = s.jobs; return { jobs: rest }; }); },
}));
```

`useStreamJob(id)` chỉ là một `useJobStore((s) => s.jobs[id])` cộng hai hàm `start`/`abort`.
**Không có `useEffect` nào gọi `abort` lúc cleanup** — đó chính là điểm khác biệt với cách viết
thông thường, và là lý do R10 không xảy ra.

### 11.4 Bản đồ route → panel → trang cũ

| Route mới | Panel | `data-page` cũ | Endpoint chính |
|---|---|---|---|
| `/` | `Dashboard` | `dashboard` | `GET /api/state` |
| `/studio` | `ScenarioStudio` | `studio` | `PUT /api/config`, `POST /api/studio/save`, `POST /api/gen`* |
| `/scenarios` | `ScenarioReview` | `scenario-review` | `PUT /api/feature`, `POST /api/feature/review{,-bulk}`, `/api/vocabulary` |
| `/scenarios/history` | `ScenarioHistory` | `scenario-history` | `GET /api/history` |
| `/healing` | `HealingCenter` | `healing-center` | `GET /api/healing`, `POST /api/healing/review` |
| `/builds` | `Builds` | `builds` | `GET /api/builds`, `POST /api/app/upload` |
| `/runner` | `LocalRunner` | `e2e-runner` | `POST /api/run`*, `POST /api/run/stop`, `/api/preflight` |
| `/runner/history` | `RunnerHistory` | `e2e-history` | `GET /api/history` |
| `/farm` | `DeviceFarm` | `device-farm` | `/api/farm/*`, `POST /api/aws/login`* |
| `/farm/$runId` | `FarmRunDetail` | `farm-run-detail` | static `/runs/**` (Range) |
| `/settings` | `Settings` | `settings` | `PUT /api/config`, `POST /api/model-key`, `/api/confluence-auth` |
| `/todo/$slug` | `Todo` | `todo` | — (6 mục NAV placeholder) |

`*` = route SSE-over-POST, đi qua `jobStore`.

### 11.5 Bốn thứ tuyệt đối không được làm

1. **Không `import` giá trị từ `../src/`** — chỉ `import type`. Một `import { ConfigSchema }` sẽ kéo
   `zod` + `node:fs` vào bundle trình duyệt và build gãy ở chỗ khó đọc.
2. **Không bọc upload build vào `FormData`** (§6.6).
3. **Không `abort()` stream trong `useEffect` cleanup** (§6.2 / R10).
4. **Không sửa logic trong `server.ts`.** Hai thay đổi được phép và chỉ hai: nhánh static `/next/`
   (§5.2) và kiểu trả về tường minh cho handler (§6.1b). Cả hai đều được `npm run typecheck` +
   `npm test` của backend gác.

---

## 12. Nhật ký kiểm chứng

Mọi con số trong tài liệu này đã được đối chiếu với mã nguồn thật, không phải ước lượng.

| Khẳng định | Kết quả |
|---|---|
| `server.ts` 3.329 dòng / `app.js` 5.826 / `index.html` 1.042 / `style.css` 2.018 | ✅ đúng |
| 41 route `/api/*` | ✅ đúng, đếm chính xác 41 `case` |
| 9 route SSE-over-POST | ✅ đúng, 9 lần `return stream(res, …)` |
| 12 `<section data-page>` | ✅ đúng |
| NAV 14 mục, 6 mục có `why` | ✅ đúng (`app.js:71`). Bản đầu ghi "đủ 15 mục" ở nghiệm thu Phase 2 — **đã sửa thành 14** |
| HTTP Range cho video | ✅ `serveFile()` xử lý `bytes=` và trả 206 |
| `PUT /api/config` validate bằng `ConfigSchema` | ✅ và trả mảng `issues` — **bản đầu bỏ sót nhánh này** |
| `bundle-farm.sh` nhét cả `dist/ui` vào zip farm | ✅ dòng 104 `cp -R dist "$STAGE/dist"` |
| Node ≥ 20.19 cho Vite 8 | ✅ máy đang chạy v22.21.1 |
| backend `tsconfig.json` chỉ `include: ["src/**/*.ts"]` | ✅ — `.tsx` không lọt vào |
| **`import type` từ `src/` compile được với tsconfig của `sen`** | ❌ **SAI** — 3 lỗi TS2307 (`node:fs`, `node:fs/promises`, `node:path`). Sửa ở §6.1a, đã kiểm chứng xanh với `"types":["vite/client","node"]` |
| **`server.ts` export type cho response** | ❌ **KHÔNG export gì cả** → §6.1b, +1 ngày |
| **`base:'/next/'` đủ để router chạy** | ❌ thiếu `basepath` → §6.5 |
| **`/api/app/upload` là multipart** | ❌ là **raw body + query string** → §6.6 |
| `flatpickr` "độ khó trung bình" | ⚠️ chỉ 3 chỗ dùng → hạ xuống Thấp |
| Nghiệm thu Phase 0 "commit một file `.md`" | ⚠️ pass rỗng — `lint-staged` chỉ khớp `ui/**`. Đã viết lại |
| Ước lượng 22–31 (§1) vs 22–30 (§9) | ⚠️ lệch nhau. Đã thống nhất **25–34** sau khi cộng contract + CI |

---

## 13. Nhật ký thực thi

### Phase 0 — ✅ xong

| File | Trạng thái |
|---|---|
| `.prettierrc` | mới — copy `sen`, **chưa có** `prettier-plugin-tailwindcss` (Phase 1 thêm) |
| `.prettierignore` | mới — che `src/ scripts/ generated/ registry/ features/ locators/ farm/ skills/ artifact_work/ outputs/` + `ui/src/routeTree.gen.ts` |
| `.husky/pre-commit` | mới — chỉ `npx lint-staged` (**không** `npm test` như mặc định của `husky init`) |
| `.github/workflows/ci.yml` | mới — 3 job: `backend`, `ui` (`continue-on-error` tới hết Phase 1), `format` |
| `ui/README.md` | mới — chỗ giữ chỗ, Phase 1 scaffold Vite vào đây |
| `package.json` | `engines.node = ^20.19.0 \|\| >=22.12.0`; `scripts.prepare = husky`; khối `lint-staged` khớp `ui/**` |

**Chưa làm, cố ý:** bộ ảnh baseline của §10.4 (`ui/baseline/`). Nó cần chạy app cũ với dữ liệu thật —
việc 0,5 ngày, làm bất cứ lúc nào **trước khi bắt đầu Phase 4**, không chặn Phase 1–3.

### Phase 1 — ✅ xong

| File | Trạng thái |
|---|---|
| `ui/vite.config.ts` | `root: import.meta.dirname` (config gọi từ gốc repo, `root` mặc định là cwd — không set là Vite đi tìm index.html nhầm chỗ); `base` `/` dev, `/next/` build; proxy 4 tiền tố sang `TESTPILOT_UI_PORT` |
| `ui/tsconfig.{json,app,node,test}.json` | project references, **không** `composite`; `types: ["vite/client","node"]`; `@core/*` → `../src/*` |
| `ui/eslint.config.js` | `@typescript-eslint/no-restricted-imports` + `allowTypeImports` |
| `ui/vitest.config.ts`, `ui/playwright.config.ts`, `ui/components.json` | theo `sen`, chỉnh path |
| `ui/src/index.css` | Tailwind 4 `@theme` + token shadcn light/dark + 5 token `--status-*` |
| `ui/src/main.tsx` | `basepath: import.meta.env.BASE_URL` |
| `ui/src/routes/{__root,index}.tsx`, `ui/src/components/ui/sonner.tsx`, `ui/src/lib/{utils,queryClient}.ts` | khung tối thiểu |
| `ui/src/routeTree.gen.ts` | sinh tự động, **có commit** |
| `src/ui/server.ts` | +41 dòng: `NEXT_DIR` + nhánh `/next/` + SPA fallback. **Thay đổi backend duy nhất tới giờ.** |
| `package.json` | 8 script `ui:*`; `typecheck` đã gồm `tsc -b ui` |
| `.github/workflows/ci.yml` | gỡ `continue-on-error` |
| `.prettierrc` | bật `prettier-plugin-tailwindcss` (hoãn từ Phase 0) |

**Nghiệm thu — chạy thật:**

| Phép thử | Kết quả |
|---|---|
| `ui:lint` / `ui:typecheck` / `ui:build` / `typecheck` (cả repo) | ✅ exit 0 |
| `npm test` backend sau khi vá `server.ts` | ✅ 835/835 |
| Dev `:5173` render, 0 lỗi console | ✅ |
| `fetch('/api/state')` qua Vite proxy | ✅ 200, trả đúng khoá `config/features/reports/…` |
| Light ↔ dark, 5 token `--status-*` đổi giá trị theo theme | ✅ |
| **`/next/` deep link 1 và 2 cấp trên bản build thật (Playwright)** | ✅ cả hai render `notFoundComponent`, asset resolve `/next/assets/…` ở mọi độ sâu, 0 lỗi console — đây là phép thử của §6.5 |
| `/next/assets/khong-co.js` | ✅ 404 JSON, **không** trả index.html |
| `GET /` (app cũ) | ✅ 200, nguyên vẹn |
| ESLint chặn `import { ConfigSchema }` từ `@core/`, cho qua `import type` | ✅ |
| devtools lọt vào bundle production | ✅ không (đã tree-shake) |

**Nợ kỹ thuật ghi nhận:** job `ui` của CI chạy `ui:build` thay cho `ui:test` — chưa có test nào thì
`vitest run` thoát 1. Phase 3 thêm lại `ui:test`.

### Việc đầu tiên của Phase 2

`src/ui/contracts.ts` (§6.1b) — phần rủi ro nhất còn lại, và Phase 1 vừa chứng minh nền cho nó đã
đứng được: `import type` xuyên biên compile sạch, và ESLint chặn đúng chiều còn lại.

