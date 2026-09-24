#!/usr/bin/env bash
#
# Trỏ bản thử chế độ server vào IP HIỆN TẠI của máy này trong mạng nội bộ.
#
# Chỉ dành cho THỬ NGHIỆM trên một laptop: đổi Wi-Fi là đổi IP, và mọi thứ
# người khác dùng để vào máy chủ — trang đăng nhập Keycloak, link tải report
# (MinIO), địa chỉ runner nối về — đều mang IP ấy. Sửa tay từng chỗ mỗi lần đổi
# mạng là cách chắc chắn để quên một chỗ.
#
# Script làm, theo thứ tự:
#   1. Tìm IP hiện tại (en0, rồi en1).
#   2. Viết lại mọi URL trong .env.server sang IP ấy.
#   3. Cho Keycloak chấp nhận chuyển hướng đăng nhập về IP ấy (qua API quản trị,
#      không sửa file realm trong git — IP của một mạng Wi-Fi không thuộc về git).
#   4. Viết lại địa chỉ máy chủ trong hướng dẫn cài runner (build/runner-handoff).
#
# Không khởi động lại server: việc ấy là của người đang chạy nó.
#
# Dùng:  bash scripts/server-lan.sh            # tự tìm IP
#        bash scripts/server-lan.sh 10.0.0.5   # chỉ định IP
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.server"
[ -f "$ENV_FILE" ] || { echo "Chưa có $ENV_FILE. Chép từ .env.server.example trước." >&2; exit 1; }

IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
[ -n "$IP" ] || { echo "Không tìm được IP mạng nội bộ của máy này. Máy đang có mạng không?" >&2; exit 1; }
echo "→ IP máy chủ: $IP"

# 2. .env.server — thay host của đúng ba loại URL, giữ nguyên cổng và đường dẫn.
node - "$ENV_FILE" "$IP" <<'NODE'
const fs = require('fs');
const [file, ip] = process.argv.slice(2);
const keys = ['TESTPILOT_OIDC_ISSUER', 'TESTPILOT_OIDC_REDIRECT_URI', 'TESTPILOT_S3_ENDPOINT'];
const lines = fs.readFileSync(file, 'utf8').split('\n').map((line) => {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m || !keys.includes(m[1])) return line;
  const url = new URL(m[2]);
  url.hostname = ip;
  return `${m[1]}=${url.toString().replace(/\/$/, m[2].endsWith('/') ? '/' : '')}`;
});
fs.writeFileSync(file, lines.join('\n'));
NODE
grep -E "^(TESTPILOT_OIDC_ISSUER|TESTPILOT_OIDC_REDIRECT_URI|TESTPILOT_S3_ENDPOINT)=" "$ENV_FILE" | sed 's/^/   /'

# 3. Keycloak: thêm callback và origin cho IP mới. Mật khẩu quản trị là mật khẩu
#    DEV nằm sẵn trong docker-compose.yml — chỉ đúng cho môi trường thử này.
KC="http://127.0.0.1:8080"
TOKEN="$(curl -sf -m 10 -d client_id=admin-cli -d username=admin -d password=admin -d grant_type=password \
  "$KC/realms/master/protocol/openid-connect/token" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).access_token))')" \
  || { echo "Không vào được Keycloak ở $KC. Chạy 'docker compose up -d' trước." >&2; exit 1; }
CID="$(curl -sf -m 10 -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/testpilot/clients?clientId=testpilot" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].id))')"
CLIENT_JSON="$(mktemp)"
trap 'rm -f "$CLIENT_JSON"' EXIT
curl -sf -m 10 -H "Authorization: Bearer $TOKEN" "$KC/admin/realms/testpilot/clients/$CID" > "$CLIENT_JSON"
node - "$CLIENT_JSON" "$IP" <<'NODE'
const fs = require('fs');
const [file, ip] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(file, 'utf8'));
const add = (list, value) => { if (!list.includes(value)) list.push(value); };
add(c.redirectUris, `http://${ip}:4300/api/auth/callback`);
add(c.webOrigins, `http://${ip}:4300`);
fs.writeFileSync(file, JSON.stringify(c));
NODE
curl -sf -m 10 -o /dev/null -X PUT -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  --data @"$CLIENT_JSON" "$KC/admin/realms/testpilot/clients/$CID"
echo "   Keycloak chấp nhận đăng nhập qua http://$IP:4300"

# 4. Hướng dẫn cài runner: mọi địa chỉ máy chủ cũ → địa chỉ mới.
GUIDE="build/runner-handoff/HUONG-DAN.md"
if [ -f "$GUIDE" ]; then
  sed -E -i '' "s#http://[0-9.]+:4300#http://$IP:4300#g; s#\*\*http://[0-9.]+:4300\*\*#**http://$IP:4300**#g" "$GUIDE"
  echo "   Hướng dẫn runner trỏ về http://$IP:4300"
fi

echo "✓ Xong. Khởi động lại server để nạp .env.server mới, rồi mở http://$IP:4300"
echo "  Runner đã nối trước đó phải đăng nhập lại cho địa chỉ mới:"
echo "  testpilot-runner-login --server http://$IP:4300 --token <token>"
