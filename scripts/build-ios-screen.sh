#!/usr/bin/env bash
#
# Dựng TestPilot Screen Capture — app nhỏ quay màn hình iPhone cắm qua USB cho
# màn Điều khiển thiết bị (xem native/ios-screen/main.swift).
#
# Runner tự gọi script này lần đầu cần tới, và khi mã nguồn đổi. Chạy tay khi
# muốn dựng trước:   bash scripts/build-ios-screen.sh
#
# Ký bằng chứng chỉ "Apple Development" đầu tiên trong keychain nếu có. Điều này
# không phải trang trí: macOS nhớ quyền camera theo CHỮ KÝ của app. Ký bằng một
# chứng chỉ thật thì dựng lại vẫn giữ quyền; ký ad-hoc thì mỗi lần dựng lại là
# một app "mới", và hộp thoại xin quyền hiện lại trên máy chủ.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="native/ios-screen"
OUT="${1:-.testpilot/bin/TestPilotScreen.app}"

command -v swiftc >/dev/null || { echo "Thiếu swiftc — cài Xcode (hoặc Command Line Tools) trên máy này." >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS"
cp "$SRC/Info.plist" "$OUT/Contents/Info.plist"
swiftc -O "$SRC/main.swift" -o "$OUT/Contents/MacOS/TestPilotScreen" 2>&1 | grep -v "warning:" || true
[ -x "$OUT/Contents/MacOS/TestPilotScreen" ] || { echo "Biên dịch TestPilot Screen Capture hỏng." >&2; exit 1; }

IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development[^"]*\)".*/\1/p' | head -1)"
codesign --force --sign "${IDENTITY:--}" "$OUT" >/dev/null
# Dấu vân tay mã nguồn: runner so với nó để biết lúc nào phải dựng lại.
shasum -a 256 "$SRC/main.swift" "$SRC/Info.plist" | shasum -a 256 | cut -d' ' -f1 > "$OUT/Contents/source.sha256"
echo "✓ Đã dựng $OUT (ký bằng: ${IDENTITY:-ad-hoc})"
