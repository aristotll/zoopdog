# Kết quả chạy thử trực tiếp — 2026-11-17 (lượt một phần)
Commit: 56b3d81  Trình duyệt: Chrome 157 (ChromeDebug, hồ sơ "yiu")  Trình quản lý: Violentmonkey/… (người dùng cài lại bản local)  HĐH: macOS (Darwin 25.6.0)
Userscript @version (tệp vừa dựng): popup-local 2026.11.17.4, nom-ruby-local 2026.11.17.4, cjk-ruby-local 2026.11.14

Chạy bằng cầu CDP của book-translator, chỉ đọc DOM + rê chuột/cuộn. Chỉ chạy một phần; các ID không liệt kê = **chưa chạy**.

| ID | Kết quả | Trang | Bằng chứng / số đo | Ghi chú |
| --- | --- | --- | --- | --- |
| A1 | PASS | localhost:8000 (5 trang) | `console` rỗng trên cả năm | |
| A2 (trạng thái) | PASS | popupdict.html | "Dictionary refreshed (78198 entries)." | chưa thử rê chuột |
| A6 | BLOCKED | popupdict.html | tải lại khi offline: trang không nạp (`Handlebars` undefined) | `http.server` không có cache; không phải lỗi userscript |
| B1 | PARTIAL | vi.wikipedia Hà_Nội | tab đã có nom-ruby chạy; chưa kiểm popup trước khi rê | tab mở bằng `open` đã gắn script |
| B2/E2 | PASS | idem | rê "Nội": popup hiện, định nghĩa "inside, interior…", nút `+ Add Chữ Nôm`, `Set order` (bản local) | `data-last-hover=excluded`, `data-last-error` trống |
| B6 | PASS | idem | sau cuộn thật popup `visibility:hidden` | lần cuộn đầu chưa cuộn (scrollY 0) |
| C1 | PASS | idem | ruby 21491 → 21491 → 21460 (0 / 6 / 11 s); `data-zoopdog-nom-error` trống | |
| C5 | PASS | idem | ruby trong textarea/input/code/button = 0; không lồng, không đôi | |
| C8 | PASS | idem | `mode=overlay`, `labels=459 records=21437 dropped=0`, ruby=0; gỡ khoá → `ruby`, 8718 ruby | |
| D1 (một phần) | PASS | idem | `data-zoopdog-cjk-status=build=diag2 converter=ready queued=0 inflight=0 labels=5014`, `data-zoopdog-cjk-error` trống | trang vi, 13 `ruby.zd-cjk-ruby` |
| E1 | PASS | — | `GET /v1/suggest?kind=nom&text=bạn` → 200 | |

| B7 | PASS | vnexpress.net | 9 iframe, cả 9 < 50 px; 0 `#zoopdog-userscript-popup`/`canvas` ở frame cha; longtask lớn nhất 98 ms | chưa thử hover trong iframe thường |
| B11 | PASS | example.com | không popup/canvas; 0 longtask | trang đa ngữ (fr/zh/…), xem C10 |
| B10 | PARTIAL | github.com | không popup/canvas, 0 ruby; chưa đọc `Log.entryAdded` (Trusted Types) | |
| C2 | **FAIL** | vi.wikipedia Việt_Nam | mở bằng `open` có script: longtask lớn nhất 769 / 1259 / 1209 ms (min–max 769–1259), 10–12 tác vụ, tổng ≈3,0–3,5 s. Không script (hồ sơ empty): 1 tác vụ 274 ms | tác vụ ~700 ms lặp ~1,5 s một lần trong 3–7 s đầu; ở chế độ overlay (F4) chỉ 286–301 ms = mốc, nên thủ phạm là lượt ghi `<ruby>` của nom-ruby (chế độ ruby) |
| C3 | PASS | idem | đoạn thêm vào: ruby đầu tiên sau 775 ms, 8 ruby, không đổi sau 3 s, không lồng | |
| C6 | **FAIL** (một phần) | idem | tab nền: chú thích xong trong ≤4 s (17515 ruby), không treo; **khi kích hoạt tab: longtask 1339 ms + 702 ms** | đơ >1 s lúc chuyển sang tab (tiêu chí "không đạt" loại trừ tab nền, nhưng đây là lúc kích hoạt) |
| C7 | PASS | idem | 12 s nhàn rỗi: 0 longtask, ruby 17660 không đổi | chưa đo `TaskDuration` (`Performance.getMetrics` trả rỗng qua cầu) |
| C10 | NOTE | example.com | `lang="fr"`: "réservé à" → `à啊` (3 ruby) | "à" không phải ASCII nên khớp mô tả của plan, nhưng là từ Pháp bị chú thích Nôm: đáng xem lại |
| F1 | PARTIAL | example.com / vnexpress | longtask lớn nhất 0 ms / 98 ms (n=1 lần; không lấy heap) | |
| F3 | **FAIL** | vi.wikipedia Việt_Nam (3 lần) | lớn nhất 769–1259 ms > 50 ms | xem C2 |
| F4 | PASS | idem, overlay | 3 lần: lớn nhất 286/301/282 ms (≈ mốc 274 ms của trang), tổng 738–1034 ms | cuộn 10 s chưa đo |

