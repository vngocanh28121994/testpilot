// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { PriceBoardPage } from '../pages/PriceBoardPage.js';
import { AddStockModalPage } from '../pages/AddStockModalPage.js';

describe("Thêm mã cổ phiếu", () => {
  test("Thêm mã cổ phiếu mới vào danh mục", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("MEL");
      await addStockModalPage.assertSuggestionListText("MEL-HNX");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"MEL"});
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
      await addStockModalPage.enterSearchInput("Thép Mê Lin");
      await addStockModalPage.assertSuggestionListText("MEL-HNX");
    } finally {
      await ctx.close();
    }
  });

  test("Hiển thị tối đa 5 kết quả gợi ý khi tìm kiếm", async () => {
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

  test("Lọc trùng kết quả khi mã trùng với tên doanh nghiệp", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("MEL");
      await addStockModalPage.assertSuggestionListCollection({"kind":"countMatching","text":"MEL-HNX","operator":"equals","value":1});
    } finally {
      await ctx.close();
    }
  });

  test("Chọn mã cổ phiếu đã có trong danh mục sẽ scroll tới và focus vào dòng đó", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("TCB");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"focused"});
    } finally {
      await ctx.close();
    }
  });

  test("Xóa mã cổ phiếu khỏi danh mục hiện tại", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.openRowMenu("ADS");
      await priceBoardPage.tapXoaKhoiDanhMuc();
      await priceBoardPage.assertAdsNotVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Xóa mã khỏi danh mục hiện tại không ảnh hưởng danh mục khác", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.openRowMenu("ADS");
      await priceBoardPage.tapXoaKhoiDanhMuc();
      await priceBoardPage.selectFloorTabs("HOSE");
      await priceBoardPage.assertAdsVisible();
    } finally {
      await ctx.close();
    }
  });
});
