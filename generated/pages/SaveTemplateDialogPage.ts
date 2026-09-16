import { BasePage } from '../../src/pom/BasePage.js';

/** Lưu với tên */
export class SaveTemplateDialogPage {
  constructor(private readonly page: BasePage) {}

  /** Nút LƯU trong popup
   * @testpilot-element saveTemplateDialog.saveButton action=tap
   */
  async tapSaveButton(): Promise<void> {
    await this.page.tap('saveTemplateDialog.saveButton');
  }

  /** Nút LƯU trong popup
   * @testpilot-element saveTemplateDialog.saveButton action=assertVisible
   */
  async assertSaveButtonVisible(): Promise<void> {
    await this.page.assertVisible('saveTemplateDialog.saveButton');
  }
}
