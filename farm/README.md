# Chạy trên AWS Device Farm

## 1. Xin quyền

Đưa [`iam-policy.json`](iam-policy.json) cho team hạ tầng. Đó là quyền tối thiểu
TestPilot cần — không cần `AWSDeviceFarmFullAccess`.

Hỏi họ luôn một câu: **công ty dùng IAM Identity Center (SSO) hay access key?**
Câu trả lời quyết định bạn làm bước 2 theo cách nào. Ở tổ chức lớn gần như luôn
là SSO.

Xin thêm **ARN của Device Farm project** nếu team đã có sẵn một project.

## 2. Cấu hình credential

Device Farm chỉ có endpoint ở **us-west-2** — đặt region là `us-west-2` bất kể
phần còn lại của hệ thống chạy ở đâu.

### Cách A — IAM Identity Center (SSO)

```bash
aws configure sso
```

Nó sẽ hỏi lần lượt:

| Câu hỏi | Điền gì |
|---|---|
| SSO session name | `tcbs` (tên tuỳ ý) |
| SSO start URL | `https://<công-ty>.awsapps.com/start` — xin admin |
| SSO region | region của cổng SSO, thường `ap-southeast-1` |
| SSO registration scopes | Enter để lấy mặc định |
| CLI default client Region | **`us-west-2`** |
| CLI default output format | `json` |
| CLI profile name | `tcbs-devicefarm` |

Giữa chừng trình duyệt sẽ mở ra để bạn đăng nhập và duyệt. Sau đó chọn account
và permission set trong danh sách CLI hiện ra.

Token SSO hết hạn sau vài giờ. Khi hết hạn:

```bash
aws sso login --profile tcbs-devicefarm
```

Không cần khởi động lại TestPilot sau khi login lại — mỗi lần gọi API là một
client mới, nó đọc lại token.

### Cách B — Access key của IAM user

Chỉ dùng khi công ty không có SSO.

Console AWS → **IAM** → Users → chọn user của bạn → tab **Security credentials**
→ **Create access key** → chọn use case **Command Line Interface (CLI)** → tạo.
Secret chỉ hiện đúng một lần, tải file `.csv` về ngay.

```bash
aws configure --profile tcbs-devicefarm
```

Dán Access Key ID và Secret khi được hỏi, region `us-west-2`, output `json`.

Access key là credential dài hạn, không hết hạn. Nếu rò rỉ là mất luôn, nên:
xoá key cũ trong IAM khi không dùng nữa, và đừng để key vào bất kỳ file nào
trong repo.

## 3. Kiểm tra

```bash
aws devicefarm list-projects --region us-west-2 --profile tcbs-devicefarm
```

Ra danh sách project (kể cả danh sách rỗng `{"projects": []}`) là credential
và quyền đã đúng. Nếu lỗi:

| Lỗi | Nguyên nhân |
|---|---|
| `Unable to locate credentials` | Sai tên profile, hoặc chưa `aws sso login` |
| `Token has expired` | Chạy lại `aws sso login --profile tcbs-devicefarm` |
| `AccessDeniedException` | Credential đúng nhưng thiếu quyền — gửi `iam-policy.json` cho admin |
| Danh sách rỗng mà bạn biết là phải có project | Project nằm ở account khác, hoặc bạn chọn nhầm permission set |

## 4. Chạy TestPilot

```bash
AWS_PROFILE=tcbs-devicefarm npm run ui
```

`AWS_PROFILE` phải đặt **lúc khởi động** server — biến môi trường không đổi được
sau khi tiến trình đã chạy. Rồi mở tab **Device Farm** và bấm "Tải project".

Chưa có project nào thì tạo một cái:

```bash
aws devicefarm create-project --name testpilot --region us-west-2 --profile tcbs-devicefarm
```

## Lưu ý chi phí

Device Farm tính tiền theo phút thiết bị (billing method `METERED`). Tài khoản
mới thường có 1000 phút miễn phí. Ô "Giới hạn mỗi job (phút)" trong tab Device
Farm chính là cái chặn hoá đơn — một suite treo mà không có giới hạn sẽ chạy
tới khi hết timeout mặc định.
