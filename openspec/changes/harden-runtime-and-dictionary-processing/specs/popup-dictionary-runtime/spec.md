## ADDED Requirements

### Requirement: Embedded popup lookups use own dictionary keys
Popup userscript SHALL chỉ trả hit cho property thuộc chính đối tượng từ điển được nhúng, sau cùng phép chuẩn hóa lookup hiện có. Property kế thừa từ prototype MUST được coi là miss khi không có entry nguồn thực. Kết quả hit SHALL tiếp tục có đúng shape mà renderer dùng.

#### Scenario: Constructor is absent from JSON dictionary
- **WHEN** từ điển qua JSON.parse chỉ có entry bạn và lookup nhận `constructor`
- **THEN** lookup trả miss và không chuyển Object constructor sang renderer

#### Scenario: A prototype-named key is explicitly defined
- **WHEN** JSON dictionary thực sự có entry own-key `constructor` với shape hợp lệ
- **THEN** lookup trả entry đó và renderer hiển thị bình thường

#### Scenario: Ordinary lookup is unchanged
- **WHEN** fixture vừa chứa key bình thường vừa chạy query không tồn tại
- **THEN** key hợp lệ vẫn trả đúng kết quả và query vắng mặt vẫn là miss, không phát sinh lỗi results.map