## Lỗi tìm thấy
- **C2/F3:** nom-ruby ở chế độ ruby tạo longtask 0,7–1,3 s trên bài dài (3 lần mở), trái tiêu chí "< 150 ms"/"< 50 ms"; overlay không bị.
- **C6:** khi kích hoạt tab nền đã quét xong vẫn có longtask 1,3 s + 0,7 s.
- Lưu ý đo: tải lại bằng CDP (`reload`) **không** kích hoạt lại userscript trong hồ sơ yiu (mất mọi `data-zoopdog-*`); dùng `open` cho mỗi lần đo. Tab mở nền bị `visibilityState=hidden` nên longtask không phát; phải `Page.bringToFront`.
- Không có lỗi ghi dữ liệu; không `POST /v1/nom/entries`.
- cjk-ruby local vẫn là `@version 2026.11.14` và trạng thái `build=diag2` (chuỗi chẩn đoán) — xác nhận đó là build chủ ý.

## Lượt hai (cùng ngày): xử lý lỗi và chạy phần còn lại

| ID | Kết quả | Bằng chứng / số đo |
| --- | --- | --- |
| A2 | PASS | rê "Buổi" trên popupdict.html: iframe `#zoopdog-popup` 260×340 |
| A3 | PASS | `Shift` → thẻ ghim hiện 📌; di chuột đi, `Shift` lần hai → thẻ đóng (ảnh chụp trước/sau) |
| A4 | PASS | gõ "Xin chào" từng ký tự cách 30 ms: đúng **1** lần vẽ lại, ba phương ngữ |
| A5 | PASS | 150 ms RTT, 1,5 Mbps, tắt cache, 5 trang: không lỗi; `Handlebars` có ở popupdict |
| A6 | PASS (ghi chú) | điều hướng (không reload) khi offline: trang nạp từ cache, "Dictionary ready (78198 entries)"; không thấy dòng "Using the previous dictionary…" vì không có lần làm mới nào thất bại |
| B3 | PASS | rê lên "2026": popup ẩn, `data-last-error` trống |
| B4 / F2 | PASS | từ sự kiện `mousemove` tới khi popup hiện: hover đầu sau nạp **12–13 ms** (3 lần), hover sau khi yên **3 ms** (đo bằng `requestAnimationFrame`; hover thứ hai có thể thấy popup cũ, nên 3 ms là cận dưới) |
| B10 | PASS | github.com: script chạy (`data-zoopdog-*` có), console rỗng, không vi phạm Trusted Types |
| C4 | PASS | nút "喃" (xác nhận bằng `elementFromPoint`): một lần bấm vẽ lại (21491→360 rồi quét lại), bấm đúp → 0 ruby, bấm lại → bật (13079 sau 8 s, đang quét) |
| C9 | PASS | đoạn tiếng Việt trong shadow root mở được chú thích (4 ruby); lần thử đầu 4 s sau khi bật lại nút cho 0 vì đang quét lại, thử lại sau khi xong thì đạt |
| C10 | PASS (theo thiết kế) | `à` trong `lang="fr"` được chú thích: `isDeclaredNonVietnamese` chỉ bỏ từ ASCII, từ có dấu Việt vẫn được chú thích (comment trong `nom-ruby-annotate.js`) |
| D1/D3/D4 | PASS | example.com: nhãn tại chỗ (`converter=ready`), 0 yêu cầu `translate`, 12 s nhàn rỗi = 3 mutation, 0 yêu cầu mạng; overlay: `labels=36 records=4`, 0 ruby |
| D2 | N/A | cjk-ruby bản này gọi bộ chuyển đổi cục bộ, không có yêu cầu mạng để ngắt; thêm văn bản Hán khi offline vẫn có nhãn ngay |
| E3 | PARTIAL | giao diện: nút `+ Add Chữ Nôm`/`Set order` có; bấm bằng CDP không mở được modal (con trỏ nhảy sang nên thẻ đóng; lượn qua trang lại bật popup Nôm khác). Hợp đồng máy chủ: `GET /v1/nom/form?vi=nước` → `candidates`(4), `title`, `order`, `exists=false` |
| E5 | PASS | Google "hà nội wikipedia": 35 phần tử `data-zoo-explored`, nền `#d9d9d9` khớp `/v1/explored-sites/match`; `scripts/audit_search_coloring.py` (đã sửa) báo "32 result links, 24 explored, 0 missing colour" |
| F5 | PASS (đo) | vi.wikipedia Việt_Nam, 16 s: có script `LayoutCount` 286 / `RecalcStyleCount` 2816 / `RecalcStyleDuration` 4,08 s / `TaskDuration` 15,8 s; không script 22 / 327 / 0,16 s / 1,43 s → phần tốn là **tính lại kiểu**, không phải bố cục |
| F1 (heap) | ĐO | example.com sau 2 lần GC: có script heap **158,6 MB**, `TaskDuration` 1,03 s, `ScriptDuration` 0,53 s; không script 0,95 MB, 0,02 s. Hồ sơ yiu còn có userscript/extension khác nên không tách riêng được phần của Zoopdog |
| G1 | PASS | vi.wikipedia Hà_Nội, popup+nom+cjk bật: 0 ruby lồng nhau, 21460 nom + 13 cjk, cả hai `*-error` trống |
| G3 | PASS | `line-height` 29,4 px trên chữ 14 px |

