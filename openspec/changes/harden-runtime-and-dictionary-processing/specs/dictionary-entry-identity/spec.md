## MODIFIED Requirements

### Requirement: Collision grouping is lossless and deterministic
Phép gộp dùng chung SHALL bảo toàn mọi định nghĩa nguồn khác biệt, POS và liên kết headword có ý nghĩa; định nghĩa trùng chính xác SHALL chỉ được giữ một lần theo identity dùng chung và thứ tự nguồn ổn định. Một bundle chỉ giao một phần với bundle khác MUST NOT bị loại bỏ nếu còn token nghĩa chưa được đại diện trong kết quả cuối. Mọi phép loại bỏ theo chuẩn hóa hoặc biến thể đã được chấp nhận MUST chứng minh bao phủ đầy đủ phần nội dung bị loại, và mọi biến đổi mất dữ liệu hoặc sai định dạng MUST thất bại trước khi xuất bản.

#### Scenario: Colliding rows carry different meanings
- **WHEN** hai row cùng normalized key nhưng chứa các định nghĩa khác nhau
- **THEN** entry gộp giữ mọi nghĩa khác biệt và liên kết display đủ để render mà không bịa hoặc bỏ nghĩa

#### Scenario: Exact definitions repeat
- **WHEN** các row va chạm có cùng normalized definition và POS
- **THEN** entry gộp lưu định nghĩa đó một lần tại vị trí ổn định đầu tiên

#### Scenario: A definition is lost
- **WHEN** bộ xác minh thấy một định nghĩa hoặc một phần nội dung nghĩa không rỗng của nguồn không còn đại diện trong kết quả
- **THEN** generation thoát khác zero và không thay runtime artifact

#### Scenario: Bundles overlap only partly
- **WHEN** nguồn chứa `sharp, biting, cutting` và `sharp, acute, keen` với POS tương thích
- **THEN** kết quả bảo toàn cả năm token nghĩa, và token chung `sharp` không cho phép bỏ `acute` hoặc `keen`

#### Scenario: Repository regression for bao bọc
- **WHEN** nguồn fixture của `bao bọc` chứa `cover, envelope, covering` và `to envelope, protect`
- **THEN** kết quả giữ nội dung `protect` cùng POS và headword tương ứng

#### Scenario: Validation is independent of overlap selection
- **WHEN** kết quả fixture được cố ý làm thiếu một token, POS hoặc liên kết headword dù vẫn còn một token chung với nguồn
- **THEN** validator từ chối kết quả mà không coi tín hiệu giao nhau dùng để chọn winner là bằng chứng bảo toàn
