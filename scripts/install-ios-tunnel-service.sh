#!/usr/bin/env bash
#
# Cài tunnel iOS (WebView, iOS 17+) làm DỊCH VỤ HỆ THỐNG trên máy cắm iPhone.
#
# Vấn đề nó giải: tunnel cần quyền root, nên trước đây phải mở Terminal và gõ
# mật khẩu máy mỗi lần bật. Được khi người dùng ngồi ngay trước chiếc máy ấy.
# Không được với máy chủ của một device farm: mọi người làm việc từ xa, không
# ai ngồi ở máy chủ để gõ mật khẩu cả.
#
# Script này, chạy MỘT LẦN bằng sudo (người cài nhập mật khẩu đúng một lần):
#
#   1. Tạo LaunchDaemon `com.testpilot.ios-tunnel`: tunnel tự chạy khi máy
#      khởi động, và tự dựng lại khi chết.
#   2. Tạo quy tắc sudoers cho ĐÚNG MỘT lệnh — khởi động lại dịch vụ ấy — để
#      nút "Khởi động lại tunnel" trên web chạy được mà không cần mật khẩu.
#      Không lệnh nào khác được thêm quyền.
#
# Dùng:
#   sudo bash scripts/install-ios-tunnel-service.sh            # cài / cài lại
#   sudo bash scripts/install-ios-tunnel-service.sh --uninstall
#
# Trước khi cài: dừng tunnel đang chạy tay (Ctrl-C ở cửa sổ Terminal đó) —
# hai tunnel cùng lúc tranh nhau cổng.
set -euo pipefail

LABEL="com.testpilot.ios-tunnel"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
SUDOERS="/etc/sudoers.d/testpilot-ios-tunnel"
LOG="/Library/Logs/testpilot-ios-tunnel.log"

if [ "$(id -u)" -ne 0 ]; then
  echo "Cần chạy bằng sudo: sudo bash $0" >&2
  exit 1
fi

# Người sẽ bấm nút trên web — chủ của tiến trình TestPilot/runner. Là người đã
# gọi sudo, không phải root.
OWNER="${SUDO_USER:-}"
if [ -z "$OWNER" ] || [ "$OWNER" = "root" ]; then
  echo "Không biết ai là người dùng thường của máy này. Chạy bằng 'sudo bash $0' từ tài khoản chạy TestPilot." >&2
  exit 1
fi
OWNER_HOME="$(dscl . -read "/Users/$OWNER" NFSHomeDirectory | awk '{print $2}')"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "system/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST" "$SUDOERS"
  echo "✓ Đã gỡ dịch vụ tunnel và quy tắc sudoers."
  exit 0
fi

# Đường dẫn TUYỆT ĐỐI: launchd không đọc PATH của shell người dùng, và một dịch
# vụ chạy root mà đi tìm lệnh theo PATH là mời lệnh giả vào chạy.
APPIUM="$(sudo -u "$OWNER" -i command -v appium || true)"
NODE="$(sudo -u "$OWNER" -i command -v node || true)"
if [ -z "$APPIUM" ] || [ -z "$NODE" ]; then
  echo "Không tìm thấy appium hoặc node trong PATH của $OWNER. Cài Appium trước: npm install -g appium" >&2
  exit 1
fi
APPIUM_HOME="${OWNER_HOME}/.appium"
if [ ! -d "${APPIUM_HOME}/node_modules/appium-xcuitest-driver" ]; then
  echo "Chưa có driver xcuitest trong ${APPIUM_HOME}. Chạy (không sudo): appium driver install xcuitest" >&2
  exit 1
fi

echo "→ người dùng : $OWNER"
echo "→ appium     : $APPIUM"
echo "→ node       : $NODE"
echo "→ APPIUM_HOME: $APPIUM_HOME"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${APPIUM}</string>
    <string>driver</string>
    <string>run</string>
    <string>xcuitest</string>
    <string>tunnel-creation</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>APPIUM_HOME</key>
    <string>${APPIUM_HOME}</string>
    <key>HOME</key>
    <string>${OWNER_HOME}</string>
    <key>PATH</key>
    <string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Chết thì dựng lại, nhưng cách nhau 10 giây: một lỗi cấu hình không được
       biến thành vòng lặp khởi động hàng trăm lần mỗi phút. -->
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
</dict>
</plist>
PLIST
chown root:wheel "$PLIST"
chmod 644 "$PLIST"
plutil -lint "$PLIST" >/dev/null

# Quy tắc sudoers: ĐÚNG MỘT lệnh, đúng đối số. Kiểm bằng visudo trước khi đặt
# vào chỗ — một file sudoers hỏng có thể khoá luôn quyền sudo của cả máy.
TMP_SUDOERS="$(mktemp)"
trap 'rm -f "$TMP_SUDOERS"' EXIT
printf '%s ALL=(root) NOPASSWD: /bin/launchctl kickstart -k system/%s\n' "$OWNER" "$LABEL" > "$TMP_SUDOERS"
visudo -cf "$TMP_SUDOERS" >/dev/null
install -m 440 -o root -g wheel "$TMP_SUDOERS" "$SUDOERS"

launchctl bootout "system/${LABEL}" 2>/dev/null || true
launchctl bootstrap system "$PLIST"

echo "✓ Đã cài dịch vụ tunnel. Nó tự chạy khi máy khởi động và tự dựng lại khi chết."
echo "  Log: $LOG"
echo "  Nút 'Khởi động lại tunnel' trên web giờ chạy được mà không cần mật khẩu."
