# Control plane của TestPilot — CHỈ phần server, không phải runner.
#
# Ảnh này không có Appium, không có adb, không có Xcode, và đó là chủ ý: nó
# phục vụ HTTP và nói chuyện với DB. Phần chạm tới thiết bị sống trong
# `src/runner/`, trên máy có thiết bị cắm vào — xem FARM-ARCHITECTURE.md mục 12.
#
# Hệ quả đo được: ảnh nhỏ, khởi động nhanh, và một lỗ hổng trong nó không cho
# ai quyền chạy lệnh trên máy của người dùng.

FROM node:22-alpine AS build
WORKDIR /app

# Chỉ copy phần khai báo phụ thuộc trước, rồi mới copy mã nguồn. Docker cache
# theo từng lớp, nên sửa một dòng code không kéo theo việc cài lại toàn bộ
# node_modules — khác biệt giữa build 20 giây và build 4 phút.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src ./src
COPY ui ./ui
# Bundle React được build ở đây, vì server phục vụ nó như file tĩnh.
RUN npm run ui:build

# ── Ảnh chạy ────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV TESTPILOT_MODE=server

# `npm ci --omit=dev` ở ảnh cuối: devDependencies có vitest, playwright,
# eslint — không dòng nào trong số đó chạy lúc phục vụ request, và mỗi gói
# thừa là một gói phải theo dõi bản vá.
#
# `--ignore-scripts` là điều kiện, không phải tối ưu: `prepare` của repo này gọi
# `husky`, mà husky là devDependency — nên không có nó, `npm ci --omit=dev` thất
# bại với exit 127. Bỏ script cài đặt ở ảnh chạy còn đúng vì một lý do thứ hai:
# script postinstall của phụ thuộc là mã tuỳ ý chạy lúc dựng ảnh.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY tsconfig*.json ./
COPY src ./src

# scrcpy-server, thứ `src/runner/scrcpy/session.ts` đẩy lên máy Android. Không
# có nó thì container vẫn chạy — nó tụt về `screenrecord` — nhưng tụt lặng lẽ,
# và một chiếc máy cắm thẳng vào host này sẽ chậm hơn mà không ai biết vì sao.
COPY vendor ./vendor

# Những thư mục mà server GHI vào, tạo sẵn và giao cho `node`.
#
# `/app` thuộc root, nên một tiến trình chạy bằng `node` không tạo được thư mục
# con — và lỗi ấy không phải cảnh báo, nó là EACCES lúc khởi động, container
# chết ngay ở dòng `ensurePersonalConfig`. Đây là lỗi thứ ba của cùng một lần
# build, và chỉ lộ ra khi CHẠY THẬT ảnh, không phải khi build xong.
#
# Danh sách này lấy từ `Paths` trong src/config.ts. Nó mang tính chuyển tiếp:
# P2.4 đưa registry vào Postgres và P2.5 đưa artifact lên S3, lúc ấy phần lớn
# các dòng dưới đây biến mất.
RUN mkdir -p /app/.testpilot /app/registry /app/runs /app/reports /app/artifacts \
      /app/features /app/docs \
  && chown -R node:node /app/.testpilot /app/registry /app/runs /app/reports \
      /app/artifacts /app/features /app/docs

# Trạng thái không được nằm trong layer: một container bị thay là một lần mất
# registry, và hai bản đang chạy sẽ thấy hai registry khác nhau.
VOLUME ["/app/registry", "/app/runs", "/app/artifacts"]

# Chạy bằng người dùng KHÔNG phải root.
#
# `node` đã có sẵn trong ảnh gốc với uid 1000. Nếu một lỗ hổng cho phép thực
# thi mã trong container này, chạy bằng root nghĩa là mã ấy đọc và sửa được mọi
# file trong container, kể cả những thứ được mount vào.
USER node

EXPOSE 4300

# Health check của Docker dùng đúng endpoint mà load balancer dùng: hai câu trả
# lời khác nhau về "còn sống" là hai nguồn sự thật, và chúng sẽ lệch nhau.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4300/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `tsx` nằm ở `dependencies`, không phải devDependencies, vì server chạy trực
# tiếp từ TypeScript — nó là thứ cần lúc phục vụ request, và `npx` trong một ảnh
# không có nó sẽ đi tải từ mạng lúc khởi động.
CMD ["npx", "tsx", "src/ui/server.ts"]
