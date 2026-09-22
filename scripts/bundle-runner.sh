#!/usr/bin/env bash
# Đóng gói runner để mang sang máy khác.
#
# Vì sao cần: máy phòng lab không nên có bản sao repo kèm lịch sử git, secret
# và node_modules dev. Gói này chỉ có thứ runner thật sự chạy.
#
# Nó KHÔNG gói `node_modules`: bản build phụ thuộc kiến trúc máy (`better-sqlite3`,
# các driver của Appium), nên máy đích tự chạy `npm ci --omit=dev`.
set -euo pipefail

OUT="build/testpilot-runner.tar.gz"
STAGE="build/runner-stage"

if [ ! -f package.json ]; then
  echo "Chạy script này từ thư mục gốc của repo." >&2
  exit 2
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"

# Mã nguồn runner và những thứ nó gọi tới. `src/server` có mặt vì runner dùng
# `queue`, `scheduler/match` và `db/leaseRepo` — chúng là hợp đồng dùng chung,
# không phải phần web.
cp -R src "$STAGE/src"
cp package.json package-lock.json tsconfig.json "$STAGE/"
[ -f testpilot.config.json ] && cp testpilot.config.json "$STAGE/"

# Bỏ những thứ không thuộc về một máy chạy test.
rm -rf "$STAGE/src/ui" "$STAGE/src/dev"
find "$STAGE/src" -name '__tests__' -type d -prune -exec rm -rf {} +
find "$STAGE/src" -name '*.test.ts' -delete

# Secret không bao giờ đi theo gói. Một lần lọt vào đây là một lần nằm trên đĩa
# của một máy mà không ai nhớ đã copy gì lên.
rm -f "$STAGE/.testpilot.secrets.json" "$STAGE/.env" "$STAGE/.env.server"

mkdir -p build
tar -czf "$OUT" -C "$STAGE" .
echo "Đã đóng gói: $OUT ($(du -h "$OUT" | cut -f1))"
echo
echo "Trên máy đích:"
echo "  mkdir -p ~/testpilot-runner && tar -xzf testpilot-runner.tar.gz -C ~/testpilot-runner"
echo "  cd ~/testpilot-runner && npm ci --omit=dev"
echo "  TESTPILOT_SERVER=https://… TESTPILOT_RUNNER_TOKEN=… npm run runner"
