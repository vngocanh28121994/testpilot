# Native regression suite

## Mục tiêu

Bộ `@native` kiểm tra các điểm chạm với hệ điều hành như OTP, vân tay, Face ID
và camera/QR. Bộ hiện tại vẫn là WebView và không đổi cách chạy.

## Quy tắc phạm vi

- Mọi scenario native phải có `@native` (có thể đặt ở cấp `Feature`).
- Không chọn tag, hoặc chỉ chọn `@regression`/`@p0`, sẽ không kéo native vào.
- Chạy native regression bằng `@native+@regression`.
- Không ghi platform thì `@native` chỉ chạy Android và iOS, không chạy Web.
- Dùng `@android` cho fingerprint/camera injection và `@ios` cho Touch ID/Face ID.

## Ví dụ Android Emulator

```gherkin
@native
Feature: Native security smoke

  @android @regression @p0 @positive
  Scenario: Xác thực vân tay thành công
    Given I open the app
    When I tap "Bật đăng nhập bằng vân tay"
    And I simulate successful fingerprint authentication
    Then "Đăng nhập sinh trắc học đã bật" is visible

  @android @regression @p1 @positive
  Scenario: Scanner QR nhận được ảnh từ camera ảo
    Given I open the app
    When I tap "Quét QR"
    And I inject QR image "fixtures/native/qr-valid.png" into the camera
    Then "Màn hình quét QR" is visible
```

Để inject camera, bật VirtualScene lúc tạo Appium session:

```json
{
  "android": {
    "injectedImageProperties": {}
  }
}
```

Ảnh phải là PNG, nhỏ hơn hoặc bằng 5 MB và nằm trong workspace.

## Ví dụ iOS Simulator

```gherkin
@native
Feature: Native security smoke

  @ios @regression @p0 @positive
  Scenario: Face ID thành công
    Given I open the app
    When I tap "Bật Face ID"
    And I simulate successful faceId authentication
    Then "Đăng nhập sinh trắc học đã bật" is visible
```

## Chạy

```bash
npm run run:android -- --tag '@native+@regression'
npm run run:ios -- --tag '@native+@regression'
```

Biometric và camera injection chỉ chạy trên emulator/simulator tương ứng. Với
Device Farm máy thật, dùng smoke case mở chức năng, cấp quyền, kiểm tra UI còn
phản hồi và app không crash; không dùng các bước inject.
