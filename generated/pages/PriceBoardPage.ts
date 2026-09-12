import { BasePage } from '../../src/pom/BasePage.js';

/** Bảng giá cổ phiếu */
export class PriceBoardPage {
  constructor(private readonly page: BasePage) {}

  /** Cơ sở */
  async assertCoSoTabVisible(): Promise<void> {
    await this.page.assertVisible('priceBoard.coSoTab');
  }

  /** Thêm mã
   * @testpilot-element priceBoard.addStockButton action=tap
   */
  async tapAddStockButton(): Promise<void> {
    await this.page.tap('priceBoard.addStockButton');
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

  /** Xoá khỏi danh mục
   * @testpilot-element priceBoard.xoaKhoiDanhMuc action=tap
   */
  async tapXoaKhoiDanhMuc(): Promise<void> {
    await this.page.tap('priceBoard.xoaKhoiDanhMuc');
  }

  /** Icon ... tại dòng {{rowText}}
   * @testpilot-element priceBoard.rowActionMenu action=tap
   */
  async openRowMenu(rowText: string): Promise<void> {
    await this.page.tapRowAction('priceBoard.rowActionMenu', rowText, '...');
  }

  /** {{text}}
   * @testpilot-element priceBoard.dynamicText action=assertVisible
   */
  async assertTextVisible(text: string): Promise<void> {
    await this.page.assertVisible('priceBoard.dynamicText', { text: text });
  }

  /** {{text}}
   * @testpilot-element priceBoard.dynamicText action=assertNotVisible
   */
  async assertTextNotVisible(text: string): Promise<void> {
    await this.page.assertNotVisible('priceBoard.dynamicText', { text: text });
  }

  /** Kết quả tìm kiếm đầu tiên
   * @testpilot-element priceBoard.stockSearchFirstResult action=assertVisible
   */
  async assertStockSearchFirstResultVisible(): Promise<void> {
    await this.page.assertVisible('priceBoard.stockSearchFirstResult');
  }

  /** MEL-HNX
   * @testpilot-element priceBoard.melHnx action=tap
   */
  async tapMelHnx(): Promise<void> {
    await this.page.tap('priceBoard.melHnx');
  }

  /** Dòng cổ phiếu trong danh mục
   * @testpilot-element priceBoard.stockRow action=assertCollection
   */
  async assertStockRowCollection(check: Parameters<BasePage['assertCollection']>[1]): Promise<void> {
    await this.page.assertCollection('priceBoard.stockRow', check);
  }

  /** Dòng cổ phiếu trong danh mục
   * @testpilot-element priceBoard.stockRow action=assertText
   */
  async assertStockRowText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('priceBoard.stockRow', expected, mode);
  }

  /** VIC-HOSE
   * @testpilot-element priceBoard.vicHose action=tap
   */
  async tapVicHose(): Promise<void> {
    await this.page.tap('priceBoard.vicHose');
  }

  /** Danh mục theo dõi
   * @testpilot-element priceBoard.categoryDropdown action=select
   */
  async selectCategoryDropdown(option: string): Promise<void> {
    await this.page.select('priceBoard.categoryDropdown', option);
  }

  /** Tùy chọn mã cổ phiếu
   * @testpilot-element priceBoard.stockOptionsButton action=tap
   */
  async tapStockOptionsButton(): Promise<void> {
    await this.page.tap('priceBoard.stockOptionsButton');
  }

  /** ADS
   * @testpilot-element priceBoard.ads action=assertNotVisible
   */
  async assertAdsNotVisible(): Promise<void> {
    await this.page.assertNotVisible('priceBoard.ads');
  }

  /** Danh sách sàn và nhóm bảng giá
   * @testpilot-element priceBoard.floorTabs action=select
   */
  async selectFloorTabs(option: string): Promise<void> {
    await this.page.select('priceBoard.floorTabs', option);
  }

  /** ADS
   * @testpilot-element priceBoard.ads action=assertVisible
   */
  async assertAdsVisible(): Promise<void> {
    await this.page.assertVisible('priceBoard.ads');
  }

  /** Nút tùy chọn dòng
   * @testpilot-element priceBoard.rowOptionsButton action=tap
   */
  async tapRowOptionsButton(): Promise<void> {
    await this.page.tap('priceBoard.rowOptionsButton');
  }

  /** Xoá khỏi danh mục
   * @testpilot-element priceBoard.xoaKhoiDanhMuc action=assertVisible
   */
  async assertXoaKhoiDanhMucVisible(): Promise<void> {
    await this.page.assertVisible('priceBoard.xoaKhoiDanhMuc');
  }

  /** Dòng cổ phiếu trong danh mục
   * @testpilot-element priceBoard.stockRow action=rememberNumber
   */
  async doStockRow(): Promise<void> {
    await this.page.tap('priceBoard.stockRow');
  }

  /** Dòng cổ phiếu trong danh mục
   * @testpilot-element priceBoard.stockRow action=assertNumberDelta
   */
  async doStockRow(): Promise<void> {
    await this.page.tap('priceBoard.stockRow');
  }
}
