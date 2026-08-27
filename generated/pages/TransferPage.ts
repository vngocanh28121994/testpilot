import { BasePage } from '../../src/pom/BasePage.js';

/** Chuyển tiền */
export class TransferPage {
  constructor(private readonly page: BasePage) {}

  /** Chuyển từ
   * @testpilot-element transfer.sourceAccount action=select
   */
  async selectSourceAccount(option: string): Promise<void> {
    await this.page.select('transfer.sourceAccount', option);
  }

  /** Chọn TK nhận tiền
   * @testpilot-element transfer.chonTkNhanTien action=select
   */
  async selectChonTkNhanTien(option: string): Promise<void> {
    await this.page.select('transfer.chonTkNhanTien', option);
  }

  /** Số tiền
   * @testpilot-element transfer.soTien action=input
   */
  async enterSoTien(text: string): Promise<void> {
    await this.page.input('transfer.soTien', text);
  }

  /** Nút CHUYỂN
   * @testpilot-element transfer.submitButton action=tap
   */
  async tapSubmitButton(): Promise<void> {
    await this.page.tap('transfer.submitButton');
  }

  /** Chọn TK nhận tiền
   * @testpilot-element transfer.chonTkNhanTien action=assertText
   */
  async assertChonTkNhanTienText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('transfer.chonTkNhanTien', expected, mode);
  }

  /** Tiền chuyển (Phí = 0)
   * @testpilot-element transfer.tienChuyenPhi0 action=assertText
   */
  async assertTienChuyenPhi0Text(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('transfer.tienChuyenPhi0', expected, mode);
  }

  /** Thông báo
   * @testpilot-element transfer.thongBao action=assertText
   */
  async assertThongBaoText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('transfer.thongBao', expected, mode);
  }

  /** Được chuyển
   * @testpilot-element transfer.availableAmount action=assertText
   */
  async assertAvailableAmountText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('transfer.availableAmount', expected, mode);
  }

  /** Nút ĐÓNG
   * @testpilot-element transfer.nutDong action=assertVisible
   */
  async assertNutDongVisible(): Promise<void> {
    await this.page.assertVisible('transfer.nutDong');
  }

  /** Chọn TK nhận tiền
   * @testpilot-element transfer.chonTkNhanTien action=assertVisible
   */
  async assertChonTkNhanTienVisible(): Promise<void> {
    await this.page.assertVisible('transfer.chonTkNhanTien');
  }

  /** Số tiền
   * @testpilot-element transfer.soTien action=assertVisible
   */
  async assertSoTienVisible(): Promise<void> {
    await this.page.assertVisible('transfer.soTien');
  }

  /** Chuyển từ
   * @testpilot-element transfer.sourceAccount action=assertText
   */
  async assertSourceAccountText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('transfer.sourceAccount', expected, mode);
  }

  /** Được chuyển
   * @testpilot-element transfer.availableAmount action=rememberNumber
   */
  async doAvailableAmount(): Promise<void> {
    await this.page.tap('transfer.availableAmount');
  }

  /** Được chuyển
   * @testpilot-element transfer.availableAmount action=assertNumberDelta
   */
  async doAvailableAmount(): Promise<void> {
    await this.page.tap('transfer.availableAmount');
  }

  /** Được chuyển
   * @testpilot-element transfer.availableAmount action=assertVisible
   */
  async assertAvailableAmountVisible(): Promise<void> {
    await this.page.assertVisible('transfer.availableAmount');
  }

  /** Nút ĐÓNG
   * @testpilot-element transfer.nutDong action=tap
   */
  async tapNutDong(): Promise<void> {
    await this.page.tap('transfer.nutDong');
  }

  /** Thông báo
   * @testpilot-element transfer.thongBao action=assertNotVisible
   */
  async assertThongBaoNotVisible(): Promise<void> {
    await this.page.assertNotVisible('transfer.thongBao');
  }

  /** Nút CHUYỂN
   * @testpilot-element transfer.submitButton action=assertVisible
   */
  async assertSubmitButtonVisible(): Promise<void> {
    await this.page.assertVisible('transfer.submitButton');
  }

  /** Chọn TK nhận tiền
   * @testpilot-element transfer.chonTkNhanTien action=tap
   */
  async tapChonTkNhanTien(): Promise<void> {
    await this.page.tap('transfer.chonTkNhanTien');
  }

  /** TK Thường
   * @testpilot-element transfer.tkThuong action=assertNotVisible
   */
  async assertTkThuongNotVisible(): Promise<void> {
    await this.page.assertNotVisible('transfer.tkThuong');
  }

  /** Chuyển từ
   * @testpilot-element transfer.sourceAccount action=tap
   */
  async tapSourceAccount(): Promise<void> {
    await this.page.tap('transfer.sourceAccount');
  }

  /** TK Ký Quỹ
   * @testpilot-element transfer.tkKyQuy action=assertNotVisible
   */
  async assertTkKyQuyNotVisible(): Promise<void> {
    await this.page.assertNotVisible('transfer.tkKyQuy');
  }
}
