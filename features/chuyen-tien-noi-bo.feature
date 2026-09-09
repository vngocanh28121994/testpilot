@feature-chuyen-tien-noi-bo
Feature: Chuyển tiền nội bộ

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Chuyển tiền" from search

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ tài khoản Thường sang Ký Quỹ
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "availableBefore"
    When I enter "1,000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Thường"
    And "Chọn TK nhận tiền" shows "Ký Quỹ"
    And "Tiền chuyển (Phí = 0)" shows "1,000"
    When I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"
    And "Được chuyển" decreased by "1,000" from "availableBefore"

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ tài khoản Ký Quỹ sang Thường
    Given I select "TK Ký Quỹ" from "Chuyển từ"
    And I select "TK Thường" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "availableBefore"
    When I enter "500" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Ký Quỹ"
    And "Chọn TK nhận tiền" shows "Thường"
    And "Tiền chuyển (Phí = 0)" shows "500"
    When I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"
    And "Được chuyển" decreased by "500" from "availableBefore"

  @p1 @positive
  Scenario: Chọn tiểu khoản nguồn và đích cho giao dịch chuyển tiền
    Given I select "TK Thường" from "Chuyển từ"
    When I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "Chuyển từ" shows "TK Thường"
    And "Chọn TK nhận tiền" shows "TK Ký Quỹ"

  @p1 @business-rule
  Scenario: Tiểu khoản đã chọn ở nguồn không xuất hiện trong dropdown đích
    Given I select "TK Thường" from "Chuyển từ"
    Then "TK Thường" is not an option in "Chọn TK nhận tiền"

  @p1 @business-rule
  Scenario: Tiểu khoản đã chọn ở đích không xuất hiện trong dropdown nguồn
    Given I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "TK Ký Quỹ" is not an option in "Chuyển từ"

  @p1 @business-rule
  Scenario: Số tiền được chuyển thay đổi theo tiểu khoản nguồn đã chọn
    Given I select "TK Thường" from "Chuyển từ"
    And I remember "Được chuyển" as "availableThuong"
    When I select "TK Ký Quỹ" from "Chuyển từ"
    Then "Được chuyển" changed from "availableThuong"

  @p1 @negative
  Scenario: Không cho chuyển khi số tiền vượt quá số tiền được chuyển
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "availableAmount"
    When I enter "999999999" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Thông báo" shows "Tiền chuyển + phí vượt quá số tiền có thể chuyển"

  @p1 @positive
  Scenario: Chuyển sang màn hình xác nhận khi số tiền hợp lệ
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    When I enter "1,000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Tiền chuyển (Phí = 0)" shows "1,000"

  @p1 @positive
  Scenario: Quay lại màn hình Chuyển tiền từ màn hình xác nhận
    Given I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1,000" into "Số tiền"
    And I click "Nút CHUYỂN"
    When I click "Nút QUAY LẠI"
    Then "Chuyển từ" is visible
    And "Chọn TK nhận tiền" is visible
    And "Số tiền" is visible
    And "Nút CHUYỂN" is visible
