@feature-chuyen-tien-noi-bo
Feature: Chuyển tiền nội bộ

  Background:
    Given I open the app
    And I am logged in as "tcbs"

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ tiểu khoản Thường sang Ký Quỹ
    Given I open feature "Chuyển tiền" from search
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"

  @p0 @smoke @positive
  Scenario: Chuyển tiền thành công từ Ký Quỹ sang tiểu khoản Thường
    Given I open feature "Chuyển tiền" from search
    When I select "TK Ký Quỹ" from "Chuyển từ"
    And I select "TK Thường" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"

  @p0 @smoke @positive
  Scenario: Chọn đúng tiểu khoản nguồn và tiểu khoản đích
    Given I open feature "Chuyển tiền" from search
    When I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "Chuyển từ" shows "TK Thường"
    And "Chọn TK nhận tiền" shows "TK Ký Quỹ"

  @p1 @business-rule
  Scenario: Tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown đích
    Given I open feature "Chuyển tiền" from search
    When I select "TK Thường" from "Chuyển từ"
    Then "TK Thường" is not an option in "Chọn TK nhận tiền"

  @p1 @business-rule
  Scenario: Tiểu khoản đã chọn ở đích không xuất hiện ở dropdown nguồn
    Given I open feature "Chuyển tiền" from search
    When I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    Then "TK Ký Quỹ" is not an option in "Chuyển từ"

  @p1 @business-rule
  Scenario: Số tiền được chuyển thay đổi theo tiểu khoản nguồn
    Given I open feature "Chuyển tiền" from search
    And I select "TK Thường" from "Chuyển từ"
    And I remember "Được chuyển" as "soTienDuocChuyen"
    When I select "TK Ký Quỹ" from "Chuyển từ"
    Then "Được chuyển" changed from "soTienDuocChuyen"

  @p1 @negative
  Scenario: Không cho chuyển khi số tiền vượt quá số tiền được chuyển
    Given I open feature "Chuyển tiền" from search
    And I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "soTienDuocChuyen"
    When I enter "999999999" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Thông báo" shows "Tiền chuyển + phí vượt quá số tiền có thể chuyển"

  @p1 @positive
  Scenario: Số tiền hợp lệ chuyển sang màn hình xác nhận
    Given I open feature "Chuyển tiền" from search
    And I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    When I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    Then "Lệnh" shows "Chuyển tiền"
    And "Chuyển từ" shows "Thường"
    And "Chọn TK nhận tiền" shows "Ký Quỹ"

  @p1 @positive
  Scenario: Quay lại từ màn hình xác nhận trở về màn hình Chuyển tiền
    Given I open feature "Chuyển tiền" from search
    And I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    When I click "Nút QUAY LẠI"
    Then "Số tiền" is visible

  @p1 @business-rule
  Scenario: Số tiền được chuyển cập nhật sau khi chuyển thành công
    Given I open feature "Chuyển tiền" from search
    And I select "TK Thường" from "Chuyển từ"
    And I select "TK Ký Quỹ" from "Chọn TK nhận tiền"
    And I remember "Được chuyển" as "soTienDuocChuyen"
    And I enter "1000" into "Số tiền"
    And I click "Nút CHUYỂN"
    And I click "Nút XÁC NHẬN"
    Then "Thông báo" shows "Chuyển tiền thành công"
    And "Được chuyển" decreased by "1000" from "soTienDuocChuyen"
