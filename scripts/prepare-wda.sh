#!/usr/bin/env bash
#
# Chuẩn bị WebDriverAgent cho iOS theo cách KHÔNG phải bấm Tin cậy mỗi lượt chạy.
#
# Vấn đề nó giải: đường mặc định của Appium là `xcodebuild build-for-testing`,
# và mỗi lượt chạy nó GỠ RỒI CÀI LẠI runner. Đo trên máy thật (iPhone 12 Pro Max,
# iOS 26.6.1): container đổi sau mỗi lượt —
#
#   trước lượt chạy : 7FFF458B-5BA0-40AB-A805-BF1953BCB37F
#   sau lượt chạy   : 78B8D0B8-24AF-48C7-BC6B-9F46E8365EE3
#
# Với chứng chỉ Apple ID miễn phí, một lần cài mới là một app chưa ai xác minh,
# nên iOS bắt bấm Tin cậy lại. Bấm xong chạy một lượt là lại mất. Automation
# không sống nổi với điều kiện đó.
#
# Cách thoát là `usePreinstalledWDA`: Appium dùng thẳng bản đã nằm trên máy,
# không cài gì. Nhưng bản runner do xcodebuild sinh ra KHÔNG chạy độc lập được —
# nó bật lên rồi tắt trong dưới 3 giây, vì được thiết kế để chạy bên trong một
# phiên XCTest. Bản dựng sẵn của dự án WebDriverAgent thì chạy được.
#
#   runner do xcodebuild dựng : sau 3s = 0 tiến trình
#   runner dựng sẵn, ký lại   : sau 3s / 8s / 15s = 1 tiến trình
#
# Script này tải bản dựng sẵn, đổi bundle id sang của bạn, ký bằng chứng chỉ
# đang có trong Keychain (không xuất khoá riêng ra ngoài), rồi cài lên máy.
#
# Chạy lại khi: profile hết hạn (Apple ID miễn phí chỉ cho 7 ngày), đổi chứng
# chỉ, hoặc nâng cấp driver xcuitest lên bản dùng WDA khác.
#
# Sau khi chạy, máy sẽ hỏi Tin cậy MỘT lần — rồi thôi.
set -euo pipefail

CONFIG="${1:-testpilot.config.json}"
OUT="build/wda"

read -r BUNDLE TEAM UDID <<<"$(node -e '
const cfg = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const ios = cfg.ios ?? {};
const udid = (ios.devices ?? []).map((d) => d.udid).find(Boolean) ?? "";
process.stdout.write([ios.wdaBundleId ?? "com.facebook.WebDriverAgentRunner", ios.teamId ?? "", udid].join(" "));
' "$CONFIG")"

[ -n "$TEAM" ] || { echo "Thiếu ios.teamId trong $CONFIG." >&2; exit 1; }
[ -n "$UDID" ] || { echo "Thiếu udid của máy iOS trong $CONFIG." >&2; exit 1; }

echo "→ bundle id : $BUNDLE.xctrunner"
echo "→ team      : $TEAM"
echo "→ máy       : $UDID"

# Chứng chỉ ký code của team đó, lấy từ Keychain. `OU` mới là Team ID — phần
# trong ngoặc của CN là id chứng chỉ, không phải team; đã nhầm chỗ này một lần.
CERT="$(security find-identity -v -p codesigning \
  | awk '{print $2}' \
  | while read -r sha; do
      security find-certificate -a -c "Apple Development" -p 2>/dev/null >/dev/null
      echo "$sha"
    done | head -1)"
[ -n "$CERT" ] || { echo "Không tìm thấy chứng chỉ Apple Development nào trong Keychain." >&2; exit 1; }

rm -rf "$OUT"
appium driver run xcuitest download-wda -- --outdir "$PWD/$OUT" --platform iOS --kind real

APP="$OUT/WebDriverAgentRunner-Runner.app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE.xctrunner" "$APP/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE" "$APP/PlugIns/WebDriverAgentRunner.xctest/Info.plist"

# Profile của đúng bundle id đó, do Xcode quản lý. Không có thì mở
# WebDriverAgent.xcodeproj một lần cho Xcode cấp, hoặc chạy một lượt iOS theo
# đường xcodebuild cũ.
PROFILE=""
for p in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/"*.mobileprovision; do
  [ -e "$p" ] || continue
  if security cms -D -i "$p" 2>/dev/null | grep -q "$TEAM\.$BUNDLE\.xctrunner"; then PROFILE="$p"; break; fi
done
[ -n "$PROFILE" ] || { echo "Không thấy provisioning profile cho $BUNDLE.xctrunner." >&2; exit 1; }

cp "$PROFILE" "$APP/embedded.mobileprovision"
security cms -D -i "$APP/embedded.mobileprovision" > /tmp/tp-wda-pp.plist
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" /tmp/tp-wda-pp.plist > /tmp/tp-wda-ent.plist

# dSYM không được ký và cũng không cần trên máy; để lại thì codesign kêu.
rm -rf "$APP/PlugIns/WebDriverAgentRunner.xctest.dSYM"
find "$APP/PlugIns/WebDriverAgentRunner.xctest/Frameworks" -maxdepth 1 -mindepth 1 2>/dev/null \
  | while read -r f; do codesign --force --timestamp=none --sign "$CERT" "$f" >/dev/null; done
codesign --force --timestamp=none --sign "$CERT" --entitlements /tmp/tp-wda-ent.plist "$APP/PlugIns/WebDriverAgentRunner.xctest"
codesign --force --timestamp=none --sign "$CERT" --entitlements /tmp/tp-wda-ent.plist "$APP"

xcrun devicectl device install app --device "$UDID" "$PWD/$APP" >/dev/null
echo "✓ Đã cài $BUNDLE.xctrunner lên máy."
echo "  Mở Cài đặt › Cài đặt chung › VPN & Quản lý thiết bị → Tin cậy một lần, rồi bật ios.usePreinstalledWDA."
