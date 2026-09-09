Feature: Kiểm tra hiệu quả đầu tư phái sinh

  Background:
    Given I open the app

  @hieu-qua-dau-tu @positive
  Scenario: Kiểm tra hiệu quả đầu tư phái sinh
    Given I am logged in as "tcbs"
    When I open feature "Hiệu quả đầu tư" from search
    And I click "Phái sinh"
    And "Thống kê chung giao dịch PS" is visible
    And I enter "01/01/2026" into "Ngày Từ"
    Then "số lượng giao dịch" number is not "0"
