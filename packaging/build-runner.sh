#!/usr/bin/env bash
# Dựng gói runner để phát hành.
#
# Gói phát hành KHÔNG phải cả repo: repo là `private: true`, và nó mang theo
# giao diện web, bộ test và mọi thứ chỉ cần lúc phát triển. Thứ một chiếc máy
# trong phòng lab cần là mã runner đã biên dịch cộng đúng phần phụ thuộc mà nó
# `import` thật.
#
# "Đúng phần" ở đây được ĐO chứ không được đoán: script dưới đi theo đồ thị
# import từ `dist/runner/main.js` và gom những gói nó thật sự chạm tới. Bản đầu
# chép nguyên khối `dependencies` của repo, và kết quả là mỗi chiếc máy trong
# phòng lab phải tải về React, Radix và Tailwind để chạy một tiến trình không
# vẽ gì lên màn hình — 1553 file, 9.5 MB.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=dist-runner

npm run build
rm -rf "$OUT"
mkdir -p "$OUT"

node packaging/collect-runner.mjs "$OUT"

echo "Đã dựng $OUT. Phát hành: (cd $OUT && npm publish)"
