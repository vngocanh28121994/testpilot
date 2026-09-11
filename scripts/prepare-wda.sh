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

CONFIG="testpilot.config.json"
WANT=""          # id trong ios.devices, hoặc udid
SKIP_INSTALL=0   # dựng và ký, nhưng không đụng vào máy
OUT="build/wda"

while [ $# -gt 0 ]; do
  case "$1" in
    --device|--udid) WANT="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    -h|--help)
      echo "Dùng: bash scripts/prepare-wda.sh [--device <id hoặc udid>] [--config <file>] [--skip-install]"
      echo
      echo "Mỗi chiếc máy cần chạy một lần. WebDriverAgent nằm TRÊN máy, nên máy mới"
      echo "cắm vào là máy chưa có gì — và tin cậy cũng là chuyện của riêng máy đó."
      exit 0 ;;
    *) echo "Không hiểu tham số: $1" >&2; exit 1 ;;
  esac
done

# Chọn máy. Một máy thì khỏi hỏi; nhiều máy mà không nói rõ thì liệt kê ra rồi
# dừng — đoán bừa ở đây nghĩa là cài WDA lên đúng chiếc máy người dùng không định
# dùng, và họ chỉ phát hiện ra lúc lượt chạy hỏng.
SELECTED="$(node -e '
const fs = require("fs");
const [file, want] = process.argv.slice(1);
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
const ios = cfg.ios ?? {};
const devices = (ios.devices ?? []).filter((d) => d.udid);
let picked;
if (want) {
  picked = devices.find((d) => d.udid === want || d.id === want);
  if (!picked) {
    // udid gõ tay, chưa khai trong config: vẫn dùng được, chỉ là không có tên.
    if (/^[0-9A-Fa-f-]{8,}$/.test(want)) picked = { udid: want };
    else {
      console.error(`Không có máy nào tên "${want}" trong ${file}.`);
      console.error("Có: " + devices.map((d) => `${d.id} (${d.udid})`).join(", "));
      process.exit(1);
    }
  }
} else if (devices.length === 1) {
  picked = devices[0];
} else {
  console.error(devices.length === 0
    ? `Chưa khai máy iOS nào trong ${file}.`
    : "Có nhiều máy, hãy nói rõ dùng máy nào: --device <id>");
  for (const d of devices) console.error(`  ${d.id}  ${d.udid}`);
  process.exit(1);
}
process.stdout.write([ios.wdaBundleId ?? "com.facebook.WebDriverAgentRunner", ios.teamId ?? "", picked.udid].join(" "));
' "$CONFIG" "$WANT")" || exit 1
read -r BUNDLE TEAM UDID <<<"$SELECTED"

[ -n "$TEAM" ] || { echo "Thiếu ios.teamId trong $CONFIG." >&2; exit 1; }

echo "→ bundle id : $BUNDLE.xctrunner"
echo "→ team      : $TEAM"
echo "→ máy       : $UDID"

# Chứng chỉ ký code của đúng team đó.
#
# Team ID nằm ở `OU` của subject, KHÔNG phải phần trong ngoặc của CN — phần đó
# là id của chứng chỉ. Đã nhầm chỗ này một lần và đi sửa nhầm hướng khá lâu.
CERTS="$(mktemp -d)"
trap 'rm -rf "$CERTS"' EXIT
security find-certificate -a -p -c "Apple Development" > "$CERTS/all.pem" 2>/dev/null
awk -v dir="$CERTS" '/BEGIN CERTIFICATE/{n++} n{print > (dir "/cert" n ".pem")}' "$CERTS/all.pem"

CERT=""
for c in "$CERTS"/cert*.pem; do
  [ -e "$c" ] || continue
  if openssl x509 -in "$c" -noout -subject 2>/dev/null | grep -q "OU *= *$TEAM"; then
    CERT="$(openssl x509 -in "$c" -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2 | tr -d ':')"
    break
  fi
done
if [ -z "$CERT" ]; then
  echo "Trong Keychain không có chứng chỉ Apple Development nào của team $TEAM." >&2
  echo "Có: " >&2
  security find-identity -v -p codesigning | sed 's/^/  /' >&2
  exit 1
fi
echo "→ chứng chỉ: $CERT"

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
if [ -z "$PROFILE" ]; then
  cat >&2 <<MSG
Không thấy provisioning profile nào cho $BUNDLE.xctrunner.

Xcode là thứ cấp profile đó, và nó chỉ cấp khi đã build WebDriverAgent một lần
cho máy này. Cách lấy: tạm đặt ios.usePreinstalledWDA = false rồi chạy một lượt
iOS — lượt đó sẽ đi đường xcodebuild, Xcode cấp profile, rồi chạy lại script này.
MSG
  exit 1
fi

# Máy phải nằm trong danh sách thiết bị của profile. Thiếu thì devicectl từ chối
# cài, và câu lỗi của nó không nhắc gì tới profile — dễ đi sửa nhầm chỗ.
security cms -D -i "$PROFILE" > "$CERTS/profile.plist" 2>/dev/null
if ! /usr/libexec/PlistBuddy -c "Print :ProvisionedDevices" "$CERTS/profile.plist" 2>/dev/null \
     | grep -qi "$UDID"; then
  cat >&2 <<MSG
Máy $UDID chưa nằm trong provisioning profile đang có.

Đây là chuyện bình thường với một chiếc máy mới cắm lần đầu: profile chỉ liệt kê
những máy đã đăng ký với team, và Xcode là thứ thêm máy vào rồi cấp profile mới.

Cách xử lý, một lần cho mỗi máy mới:
  1. Cắm máy, mở khoá, tin cậy máy tính này.
  2. Tạm đặt ios.usePreinstalledWDA = false rồi chạy một lượt iOS trên máy đó.
     Lượt đó đi đường xcodebuild: Xcode đăng ký máy và cấp profile mới.
  3. Chạy lại script này với --device <id của máy đó>, rồi bật lại cờ.
MSG
  exit 1
fi

cp "$PROFILE" "$APP/embedded.mobileprovision"
security cms -D -i "$APP/embedded.mobileprovision" > /tmp/tp-wda-pp.plist
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" /tmp/tp-wda-pp.plist > /tmp/tp-wda-ent.plist

# dSYM không được ký và cũng không cần trên máy; để lại thì codesign kêu.
rm -rf "$APP/PlugIns/WebDriverAgentRunner.xctest.dSYM"
find "$APP/PlugIns/WebDriverAgentRunner.xctest/Frameworks" -maxdepth 1 -mindepth 1 2>/dev/null \
  | while read -r f; do codesign --force --timestamp=none --sign "$CERT" "$f" >/dev/null; done
codesign --force --timestamp=none --sign "$CERT" --entitlements /tmp/tp-wda-ent.plist "$APP/PlugIns/WebDriverAgentRunner.xctest"
codesign --force --timestamp=none --sign "$CERT" --entitlements /tmp/tp-wda-ent.plist "$APP"

if [ "$SKIP_INSTALL" = "1" ]; then
  echo "✓ Đã dựng và ký xong, chưa cài lên máy (--skip-install)."
  echo "  Bản ký sẵn nằm ở $APP"
  exit 0
fi

xcrun devicectl device install app --device "$UDID" "$PWD/$APP" >/dev/null
echo "✓ Đã cài $BUNDLE.xctrunner lên máy."
echo "  Mở Cài đặt › Cài đặt chung › VPN & Quản lý thiết bị → Tin cậy một lần, rồi bật ios.usePreinstalledWDA."