### Nguyên nhân gốc đã tìm được
- **C2/F3 (longtask 0,7–1,3 s):** hồ sơ CPU (`Profiler.start/stop`) trong lúc quét "Việt Nam": `zdContainerBoundary` (`zd-extension/js/zd-words.js`, gọi từ `readAhead` trong `nom-ruby-annotate.js`) tự chiếm **2,28 s** trên tổng 12,4 s. Hàm gọi `getComputedStyle(el).display` cho mỗi tổ tiên của mỗi nút văn bản, xen kẽ với việc chèn `<ruby>`, nên mỗi lần buộc tính lại kiểu (khớp F5: 2816 lần). Bốn dòng sau, ngoài Zoopdog, cũng nằm trong hồ sơ: userscript "簡繁切替" (`stranBody`, `traditionalized`, ≈0,5 s) và content script của một extension (`$Ct`). Mô phỏng chèn 38k `<ruby>` theo lát 12 ms trên trang không script: **0** longtask, nên chi phí không nằm ở bản thân `<ruby>` hay độ dài lát cắt (`scanSliceMs: 12`). Cách sửa gợi ý (chưa làm): lưu `display` theo phần tử và ranh giới theo `parentElement` trong một lát, xoá cache đầu mỗi lát; hoặc chỉ tính ranh giới khi `canContinuePast`/`needsEnglishContext` đúng (đã có) *và* chưa có trong cache.
- **C6 (1,3 s khi kích hoạt tab):** tái hiện **không cần userscript**: bọc 38k từ bằng `<ruby>` đồng bộ trong tab nền rồi kích hoạt cho 2 longtask 1,29 s và 1,22 s. Đây là lần bố cục đầu tiên của tài liệu ẩn đã bị thay đổi nhiều, không phải mã quét. Giảm bằng cách chú thích ít hơn/lười (`content-visibility: auto`) — quyết định thiết kế, chưa làm.
- **`reload` mất userscript:** không tái hiện được trong 12 lần thử (cả tab nền, `Page.reload`, sau `Performance.enable` và `addScriptToEvaluateOnNewDocument`). Nguyên nhân khả dĩ: tab song sinh cùng URL trong hồ sơ `empty` bị chọn thay. Đã thêm `_pin_to_opened_tab` (reload/go gắn lại phiên vào đúng page id mà `open --profile` đã ghi; từ chối thay vì đoán) + 2 test (`.claude/tools/test_cdp_session_open.py` của book-translator).
- **cjk `build=diag2`/`@version 2026.11.14`:** `diag2` là chuỗi hằng trong `cjk-ruby.runtime.js:767`; `@version` đã lên 2026.11.17 sau `make rebuild-userscripts`. Các tệp `zoopdog-*.user.js` bị gitignore, nên bản chạy trong trình quản lý phụ thuộc vào lần cập nhật của người dùng.

### Chưa chạy lượt hai
B5 (vị trí ghim qua `GM_getValue` không đọc được từ CDP), B8 (Shift qua iframe), B9 (cần người dùng dịch trang), E4 (`Alt+R` cần hỏi vì có âm thanh), E6, F1 trên 5 iframe, F4 cuộn 10 s, G2, G4 (cần livestream YouTube).

