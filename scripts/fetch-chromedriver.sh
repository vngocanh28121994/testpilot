#!/usr/bin/env bash
# Fetch a linux64 chromedriver for the WebView on the target device.
#
# Why this exists: a hybrid app needs Appium to drive the WebView through
# chromedriver, and the driver has to match the device's Chrome build. Appium
# can download one itself, but only if the host has outbound internet — and the
# AWS Device Farm test host does not appear to. The device reported Chrome
# 150.0.7871 and a matching driver *is* published, so the fix is to ship it
# inside the test package instead of hoping the farm can reach Google.
#
#   ./scripts/fetch-chromedriver.sh 150.0.7871
#
# Finds the newest published build on that prefix. linux64 because the Appium
# host is Linux, regardless of what you develop on.
set -euo pipefail

PREFIX="${1:-}"
OUT="build/chromedriver"

if [ -z "$PREFIX" ]; then
  echo "Dùng: $0 <tiền tố phiên bản Chrome>    ví dụ: $0 150.0.7871" >&2
  echo "Lấy phiên bản WebView của máy từ log Appium: \"No Chromedriver found that can automate Chrome 'X'\"." >&2
  exit 2
fi

URL=$(curl -fsSL "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json" \
  | PREFIX="$PREFIX" node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const prefix = process.env.PREFIX;
      const hits = JSON.parse(raw).versions
        .filter((v) => v.version.startsWith(prefix))
        .filter((v) => (v.downloads?.chromedriver ?? []).some((d) => d.platform === "linux64"));
      if (!hits.length) {
        console.error(`Không có chromedriver linux64 nào cho "${prefix}".`);
        process.exit(1);
      }
      const best = hits[hits.length - 1];
      console.error(`chromedriver ${best.version} (linux64)`);
      process.stdout.write(best.downloads.chromedriver.find((d) => d.platform === "linux64").url);
    });
  ')

rm -rf "$OUT" && mkdir -p "$OUT"
curl -fsSL "$URL" -o "$OUT/cd.zip"
unzip -qo "$OUT/cd.zip" -d "$OUT"
# The archive nests the binary one directory down.
find "$OUT" -name chromedriver -type f -exec mv {} "$OUT/chromedriver" \;
rm -rf "$OUT/cd.zip" "$OUT/chromedriver-linux64"
chmod +x "$OUT/chromedriver"

echo "wrote $OUT/chromedriver  ($(du -h "$OUT/chromedriver" | cut -f1))"
file "$OUT/chromedriver" 2>/dev/null | sed 's/^/  /' || true
