@smoke
Feature: Đăng nhập TCInvest

  Background:
    Given I open the app

  # Scenario duy nhất chạm backend thật — chạy độc lập với: npm run run:web -- --tag @login
  @login @positive
  Scenario: Đăng nhập thành công vào tài khoản
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "{{account.tcbs.password}}" into "Ô mật khẩu"
    And I tap "Nút đăng nhập"
    And I wait for "Tổng tài sản"
    Then "Tổng tài sản" is visible

  @login @negative
  Scenario: Đăng nhập thất bại — nhập sai thông tin
    When I enter "0123456789" into "Ô tên đăng nhập"
    And I enter "sat-khau-sai-123" into "Ô mật khẩu"
    And I tap "Nút đăng nhập"
    Then "Thông báo lỗi đăng nhập" is visible

  @search @positive
  Scenario: Tìm kiếm Bảng giá cổ phiếu sau đăng nhập
    Given I am logged in as "tcbs"
    When I open feature "Bảng giá cổ phiếu" from search
    And I take a screenshot named "price-board-after-search"
    Then "Cơ sở" is visible
    And I click "THÊM MÃ"
    And I enter "ADS" into "Ô mã cổ phiếu"
    And I tap "Kết quả tìm kiếm đầu tiên"
    Then "ADS" is visible
    And I click "Icon ... tại dòng ADS"
    And I click "Xoá khỏi danh mục"
    Then "ADS" is not visible

  @my-asset-bond @positive
  Scenario: Kiểm tra tài sản trái phiếu
    Given I am logged in as "tcbs"
    When I open feature "Tài sản của tôi" from search
    And I take a screenshot named "my-asset-after-search"
    Then "Tổng tài sản" is visible
    And I click "Trái phiếu"
    Then "Gốc đầu tư" is visible
    And I click "Tiền"
    Then "Tổng tiền" is visible
    And I click "Cổ phiếu"
    And I select "Ký quỹ" from "Tiểu khoản"
    And I take a screenshot named "sau-khi-chon-tieu-khoan"
    Then "Giá trị vốn" is visible
    And I click "Menu"
    And I scroll to "Kiểm thử"
    And I click "Kiểm thử"
    Then "Kiểm thử Fundmart" is visible
  @farm-debug @positive
  Scenario: Chẩn đoán nút đăng nhập trên Device Farm
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "{{account.tcbs.password}}" into "Ô mật khẩu"
    And I take a screenshot named "01-truoc-khi-bam"
    And I click "Nút đăng nhập"
    Then "Nút đăng nhập" is visible
    And I take a screenshot named "02-ngay-sau-khi-bam"