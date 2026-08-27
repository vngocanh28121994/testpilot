Feature: fundmart

  Background:
    Given I open the app

  @check-tooltip
  Scenario: Kiểm tra tooltip table
    Given I am logged in as "tcbs"
    When I open feature "Bảng giá Fundmart" from search
    And I click "TCBF"
    And I inspect section "Các quỹ có thể bạn quan tâm"
    And I click "Giá 1M"
    Then "Diễn biến giá trong vòng 1 tháng" is visible
