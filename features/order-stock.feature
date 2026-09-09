Feature: order-stock

  Background:
    Given I open the app

  @draft-order @positive
  Scenario: Đặt lệnh nháp
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "{{account.tcbs.password}}" into "Ô mật khẩu"
    And I tap "Nút đăng nhập"
    And I wait for "Tổng tài sản"
    And I tap "Nút tìm kiếm"
    And I enter "Đặt lệnh cổ phiếu" into "Ô tìm kiếm"
    And I wait for "Kết quả tìm kiếm đầu tiên"
    And I tap "Kết quả tìm kiếm đầu tiên"
    And I take a screenshot named "order-stock-after-search"
    Then "Đặt lệnh" is visible
    And I click "Lệnh thường"
    And I scroll to "Lưu lệnh"
    And I tap "Lưu lệnh"
    And I enter "TCB" into "Nhập mã"
    And I wait for "TCB"
    And I tap "TCB"
    And I enter "100" into "KL đặt"
    And I enter "28" into "Giá đặt"
    And I click "Lưu mua"
    And I take a screenshot named "order-draft-stock-result"
    And "Đã lưu lệnh mua" is visible