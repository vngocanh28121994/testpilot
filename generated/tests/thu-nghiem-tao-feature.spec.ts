// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { HomePage } from '../pages/HomePage.js';

describe("Thu nghiem tao feature", () => {
  test("Mo app roi kiem tra man hinh chinh", async () => {
    const ctx = await createPageContext();
    try {
      const homePage = new HomePage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      // app already launched via ctx.launch()
      await homePage.assertTotalAssetsVisible();
    } finally {
      await ctx.close();
    }
  });
});
