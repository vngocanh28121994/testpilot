import { loadConfig } from '../src/config.js';
import { McpBridge, guessToolNames } from '../src/ingest/mcp.js';
const cfg = await loadConfig('testpilot.config.json');
const bridge = await McpBridge.connect(cfg.mcp as never);
const tools = await bridge.listTools();
console.log('TỔNG SỐ TOOL:', tools.length, '\n');
console.log('--- tool liên quan ảnh/attachment ---');
for (const t of tools) {
  if (/attach|image|media|download|screenshot/i.test(`${t.name} ${t.description}`))
    console.log(` • ${t.name}\n     ${t.description.slice(0, 120)}`);
}
console.log('\n--- tool Confluence ---');
for (const t of tools) if (/confluence/i.test(t.name)) console.log(' •', t.name);
console.log('\n--- ĐOÁN TỰ ĐỘNG ---');
console.log(JSON.stringify(guessToolNames(tools), null, 1));
process.exit(0);