## Chưa chạy (lượt một, nay đã có lượt hai ở trên)
A3–A5, B3–B5, B8–B9, B10 (Trusted Types), C4, C9, D2–D4, E3–E6, F1 heap, F2, F5, G.

## Sau khi sửa `zdContainerBoundary` (build 2026.11.18.1, đo lại cùng ngày)

Sửa: `zdCreateBoundaryCache(roots)` + `zdPrefillBoundaryCache` (zd-words.js), mỗi scan job giữ một cache và đọc kiểu của cả cây gốc **một lần** ở lần cần ranh giới đầu tiên (đo trên trang: 55k phần tử = 55 ms). Phiên bản chỉ cache theo phần tử cha (build .17.x) không giảm được gì (2,86 s trong `zdContainerBoundaryUncached`).

| Số đo (vi.wikipedia Việt_Nam, 16 s) | Trước | Sau | Không script |
| --- | --- | --- | --- |
| `zdContainerBoundary*`/`zdBoundaryStyle` (CPU, tự thân) | 2,28–3,0 s | **0,10 s** | – |
| nom-ruby tổng (hồ sơ CPU, tính cả gọi con) | – | 0,37–0,44 s / 14 s | – |
| `RecalcStyleCount` | 2816 | **406** | 327 |
| `RecalcStyleDuration` | 4,08 s | **0,51 s** | 0,16 s |
| `LayoutCount` | 286 | 112 | 22 |
| `TaskDuration` | 15,8 s | **6,8 s** | 1,43 s |
| longtask lớn nhất (3 lần) | 769–1259 ms | 777 / 735 / 758 ms | 274 ms |

C2/F3 **vẫn FAIL về số longtask** (3 tác vụ ≈ 0,6–0,78 s, nay xuất hiện ở giây 2–6 thay vì 10–13). Phần còn lại không còn nằm ở mã quét: hồ sơ cho thấy phần lớn thời gian là `(program)`/native (dựng kiểu và bố cục 17k `<ruby>` với webfont Nom Na Tong), cùng userscript 簡繁切替 (0,52 s) và cjk-ruby (0,26 s) và vài extension. Chưa kiểm chứng giả thuyết webfont/bố cục bằng một thử nghiệm riêng.

## Lượt ba: người dùng tự kiểm + đo thêm bằng CDP

Do **người dùng tự kiểm bằng tay** (không phải CDP), báo "ok":

| ID | Kết quả | Ghi chú |
| --- | --- | --- |
| B5 | PASS (người dùng) | vị trí ghim được nhớ qua lần tải lại |
| E3 | PASS (người dùng) | mở được modal "Add Chữ Nôm" ở chế độ local; CDP không bấm được nên trước đó chỉ PARTIAL |
| B8, B9 | PASS (người dùng) | thử trên `https://115.com/?cid=438246369086592273&offset=0&mode=wangpan` (trang có iframe thường; B9 là trang đã dịch); không ghi số đo |

Do CDP (hồ sơ yiu, bản 2026.11.18.1):

| ID | Kết quả | Bằng chứng |
| --- | --- | --- |
| C2/F3 giả thuyết webfont | **BÁC BỎ** | ép bố cục toàn trang (đổi `body.width`, đọc `offsetHeight`) trên 17695 ruby: có webfont 301–575 ms, `font-family:sans-serif` 179–1470 ms (nhiễu, trung vị ≈ cùng mức), `rt{display:none}` 61–185 ms. Chi phí bố cục nằm ở việc có 17k cặp `<ruby>/<rt>` trong dòng, không phải font; một lần bố cục lại toàn trang ≈ 0,3–0,6 s, khớp với 3 longtask 0,6–0,78 s |
| F4 | **FAIL (đo)** | overlay + cuộn 10 s (40 cú lăn): longtask 54–280 ms, 33–39 tác vụ, `TaskDuration` tăng **9,25 s / 3,81 s** (lần 3 hết thời gian chờ); cùng thao tác không script (hồ sơ empty): **0 longtask, 0,88 s** |
| F4 nguyên nhân | tìm được | hồ sơ CPU khi cuộn: nom-ruby 2,6 s / 13,2 s, đều trong `overlay-labels.js` `layout()` → `rectOf` → `Range.getClientRects` **1,85 s** và `getBoundingClientRect` của phần tử cha **0,49 s**; `layout()` chạy lại mỗi lần cuộn và đo lại rect của mọi record trong cha còn hiện (17 648 record) |
| F1 (3 lần) | ĐO | example.com: heap sau GC có script **146,2 / 146,1 / 159,7 MB** (trung vị 146,2) vs không script **0,9 / 1,0 / 0,9 MB**; `TaskDuration` 0,98 / 1,03 / 1,71 s vs 0,09 / 0,03 / 0,03 s; `ScriptDuration` 0,47–0,66 s vs ≈0. vnexpress.net: heap 92,3 / 165,8 / 91,9 MB vs 67,1 / 57,7 / 57,5 MB; `TaskDuration` 0,56 / 0,27 / 0,68 s vs 1,62 / 1,29 / 1,65 s (hồ sơ empty chậm hơn do không có chặn quảng cáo của hồ sơ yiu) |
| B1 | PASS (gián tiếp) | trang mở mới vnexpress.net (lượt hai): chưa hover thì `#zoopdog-userscript-popup`/`canvas` = 0 |

