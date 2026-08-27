import { BasePage } from '../../src/pom/BasePage.js';

/** Thêm mã cổ phiếu */
export class AddStockModalPage {
  constructor(private readonly page: BasePage) {}

  /** Ô tìm kiếm mã cổ phiếu
   * @testpilot-element addStockModal.searchInput action=input
   */
  async enterSearchInput(text: string): Promise<void> {
    await this.page.input('addStockModal.searchInput', text);
  }

  /** Một kết quả tìm kiếm
   * @testpilot-element addStockModal.searchResultItem action=tap
   */
  async tapSearchResultItem(): Promise<void> {
    await this.page.tap('addStockModal.searchResultItem');
  }

  /** Danh sách kết quả tìm kiếm
   * @testpilot-element addStockModal.searchResults action=assertText
   */
  async assertSearchResultsText(expected: string): Promise<void> {
    await this.page.assertText('addStockModal.searchResults', expected);
  }

  /** Danh sách kết quả tìm kiếm
   * @testpilot-element addStockModal.searchResults action=assertNotVisible
   */
  async assertSearchResultsNotVisible(): Promise<void> {
    await this.page.assertNotVisible('addStockModal.searchResults');
  }

  /** Danh sách kết quả tìm kiếm
   * @testpilot-element addStockModal.searchResults action=assertVisible
   */
  async assertSearchResultsVisible(): Promise<void> {
    await this.page.assertVisible('addStockModal.searchResults');
  }

  /** Ô tìm kiếm mã cổ phiếu
   * @testpilot-element addStockModal.searchInput action=assertVisible
   */
  async assertSearchInputVisible(): Promise<void> {
    await this.page.assertVisible('addStockModal.searchInput');
  }

  /** Ô mã cổ phiếu
   * @testpilot-element priceBoard.oMaCoPhieu action=input
   */
  async enterOMaCoPhieu(text: string): Promise<void> {
    await this.page.input('priceBoard.oMaCoPhieu', text);
  }

  /** Kết quả tìm kiếm đầu tiên
   * @testpilot-element priceBoard.stockSearchFirstResult action=tap
   */
  async tapStockSearchFirstResult(): Promise<void> {
    await this.page.tap('priceBoard.stockSearchFirstResult');
  }

  /** Danh sách gợi ý
   * @testpilot-element addStockModal.suggestionList action=assertText
   */
  async assertSuggestionListText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('addStockModal.suggestionList', expected, mode);
  }

  /** Danh sách gợi ý
   * @testpilot-element addStockModal.suggestionList action=assertCollection
   */
  async assertSuggestionListCollection(check: Parameters<BasePage['assertCollection']>[1]): Promise<void> {
    await this.page.assertCollection('addStockModal.suggestionList', check);
  }

  /** Kết quả tìm kiếm đầu tiên
   * @testpilot-element priceBoard.stockSearchFirstResult action=assertText
   */
  async assertStockSearchFirstResultText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('priceBoard.stockSearchFirstResult', expected, mode);
  }
}
