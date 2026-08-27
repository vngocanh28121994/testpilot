import { BasePage } from '../../src/pom/BasePage.js';

/** Đăng nhập TCInvest */
export class LoginPage {
  constructor(private readonly page: BasePage) {}

  /** Ô tên đăng nhập */
  async enterUsernameField(text: string): Promise<void> {
    await this.page.input('login.usernameField', text);
  }

  /** Ô mật khẩu */
  async enterPasswordField(text: string): Promise<void> {
    await this.page.input('login.passwordField', text);
  }

  /** Nút đăng nhập */
  async tapSubmitButton(): Promise<void> {
    await this.page.tap('login.submitButton');
  }

  /** Thông báo lỗi đăng nhập */
  async assertErrorMessageVisible(): Promise<void> {
    await this.page.assertVisible('login.errorMessage');
  }

  /** Nút đăng nhập
   * @testpilot-element login.submitButton action=assertVisible
   */
  async assertSubmitButtonVisible(): Promise<void> {
    await this.page.assertVisible('login.submitButton');
  }

  /** Phái sinh
   * @testpilot-element login.phaiSinh action=tap
   */
  async tapPhaiSinh(): Promise<void> {
    await this.page.tap('login.phaiSinh');
  }
}