Ghi chú đo: heap 146 MB mỗi trang trên example.com đến từ toàn bộ userscript/extension trong hồ sơ yiu, không tách riêng được phần Zoopdog; tiêu chí "heap giảm ≥ 35 MB mỗi frame" vẫn **chưa đo được riêng** (cần một hồ sơ chỉ có Zoopdog). Vài lệnh `Performance/HeapProfiler` hết hạn 15 s trên vnexpress (nhiều iframe), nên số liệu đó thiếu 3 lần ở hồ sơ yiu.

### Còn chưa kiểm
E4 (`Alt+R`, âm thanh), E6 (không có kết quả cũ để so), G2 (userscript cũ), G4 (livestream YouTube), heap riêng của Zoopdog (cần hồ sơ chỉ có Zoopdog), A6 dòng "Using the previous dictionary…".

## Lượt bốn: sửa bố cục overlay (build 2026.11.18.2) và E4

`overlay-labels.js` `layout()` nay đo hết (rect, kiểu) rồi mới ghi nhãn (trước đây ghi xen kẽ với đọc, mỗi lần đọc buộc tính lại kiểu/bố cục). Test hồi quy: `test/overlay-labels.test.js` ("a layout pass measures everything before it writes any label").

| F4: overlay, cuộn 10 s (40 cú lăn), vi.wikipedia Việt_Nam | Trước | Sau (3 lần) | Không script |
| --- | --- | --- | --- |
| số longtask | 33–39 | **3 / 1 / 0** | 0 |
| longtask lớn nhất | 253–280 ms | **233 / 71 / 0 ms** | – |
| tổng longtask | ≈2,5–3 s | **405 / 71 / 0 ms** | 0 |
| `TaskDuration` tăng | 3,81–9,25 s | 8,24 / 2,47 / 2,23 s | 0,88 s |

F4 từ FAIL sang **gần đạt**: longtask gần như hết; `TaskDuration` vẫn cao hơn mốc (2,2–2,5 s so với 0,88 s; lần 1 là 8,24 s, có thể do trang còn đang quét). Hạn chế đo: nhiều lệnh `Performance`/`Input` hết hạn 15 s của cầu CDP trong lúc chạy nên một số cú lăn có thể bị mất; vòng lặp `getBoundingClientRect` của mọi phần tử cha (17,6k record) vẫn chạy mỗi lần cuộn và là ứng viên tiếp theo.

| ID | Kết quả | Ghi chú |
| --- | --- | --- |
| E4 | PASS (người dùng) | tự kiểm bằng tay: thanh chọn, `Alt+R`, `Escape` ổn |

### Chưa kiểm (ghi nhận, không có kế hoạch kiểm bằng CDP)
- **E6:** không có kết quả ghi lại từ bản trước khi tách `local-*.js` để so sánh.
- **G2:** cần userscript Jyutping/Katakana Terminator cũ của người dùng; hồ sơ yiu chỉ có 簡繁切替 (không phải bản cần so).
- **G4:** cần một livestream YouTube có nhãn "直播" lặp lại.
- **Heap riêng của Zoopdog / "giảm ≥ 35 MB mỗi frame":** cần hồ sơ chỉ có Zoopdog; hồ sơ yiu cộng cả userscript và extension khác (146 MB trên example.com).
- **A6:** dòng "Using the previous dictionary…" chỉ hiện khi một lần làm mới thất bại; điều hướng offline không tạo ra tình huống đó.
- **Giả thuyết còn lại của C2/F3:** chi phí bố cục 17k `<ruby>/<rt>` là vốn có của chế độ ruby; chưa thử giảm (ví dụ `content-visibility: auto`).
