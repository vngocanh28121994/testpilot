import { chromium, type BrowserContext } from 'playwright';
import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { PlaywrightMcpObserver } from '../discovery/mcp/PlaywrightMcpObserver.js';
import { candidatesFor } from '../crawl/observe.js';

class MemoryTransport implements Transport {
  peer?: MemoryTransport;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    const peer = this.peer;
    if (!peer) throw new Error('MCP memory transport is not linked.');
    queueMicrotask(() => peer.onmessage?.(structuredClone(message)));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

function linkedTransports(): [MemoryTransport, MemoryTransport] {
  const client = new MemoryTransport();
  const server = new MemoryTransport();
  client.peer = server;
  server.peer = client;
  return [client, server];
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.setContent(`
  <main>
    <h1>Tài sản trái phiếu</h1>
    <label>Mã trái phiếu <input placeholder="Nhập mã" /></label>
    <button aria-label="Xem tài sản">Xem</button>
  </main>
`);

const server = await createConnection(
  { snapshot: { mode: 'full' }, codegen: 'none' },
  async () => context as unknown as BrowserContext,
);
const client = new Client({ name: 'testpilot-poc', version: '0.1.0' });
const [clientTransport, serverTransport] = linkedTransports();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
  const text = snapshot.content
    .filter((item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

  console.log(`tools=${tools.tools.length}`);
  console.log(`same-page=${text.includes('Tài sản trái phiếu')}`);
  console.log(`input-visible=${text.includes('Mã trái phiếu') || text.includes('Nhập mã')}`);
  console.log(`button-visible=${text.includes('Xem tài sản')}`);
  console.log(text.slice(0, 2_000));
  if (!text.includes('Tài sản trái phiếu')) console.log(text.slice(0, 2_000));

  const observer = new PlaywrightMcpObserver(() => context);
  try {
    const observed = await observer.observe();
    const textbox = observed.find((item) => item.role === 'textbox');
    const button = observed.find((item) => item.role === 'button');
    console.log(`adapter-elements=${observed.length}`);
    console.log(`adapter-textbox=${textbox?.name}/${textbox?.placeholder}`);
    console.log(`adapter-button=${button?.name}`);
    if (!textbox || !button) throw new Error('MCP adapter did not expose expected controls.');

    const textboxCandidate = candidatesFor(textbox, 'web').find((item) => item.strategy === 'role');
    const buttonCandidate = candidatesFor(button, 'web').find((item) => item.strategy === 'role');
    if (!textboxCandidate?.name || !buttonCandidate?.name) {
      throw new Error('MCP observation did not produce role/name locators.');
    }
    await page.getByRole(textboxCandidate.value as 'textbox', { name: textboxCandidate.name }).fill('TCBOND');
    await page.getByRole(buttonCandidate.value as 'button', { name: buttonCandidate.name }).click();
    console.log(`direct-fill=${await page.getByRole('textbox', { name: 'Mã trái phiếu' }).inputValue()}`);
    console.log(`direct-click=true`);
  } finally {
    await observer.close();
  }
} finally {
  await client.close().catch(() => {});
  await server.close().catch(() => {});
  await browser.close();
}
