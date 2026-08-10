#!/usr/bin/env bash
# Build the Appium Node test package AWS Device Farm expects.
#
# Device Farm unzips this into $DEVICEFARM_TEST_PACKAGE_PATH and runs the
# commands in farm/testspec.yml. Playwright is deliberately excluded: it is a
# ~300MB dependency the native run never touches.
set -euo pipefail

OUT="build/testpilot-appium.zip"
STAGE="build/farm-stage"

# Check the inputs before touching anything. Without this the script dies on a
# bare `cp: features: No such file or directory`, which says nothing about the
# actual cause — that nobody has generated a suite yet.
missing=""
compgen -G "features/*.feature" > /dev/null || missing="$missing\n  - features/*.feature"
[ -f registry/elements.json ] || missing="$missing\n  - registry/elements.json"

if [ -n "$missing" ]; then
  printf 'Chưa đóng gói được, thiếu:%b\n\n' "$missing" >&2
  printf 'Sinh testcase trước đã: mở Scenario Studio và bấm "Bắt đầu chạy workflow",\n' >&2
  printf 'hoặc chạy `npm run gen` (cần ANTHROPIC_API_KEY).\n' >&2
  exit 1
fi

# A suite that binds fine can still be a no-op on the farm: scenarios tagged
# @web are filtered out on Android, and elements with only `web` candidates
# resolve nothing there. Both cost real device minutes to discover. Check here,
# the last free moment before the upload.
node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync("testpilot.config.json", "utf8"));
  const platform = (cfg.farm && cfg.farm.platform) || "android";
  const reg = JSON.parse(fs.readFileSync(cfg.paths?.registry ?? "registry/elements.json", "utf8"));

  const naked = Object.values(reg.elements).filter((e) => !(e.candidates?.[platform]?.length));
  if (naked.length) {
    console.error(`\nDừng: ${naked.length}/${Object.keys(reg.elements).length} element không có locator cho "${platform}":`);
    for (const e of naked.slice(0, 8)) console.error(`  - ${e.id} (chỉ có: ${Object.keys(e.candidates ?? {}).join(", ") || "không có gì"})`);
    console.error(`\nTrên thiết bị chúng sẽ không resolve được. Bổ sung candidate "${platform}" vào registry.`);
    process.exit(1);
  }

  // Tags sit on their own line above the Scenario they belong to, so this walks
  // lines and carries pending tags forward rather than trying to split blocks.
  const dir = cfg.paths?.features ?? "features";
  // Locator strategies are not interchangeable between hybrid and native. In a
  // WebView the driver resolves against the DOM, so css/role are fine; in
  // native mode css throws outright and role becomes a UiSelector className,
  // which needs an Android widget class, not "button". Both cost device
  // minutes to find out.
  const hybrid = Boolean(cfg[platform]?.hybrid);
  if (!hybrid) {
    const bad = [];
    for (const e of Object.values(reg.elements)) {
      for (const c of e.candidates?.[platform] ?? []) {
        if (c.strategy === "css") bad.push(`${e.id}: css "${c.value}" — ném lỗi ở chế độ native`);
        else if (c.strategy === "role" && !c.value.includes(".")) {
          bad.push(`${e.id}: role "${c.value}" — native cần class Android đầy đủ, vd android.widget.Button`);
        }
      }
    }
    if (bad.length) {
      console.error(`\nDừng: ${platform}.hybrid = false nhưng registry còn locator kiểu web:`);
      for (const b of bad.slice(0, 8)) console.error(`  - ${b}`);
      console.error("\nỞ chế độ native chỉ label/testId/xpath/predicate là dùng được.");
      process.exit(1);
    }
  }

  const other = { android: "@ios", ios: "@android" }[platform];
  let runnable = false;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".feature"))) {
    let pending = [];
    let featureTags = [];
    for (const line of fs.readFileSync(`${dir}/${f}`, "utf8").split("\n")) {
      const t = line.trim();
      if (t.startsWith("@")) { pending.push(...(t.match(/@[\w-]+/g) ?? [])); continue; }
      if (/^Feature:/.test(t)) { featureTags = pending; pending = []; continue; }
      if (/^(Scenario|Scenario Outline|Example):/.test(t)) {
        const tags = [...featureTags, ...pending].filter((x) => ["@web", "@android", "@ios"].includes(x));
        if (tags.length === 0 || tags.includes(`@${platform}`)) runnable = true;
        pending = [];
      }
    }
  }
  if (!runnable) {
    console.error(`\nDừng: không scenario nào chạy trên "${platform}" — tất cả đều gắn tag nền tảng khác (${other}/@web).`);
    console.error("Bỏ tag đó, hoặc thêm @" + platform + ". Chạy như hiện tại là tốn phút thiết bị mà không test gì.");
    process.exit(1);
  }
'

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE" build

cp -R dist "$STAGE/dist"
cp -R features "$STAGE/features"
cp -R registry "$STAGE/registry"

# The chromedriver a hybrid run needs, if it has been fetched. Shipped in the
# package because the Device Farm host cannot download one itself; see
# scripts/fetch-chromedriver.sh. `zip -y` is not used, so preserve the exec bit
# by re-applying it on the device (testspec does that).
HYBRID=$(node -e 'const c=require("./testpilot.config.json"); process.stdout.write(c.android?.hybrid || c.ios?.hybrid ? "1" : "")' 2>/dev/null || true)

if [ -n "$HYBRID" ] && [ -f build/chromedriver/chromedriver ]; then
  mkdir -p "$STAGE/chromedriver"
  cp build/chromedriver/chromedriver "$STAGE/chromedriver/chromedriver"
  chmod +x "$STAGE/chromedriver/chromedriver"
  echo "bundling chromedriver ($(du -h build/chromedriver/chromedriver | cut -f1))"
elif [ -z "$HYBRID" ] && [ -f build/chromedriver/chromedriver ]; then
  # Only a hybrid run ever spawns chromedriver, so shipping 21 MB of it to the
  # farm in native mode is pure upload time.
  echo "bỏ qua chromedriver — hybrid đang tắt, native không dùng tới"
elif [ -n "$HYBRID" ]; then
  echo "Cảnh báo: hybrid đang bật nhưng chưa có build/chromedriver/chromedriver." >&2
  echo "  Nếu host Device Farm không tải được driver, lượt chạy sẽ chết ở bước chuyển WebView." >&2
  echo "  Chạy: ./scripts/fetch-chromedriver.sh <phiên bản Chrome của máy>" >&2
fi
cp testpilot.config.json "$STAGE/"
cp package.json package-lock.json "$STAGE/" 2>/dev/null || cp package.json "$STAGE/"

# Strip the web-only dependency so the farm install stays small and fast.
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("'"$STAGE"'/package.json", "utf8"));
  delete p.dependencies.playwright;
  delete p.devDependencies;
  p.scripts = {};
  fs.writeFileSync("'"$STAGE"'/package.json", JSON.stringify(p, null, 2));
'

( cd "$STAGE" && zip -qr "../../$OUT" . )
echo "wrote $OUT"
