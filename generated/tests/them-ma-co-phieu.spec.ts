// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { PriceBoardPage } from '../pages/PriceBoardPage.js';
import { AddStockModalPage } from '../pages/AddStockModalPage.js';
import { StockOptionsMenuPage } from '../pages/StockOptionsMenuPage.js';

describe("Thêm mã cổ phiếu trên Bảng giá cổ phiếu", () => {
  test("Thêm mã cổ phiếu mới vào danh mục trên Bảng giá cổ phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.assertSearchInputVisible();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListVisible();
      await addStockModalPage.tapStockSearchFirstResult();
      await addStockModalPage.tapAddStockButton();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });

  test("Mở chức năng Thêm mã cổ phiếu từ nút thêm", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.assertSearchInputVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Nhập số liệu để tìm kiếm mã cổ phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
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
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });

  test("Hiển thị danh sách kết quả khi nhập đủ 3 ký tự", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Cho phép chọn mã từ danh sách kết quả tìm kiếm", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await addStockModalPage.assertAddStockButtonVisible();
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
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("Vingroup");
      await addStockModalPage.assertSuggestionListVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Danh sách kết quả tìm kiếm hiển thị tối đa 5 mục", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListCollection({"kind":"count","operator":"atMost","value":5});
    } finally {
      await ctx.close();
    }
  });

  test("Kết quả trùng lặp giữa tìm theo mã và theo tên doanh nghiệp bị loại bỏ", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListCollection({"kind":"uniqueText"});
    } finally {
      await ctx.close();
    }
  });

  test("Mã chưa có trong danh mục được thêm mới vào dòng đầu tiên", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await addStockModalPage.tapAddStockButton();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });

  test("Mã đã có trong danh mục không được thêm mới và được focus", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await addStockModalPage.tapAddStockButton();
      await priceBoardPage.assertStockRowCollection({"kind":"countMatching","text":"VIC","operator":"equals","value":1});
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
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.rowOptionsButton");
      await priceBoardPage.tapRowOptionsButton();
      await stockOptionsMenuPage.assertRemoveFromCategoryVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Xoá mã cổ phiếu khỏi danh mục hiện tại", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.rowOptionsButton");
      await priceBoardPage.tapRowOptionsButton();
      await stockOptionsMenuPage.tapRemoveFromCategory();
      await priceBoardPage.assertStockRowText("VIC", 'notContains');
    } finally {
      await ctx.close();
    }
  });
});
