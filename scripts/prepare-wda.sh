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
#
# Logic nay nằm ở src/runner/wdaSetup.ts — cùng hàm với nút "Cài WebDriverAgent
# lên máy" trên web, nên hai đường không làm khác nhau. Máy mới chưa có trong
# provisioning profile cũng được lo luôn: nó tự build WebDriverAgent một lần
# với -allowProvisioningDeviceRegistration để Xcode đăng ký máy với team.
set -euo pipefail

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      echo "Dùng: bash scripts/prepare-wda.sh [--device <id hoặc udid>] [--config <file>]"
      echo
      echo "Mỗi chiếc máy cần chạy một lần. WebDriverAgent nằm TRÊN máy, nên máy mới"
      echo "cắm vào là máy chưa có gì — và tin cậy cũng là chuyện của riêng máy đó."
      exit 0 ;;
    --skip-install)
      echo "--skip-install không còn được hỗ trợ." >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."
exec npx tsx src/cli/prepare-wda.ts "$@"
