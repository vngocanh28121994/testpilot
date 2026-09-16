import { BasePage } from '../../src/pom/BasePage.js';

/** Chọn loại nội dung hiển thị */
export class ReportTypePickerPage {
  constructor(private readonly page: BasePage) {}

  /** Nút TIẾP TỤC
   * @testpilot-element reportTypePicker.continueButton action=tap
   */
  async tapContinueButton(): Promise<void> {
    await this.page.tap('reportTypePicker.continueButton');
  }

  /** Khung lựa chọn Doanh nghiệp và thị trường
   * @testpilot-element reportTypePicker.businessMarketOption action=tap
   */
  async tapBusinessMarketOption(): Promise<void> {
    await this.page.tap('reportTypePicker.businessMarketOption');
  }

  /** Khung cảnh báo hỗ trợ trên điện thoại
   * @testpilot-element reportTypePicker.warningBanner action=assertVisible
   */
  async assertWarningBannerVisible(): Promise<void> {
    await this.page.assertVisible('reportTypePicker.warningBanner');
  }

  /** Khung cảnh báo hỗ trợ trên điện thoại
   * @testpilot-element reportTypePicker.warningBanner action=assertNotVisible
   */
  async assertWarningBannerNotVisible(): Promise<void> {
    await this.page.assertNotVisible('reportTypePicker.warningBanner');
  }
}
