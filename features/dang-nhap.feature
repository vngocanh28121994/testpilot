@smoke
Feature: Đăng nhập TCInvest

  Background:
    Given I open the app

  Scenario: Đăng nhập thất bại — nhập sai thông tin
    When I enter "0123456789" into "Ô tên đăng nhập"
    And I enter "sat-khau-sai-123" into "Ô mật khẩu"
    And I tap "Nút đăng nhập"
    Then "Thông báo lỗi đăng nhập" is visible

  # Scenario duy nhất chạm backend thật — chạy độc lập với: npm run run:web -- --tag @login
  @login
  Scenario: Đăng nhập thành công vào tài khoản
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "{{account.tcbs.password}}" into "Ô mật khẩu"
    And I tap "Nút đăng nhập"
    And I wait for "Tổng tài sản"
    Then "Tổng tài sản" is visible
