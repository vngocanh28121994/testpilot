// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { PriceBoardPage } from '../pages/PriceBoardPage.js';
import { AddStockModalPage } from '../pages/AddStockModalPage.js';
import { StockOptionsMenuPage } from '../pages/StockOptionsMenuPage.js';

describe("Thêm mã cổ phiếu trên Bảng giá cổ phiếu", () => {
  test("Thêm mã cổ phiếu mới vào danh mục trên Bảng giá", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });

  test("Mở chức năng Thêm mã cổ phiếu từ nút plus", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.assertSearchInputVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Tìm kiếm mã cổ phiếu theo dữ liệu nhập", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Kết quả khớp theo mã được ưu tiên hiển thị", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListCollection({"kind":"firstText","text":"VIC-HOSE"});
    } finally {
      await ctx.close();
    }
  });

  test("Tìm kiếm mã cổ phiếu theo tên doanh nghiệp", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
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

  test("Danh sách gợi ý hiển thị tối đa 5 kết quả", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListCollection({"kind":"count","operator":"atMost","value":5});
    } finally {
      await ctx.close();
    }
  });

  test("Kết quả trùng giữa mã và tên doanh nghiệp được lọc chỉ hiển thị một lần", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListCollection({"kind":"uniqueText"});
    } finally {
      await ctx.close();
    }
  });

  test("Chọn mã chưa có trong danh mục thì thêm mới vào dòng đầu tiên", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });

  test("Chọn mã đã có trong danh mục thì không thêm mới và focus vào dòng đó", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("TCB");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"countMatching","text":"TCB","operator":"equals","value":1});
      await priceBoardPage.assertStockRowCollection({"kind":"focused"});
    } finally {
      await ctx.close();
    }
  });

  test("Mở menu tùy chọn của dòng cổ phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.openRowMenu("ADS");
      await stockOptionsMenuPage.assertRemoveFromCategoryVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Xoá mã khỏi danh mục hiện tại", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.openRowMenu("ADS");
      await stockOptionsMenuPage.tapRemoveFromCategory();
      await priceBoardPage.assertStockRowText("ADS", 'notContains');
    } finally {
      await ctx.close();
    }
  });
});
