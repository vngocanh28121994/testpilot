import { BasePage } from '../../src/pom/BasePage.js';

/** Thêm mã cổ phiếu - Tìm kiếm */
export class AddStockSearchPage {
  constructor(private readonly page: BasePage) {}

  /** Danh sách gợi ý mã cổ phiếu
   * @testpilot-element addStockSearch.suggestionList action=assertVisible
   */
  async assertSuggestionListVisible(): Promise<void> {
    await this.page.assertVisible('addStockSearch.suggestionList');
  }

  /** Danh sách gợi ý mã cổ phiếu
   * @testpilot-element addStockSearch.suggestionList action=assertText
   */
  async assertSuggestionListText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('addStockSearch.suggestionList', expected, mode);
  }

  /** Danh sách gợi ý mã cổ phiếu
   * @testpilot-element addStockSearch.suggestionList action=assertCollection
   */
  async assertSuggestionListCollection(check: Parameters<BasePage['assertCollection']>[1]): Promise<void> {
    await this.page.assertCollection('addStockSearch.suggestionList', check);
  }
}
