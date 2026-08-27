// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { PriceBoardPage } from '../pages/PriceBoardPage.js';
import { AddStockModalPage } from '../pages/AddStockModalPage.js';

describe("Chức năng Thêm mã cổ phiếu", () => {
  test("Thêm mã cổ phiếu đã có trong danh mục", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"count","operator":"atLeast","value":1});
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"countMatching","text":"VIC","operator":"equals","value":1});
    } finally {
      await ctx.close();
    }
  });

  test("Tìm kiếm mã cổ phiếu theo tên doanh nghiệp", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("Tập đoàn Vingroup");
      await addStockModalPage.assertSuggestionListText("VIC-HOSE");
    } finally {
      await ctx.close();
    }
  });

  test("Tìm kiếm mã cổ phiếu hiển thị tối đa 5 kết quả", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("M");
      await addStockModalPage.assertSuggestionListCollection({"kind":"count","operator":"atMost","value":5});
    } finally {
      await ctx.close();
    }
  });

  test("Tìm kiếm theo mã ưu tiên hơn tìm kiếm theo tên doanh nghiệp", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertStockSearchFirstResultText("VIC-HOSE");
    } finally {
      await ctx.close();
    }
  });

  test("Tự động lọc trùng kết quả tìm kiếm từ mã và tên doanh nghiệp", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListCollection({"kind":"countMatching","text":"VIC-HOSE","operator":"equals","value":1});
    } finally {
      await ctx.close();
    }
  });

  test("Xóa mã cổ phiếu khỏi danh mục", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.assertStockRowText("VIC");
      await priceBoardPage.openRowMenu("VIC");
      await priceBoardPage.tapXoaKhoiDanhMuc();
      await priceBoardPage.assertStockRowText("VIC-HOSE", 'notContains');
    } finally {
      await ctx.close();
    }
  });
});
