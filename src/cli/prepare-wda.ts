/**
 * Cài WebDriverAgent lên một chiếc iPhone — bản dòng lệnh của nút
 * "Cài WebDriverAgent lên máy" ở phần Trước khi chạy. Cùng một hàm
 * (`setupWda`), nên hai đường không bao giờ làm khác nhau.
 *
 *   npx tsx src/cli/prepare-wda.ts [--device <id hoặc udid>] [--config <file>]
 */
import { devicesOf, loadConfig } from '../config.js';
import { setupWda } from '../runner/wdaSetup.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log('Dùng: npx tsx src/cli/prepare-wda.ts [--device <id hoặc udid>] [--config <file>]');
    return;
  }
  const cfg = await loadConfig(flag('--config'));
  const want = flag('--device') ?? flag('--udid');
  const devices = devicesOf(cfg, 'ios').filter((device) => device.udid);
  const picked = want
    ? devices.find((device) => device.id === want || device.udid === want)?.udid
      ?? (/^[0-9A-Fa-f-]{8,}$/.test(want) ? want : undefined)
    : devices.length === 1 ? devices[0]!.udid : undefined;
  if (!picked) {
    console.error(want
      ? `Không có máy nào tên "${want}" trong cấu hình.`
      : 'Có nhiều máy (hoặc chưa khai máy nào), hãy nói rõ: --device <id hoặc udid>');
    for (const device of devices) console.error(`  ${device.id}  ${device.udid}`);
    process.exit(1);
  }
  await setupWda(cfg, picked, (line) => console.log(line));
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
