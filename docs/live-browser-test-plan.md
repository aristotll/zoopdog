# Kế hoạch chạy thử trực tiếp trong trình duyệt local (AI live test)

Kế hoạch này dành cho một tác tử AI điều khiển trình duyệt thật của người dùng (cầu CDP của
`book-translator`, hoặc công cụ trình duyệt tích hợp) để kiểm tra những gì `make verify` và
`make browser-smoke` **không thể** kiểm: trình quản lý userscript thật, trang thật, CSP thật, trang
đã qua trình dịch, tab nền, nhiều iframe thật. Nó khép các mục "chưa đo / chưa kiểm chứng" trong
[kế hoạch cải thiện 2026-11](performance-and-maintainability-review-2026-11.md) (mục 9 và Giai đoạn 1–3).

Ngày soạn: 2026-11-17, trên commit `eec10c5`. Người chạy phải ghi lại commit thực tế đang thử.

## 0. Quy tắc an toàn (đọc trước, không có ngoại lệ)

Các quy tắc này đến từ [userscript-troubleshooting.md](userscript-troubleshooting.md) §4 và `AGENTS.md`.

1. **Không thao tác trên tab đang dùng của người dùng.** Mở tab mới, tốt nhất hồ sơ sạch
   (`cdp_session_tool.py open <url> --profile empty`) khi cần loại trừ userscript/extension khác. Chỉ
   gắn vào tab có sẵn khi người dùng chỉ định rõ URL.
2. **Không bấm vào widget nổi, quảng cáo, banner trên trang thật.** Một cú bấm CDP từng rơi trúng quảng
   cáo và điều hướng mất tab của người dùng. Mọi tương tác là rê chuột, cuộn, gõ vào ô của chính trang
   thử, hoặc bấm các nút do Zoopdog tạo (`#zoopdog-*`).
3. **Không ghi vào dữ liệu.** Không bao giờ gửi `POST /v1/nom/entries` thật, không bấm xác nhận
   "Add/Update/Replace" ở chế độ local, không sửa `zd-extension/db_src/user_nom_entries/**`. Thư mục này
   có thể đang được phiên khác chỉnh trực tiếp (xem `AGENTS.md`, mục Git Hygiene). Phần local-mode chỉ
   được dừng ở bước **xem trước** (`preview=1`).
4. **Giới hạn tải lên dịch vụ ngoài.** `cjk-ruby` gọi `translate_a/single` của Google. Chỉ thử trên vài
   trang CJK ngắn (mục D), không để chạy trên trang dài hay nhiều tab cùng lúc.
5. **Phím bấm qua CDP không tới được phím tắt của extension**, và tải lại qua CDP thường không kích hoạt
   lại trình dịch trang. Với kịch bản "trang đã dịch" (B7), nhờ người dùng tự bấm dịch rồi báo lại.
6. **Âm thanh:** `Alt+R` đọc to văn bản đã chọn. Hỏi người dùng trước khi thử (E4).
7. **Sửa lỗi không nằm trong lượt chạy này.** Lượt chạy chỉ ghi nhận. Mỗi lỗi thành một dòng trong bảng
   kết quả kèm bằng chứng; sửa là việc của lượt sau, có test hồi quy trước.
8. **Dừng ngay và báo người dùng** nếu: tab điều hướng đi nơi khác ngoài ý muốn; có hộp thoại đăng
   nhập/thanh toán; trang hiện mã CAPTCHA/Cloudflare; hoặc một thao tác có vẻ ghi dữ liệu.

## 1. Chuẩn bị

Ghi vào đầu file kết quả (mục 6): ngày, commit (`git rev-parse --short HEAD`), tên + phiên bản trình
duyệt, tên + phiên bản trình quản lý userscript, hệ điều hành, và hai số `@version` của userscript đang
chạy.

```sh
npm ci
make rebuild-userscripts            # bản công khai + (Local); ghi zoopdog-*.user.js ở thư mục gốc
make rebuild-extension-vnedict-json # từ điển cho website
python3 -m http.server 8000         # website: http://localhost:8000/popupdict.html
```

- Cài vào Violentmonkey/Tampermonkey từ **tệp local** (`file://…/zoopdog-popupdict.user.js`,
  `zoopdog-nom-ruby.user.js`, `zoopdog-cjk-ruby.user.js`; riêng mục E dùng các bản `-local`). Với
  Violentmonkey dùng "track local file". Bật **một** biến thể popup mỗi lần (public *hoặc* local), vì cả
  hai gắn cùng id phần tử.
- **Xác nhận đúng bản đang chạy** trước khi thử: mở trình quản lý, đọc `@version` (dạng `2026.11.17[.n]`)
  và so với dòng `// @version` ở đầu tệp vừa dựng. Một bản dựng mới chỉ được trình quản lý nhận khi nó
  kiểm tra lại tệp; nhờ người dùng bấm cập nhật rồi tải lại trang (userscript-troubleshooting §5).
- Chỉ bật các userscript khác của người dùng khi thử mục G (xung đột); các mục còn lại nên tắt hết để
  loại nhiễu.
- Muốn có "số đo gốc" cho mục F: dựng thêm bản `3c4df61` trong một `git worktree` ở thư mục tạm
  (xem `docs/build.md`, mục `make browser-perf`), cài tạm thay bản hiện tại, rồi khôi phục.

### Bằng chứng trong DOM (đọc được từ CDP, không cần console)

Console của userscript nằm trong thế giới cô lập mà cầu CDP không thấy, nên mọi kết luận phải dựa vào
các thuộc tính này:

| Phần tử | Thuộc tính | Ý nghĩa |
| --- | --- | --- |
| `#zoopdog-userscript-popup` | `data-last-hover` | Lý do lần rê gần nhất dừng: `locked`, `excluded`, `nopoint`, `noword`, `notcontained`, `same`, `nolookup`, `shown` |
| cùng phần tử | `data-last-error`, `data-reattached` | Lần rê bị lỗi; số lần phải gắn lại popup bị tách khỏi DOM |
| `<html>` | `data-zoopdog-nom-mode` (`ruby`/`overlay`), `data-zoopdog-nom-overlay`, `data-zoopdog-nom-error` | Trạng thái và lỗi của nom-ruby; **`error` phải luôn trống** |
| `<html>` | `data-zoopdog-cjk-ruby-mode`, `data-zoopdog-cjk-status`, `data-zoopdog-cjk-overlay`, `data-zoopdog-cjk-error` | Tương tự cho cjk-ruby |
| liên kết kết quả tìm kiếm | `data-zoo-explored` | Tô màu liên kết đã khám phá (chỉ bản local) |

Chi tiết hơn cho popup: chạy `localStorage.setItem('zoopdogDebug','1')` trên trang rồi tải lại (đọc một
lần lúc khởi động); gỡ bằng `localStorage.removeItem('zoopdogDebug')`. Chế độ hiển thị theo host được
lưu ở `localStorage['zoopdogNomMode:<hostname>']` và `['zoopdogCjkRubyMode:<hostname>']`
(`ruby` hoặc `overlay`); đặt giá trị rồi tải lại có tác dụng như lệnh trong menu của trình quản lý.

Mẫu đo hiệu năng chèn vào trang (trước khi tải userscript, hoặc dùng CDP `Page.addScriptToEvaluateOnNewDocument`):

```js
window.__zdLong = [];
new PerformanceObserver(l => l.getEntries().forEach(e =>
  window.__zdLong.push([Math.round(e.startTime), Math.round(e.duration)])))
  .observe({type: 'longtask', buffered: true});
```

`longtask` chỉ thấy tác vụ > 50 ms. Tổng thời gian tác vụ và heap lấy bằng CDP:
`Performance.getMetrics` (`TaskDuration`), và `HeapProfiler.collectGarbage` hai lần rồi
`Runtime.getHeapUsage`. Iframe cùng gốc chung một isolate nên heap là tổng của cả trang.

## 2. Ma trận kiểm thử

Mỗi dòng: **việc làm → kết quả mong đợi**. Ghi PASS / FAIL / BLOCKED (kèm lý do) và bằng chứng.
Trang mẫu chỉ là gợi ý; thay bằng trang tương đương nếu cần, nhưng ghi lại URL đã dùng.

### A. Website (không cần userscript)

| ID | Việc làm | Mong đợi |
| --- | --- | --- |
| A1 | Mở lần lượt `index`, `pronunciation`, `homophones`, `pronguide`, `popupdict` (`http://localhost:8000/…`) | Không có lỗi script chưa bắt (`Runtime.exceptionThrown`); bỏ qua lỗi font CORS khi mở bằng `file://`/origin lạ |
| A2 | `popupdict.html`: đợi trạng thái từ điển, rê chuột lên một từ trong đoạn mẫu | `#dictionary-status` = "Dictionary ready/refreshed (… entries)"; khung `#zoopdog-popup` hiện (rộng ≈260 px, cao ≈340 px) |
| A3 | Cũng trên A2: bấm `Shift` một lần, rê đi chỗ khác, bấm `Shift` lần nữa | Thẻ được ghim (hiện 📌) rồi gỡ ghim và đóng |
| A4 | `pronunciation.html`: gõ nhanh "Xin chào" vào `#input` | Một lần vẽ lại ~100 ms sau phím cuối; đủ ba phương ngữ; không có lần vẽ giữa chừng gây nhấp nháy |
| A5 | **Rủi ro của `defer`:** tải lại cứng (tắt cache) cả năm trang với mạng giả lập chậm (CDP `Network.emulateNetworkConditions`, ví dụ 150 ms RTT, 1,5 Mbps) | Vẫn khởi tạo đúng thứ tự, không `ReferenceError`/`Handlebars is not defined`; `popupdict` hiển thị đúng sau khi tải xong |
| A6 | `popupdict.html`: tải một lần rồi tắt mạng (`Network.emulateNetworkConditions offline`), tải lại | Dùng từ điển cũ trong IndexedDB: trạng thái "Using the previous dictionary…" và vẫn tra được |

### B. Popup dictionary userscript (bản công khai)

| ID | Việc làm | Mong đợi |
| --- | --- | --- |
| B1 | Mở trang tiếng Việt tĩnh (ví dụ một bài `https://vi.wikipedia.org/wiki/Hà_Nội`), **chưa** di chuột; đọc DOM | **Không** có `#zoopdog-userscript-popup` và `#zoopdog-userscript-canvas` (giao diện tạo lười) |
| B2 | Rê chuột lên một từ có trong từ điển (ví dụ "buổi sáng") | Popup hiện, đúng định nghĩa; `data-last-hover=shown`; `data-last-error` trống |
| B3 | Rê lên từ tiếng Anh/số trong trang tiếng Việt | Không popup; `data-last-hover` là `noword` hoặc `nolookup` (không phải lỗi) |
| B4 | Tải lại trang, **rê ngay** lên từ tiếng Việt (trong vòng ~1 s); đo thời gian từ sự kiện đến lúc popup hiện bằng `requestAnimationFrame` thăm dò; lặp lại sau khi chuột đứng yên 2 s trước khi rê vào từ | Chấp nhận được nếu hover đầu ngay sau nạp ≲ 200 ms và hover sau khi yên ≈ 20 ms (số đo hiện biết: 137 ms và 20 ms). Ghi số thật |
| B5 | `Shift` ghim, kéo biểu tượng 📌, `Shift` gỡ; tải lại, ghim lại | Vị trí ghim được nhớ qua lần tải lại (lưu bằng `GM_getValue`) |
| B6 | Cuộn trang, đổi kích thước cửa sổ khi popup đang hiện | Popup và khung tô sáng biến mất; không lỗi; rê lại vẫn hoạt động |
| B7 | **Iframe:** trang có nhiều iframe quảng cáo/tiện ích (một trang báo như vnexpress.vn; **không bấm** gì) | Iframe nhỏ hơn 50 px không dựng popup/canvas; iframe bình thường vẫn tra được; tổng số `#zoopdog-userscript-popup` chỉ ở frame có con trỏ |
| B8 | Cùng B7: bấm `Shift` khi con trỏ ở frame cha | Trạng thái ghim lan tới frame con đang hiện popup (phím được chuyển tiếp qua cả frame nhỏ) |
| B9 | **Trang đã dịch** (nhờ người dùng dịch tab bằng Immersive Translate/Trancy/trình dịch của trình duyệt) | Popup vẫn hiện; nếu bị tách khỏi DOM thì `data-reattached` tăng, popup vẫn vẽ được (lỗi lịch sử, xem troubleshooting §1) |
| B10 | **CSP/Trusted Types:** `https://github.com` và một trang của Google/YouTube | Popup hiện; bảng điều khiển không có vi phạm Trusted Types do `zoopdog-userscript` (đọc qua `Log.entryAdded`); nếu CSP chặn style/font thì ghi rõ |
| B11 | Trang không có chữ tiếng Việt nào (ví dụ `https://example.com`) | Không tạo giao diện; với CDP `Performance.getMetrics` cho thấy userscript không để lại việc nền đáng kể (xem F1) |

### C. nom-ruby (Chữ Nôm trên chữ Việt)

| ID | Việc làm | Mong đợi |
| --- | --- | --- |
| C1 | Bài Wikipedia tiếng Việt: đếm `ruby.zoopdog-nom-ruby` sau 5 s và sau 15 s | Có chú thích; số lượng ngừng tăng; `data-zoopdog-nom-error` trống |
| C2 | Trang dài (bài vi.wikipedia "Việt Nam" hoặc tương đương): ngay khi nạp, cuộn và gõ vào ô tìm kiếm của trang | Trang không bị đơ; `window.__zdLong` không có tác vụ > ~150 ms do script (số đo hiện biết: ≈96 ms trên trang tổng hợp 3 000 đoạn); chú thích hiện dần trong vài giây |
| C3 | Thêm văn bản sau khi tải (trang cuộn vô hạn/bình luận động, hoặc dán vào `contenteditable` rồi nhận phản hồi từ trang) | Văn bản mới được chú thích trong ≲ 1 s; không chú thích hai lần cùng một đoạn |
| C4 | **Nút bật/tắt** (nút tròn "喃" góc phải dưới, trong shadow root đóng; bấm bằng toạ độ, xác nhận bằng `elementFromPoint` trước): bấm một lần; bấm đúp; bấm một lần nữa | Một lần = vẽ lại; bấm đúp = tắt và **xoá hết** `ruby.zoopdog-nom-ruby`, văn bản gốc nguyên vẹn; bấm lại = bật; văn bản thêm sau đó vẫn được chú thích |
| C5 | Phần tử bị loại trừ: `textarea`, `input`, `code`, `pre`, `contenteditable`, `button` | Không có `ruby.zoopdog-nom-ruby` bên trong |
| C6 | **Tab nền:** mở bài dài ở tab nền (chưa kích hoạt) 20 s, rồi chuyển sang | Không treo; chú thích hoàn tất ngay hoặc trong vài giây sau khi kích hoạt (tài liệu ẩn quét một mạch, không chia lát) |
| C7 | **Nhàn rỗi:** trang tĩnh, đã chú thích xong, để yên 60 s; đo `TaskDuration` đầu và cuối | Gần như không đổi (nhịp quét giãn dần tới 5 s); không có `longtask` mới |
| C8 | **Chế độ overlay:** `localStorage.setItem('zoopdogNomMode:'+location.hostname,'overlay')`, tải lại | `data-zoopdog-nom-mode=overlay`, `data-zoopdog-nom-overlay` dạng `labels=N records=M …`, **không** có `<ruby>` trong trang; nhãn đúng vị trí khi cuộn; xoá khoá để quay về `ruby` |
| C9 | Trang có Shadow DOM mở (ví dụ trang dùng web component) hoặc phụ đề video | Văn bản trong shadow root mở cũng được chú thích |
| C10 | Trang ngôn ngữ khai báo không phải `vi` (`<html lang="en">` có đoạn tiếng Việt, và trang `lang="ja"`) | Chỉ chú thích từ có dạng Chữ Nôm (không chú thích từ ASCII trong vùng `lang` khác `vi`) |

### D. cjk-ruby (dùng Google Translate công khai — giữ tải nhỏ)

| ID | Việc làm | Mong đợi |
| --- | --- | --- |
| D1 | Một trang CJK ngắn (ví dụ bài ngắn trên `ja.wikipedia.org` hoặc `zh.wikipedia.org`) | Sau vài giây có `ruby.zd-cjk-ruby`; `data-zoopdog-cjk-status` mô tả trạng thái; `data-zoopdog-cjk-error` trống |
| D2 | Ngắt mạng (offline giả lập) khi nhãn đang chờ, rồi bật lại | Script thử lại (độ trễ 3 s → 10 s → 30 s → 120 s), không lỗi, nhãn xuất hiện sau khi có mạng; trong lúc chờ nhịp quét giữ ≈500 ms |
| D3 | Trang yên sau khi xong | Nhịp quét giãn dần (đo như C7), không còn yêu cầu mạng mới |
| D4 | `localStorage.setItem('zoopdogCjkRubyMode:'+location.hostname,'overlay')`, tải lại | `data-zoopdog-cjk-ruby-mode=overlay`, có nhãn overlay, không `<ruby>` mới |

### E. Chế độ local (chỉ khi `book-translator` đang chạy ở `127.0.0.1:8770`; **chỉ đọc**)

Điều kiện: bản `zoopdog-popupdict-local.user.js` đã bật (và tắt bản công khai). Máy đã có
`~/mine/book-translator` chạy máy chủ reader. Nếu không có, ghi BLOCKED cho cả mục E.

| ID | Việc làm | Mong đợi |
| --- | --- | --- |
| E1 | `GET http://127.0.0.1:8770/v1/suggest?kind=nom&text=bạn` từ tab sạch (hoặc `curl`) | 200 và JSON; xác nhận máy chủ sống trước khi thử giao diện |
| E2 | Rê chuột lên một từ trong trang; kiểm tra hàng nút của popup | Có nút hành động của chế độ local (thêm entry, đặt thứ tự), **không** có nút "Đánh dấu Nôm" của bản công khai |
| E3 | Mở modal "Add Chữ Nôm entry" cho một từ; xem danh sách gợi ý | Form tải bằng một yêu cầu `GET /v1/nom/form?vi=…`; gợi ý hiện; nhiều khung chữ không vỡ; **dừng trước nút xác nhận** |
| E4 | Chọn một cụm văn bản ngắn trên trang | Thanh chọn của local hiện; `Alt+R` đọc to (**hỏi người dùng trước**); `Escape` đóng thanh |
| E5 | Trên một trang kết quả Google: quan sát tô màu liên kết đã khám phá (`data-zoo-explored`) | Màu cập nhật sau lần làm mới (chu kỳ 60 s) và vẽ lại (2,5 s); **không bấm** nút làm mới/danh sách đen trừ khi người dùng đồng ý |
| E6 | Xác nhận code đã tách mười tệp `local-*.js` không đổi hành vi: so E2–E5 với kết quả ghi lại từ bản cuối trước đợt tách nếu có | Không khác biệt |

Quy tắc ghi chú: bất kỳ yêu cầu nào tới `127.0.0.1:8770` có `POST /v1/nom/entries` mà không có `preview=1`
là **vi phạm quy tắc 3**; nếu thấy trong nhật ký mạng thì dừng và báo.

### F. Số đo hiệu năng để khép các tiêu chí còn mở

Mỗi phép đo chạy **3 lần**, báo trung vị và khoảng min–max; tắt userscript trong trình quản lý để lấy
số "không có script" làm mốc, rồi bật lại.

| ID | Việc làm | Tiêu chí liên quan (kế hoạch) |
| --- | --- | --- |
| F1 | Trang không có chữ Việt (`example.com`) và trang có 5 iframe: thời gian chạy script (đọc từ `performance` của trình quản lý hoặc chênh lệch `TaskDuration` giữa có/không script), `longtask` dài nhất, heap sau GC | "Không tác vụ nào > 5 ms lúc nạp" — hiện **không đạt** (≈196 ms/frame); thêm số trên trình quản lý thật. "Heap giảm ≥ 35 MB mỗi frame" — hiện đo được 13–20 MB |
| F2 | Hover đầu tiên trên từ Việt (xem B4), trên máy thật | Độ trễ hover đầu; chấp nhận được hay không là quyết định của người dùng |
| F3 | nom-ruby trên 2–3 trang dài thật: `longtask` dài nhất, khoảng trống luồng chính tối đa (nhịp hẹn giờ 4 ms), thời gian tới khi số ruby ngừng đổi | "Không tác vụ > 50 ms do quét" — hiện 96 ms trên trang tổng hợp |
| F4 | Chế độ overlay (C8) khi cuộn liên tục 10 s trên trang dài: số `longtask`, `TaskDuration` tăng thêm | Tiêu chí overlay (chưa từng đo trong trình duyệt) |
| F5 | Đếm lần tính lại bố cục/kiểu (`Performance.getMetrics`: `LayoutCount`, `RecalcStyleCount`) khi quét trang dài có/không script | Phần ≈160 ms còn lại của lượt quét đầu là quét hay dựng bố cục (chưa tách được) |

### G. Hồi quy các lỗi lịch sử và xung đột

| ID | Việc làm | Mong đợi |
| --- | --- | --- |
| G1 | Bật đồng thời popup + nom-ruby + cjk-ruby trên một trang tiếng Việt có xen chữ Hán | Không "đánh nhau": `ruby` của nom không bị cjk bọc lại trong `<rt>`; popup vẫn thấy từ Việt (không `noword` do Han trong `rt`) |
| G2 | Bật thêm userscript Jyutping/Katakana Terminator cũ của người dùng nếu có | Ghi nhận xung đột (đã gộp vào `cjk-ruby`; hai bản không nên cùng chạy) |
| G3 | Trang có `line-height` ~1.6 và chú thích trên + dưới | Các dòng không chồng chéo (`line-height` tăng nhờ `:has(> ruby.zd-cjk-ruby)`) |
| G4 | Nhãn lặp (phát trực tiếp YouTube có "直播" lặp) | Không lặp vô hạn (lỗi 2026-11-14 đã sửa; xem troubleshooting) |

## 3. Thứ tự chạy và thời gian

1. **Chuẩn bị** (mục 1): 10–15 phút, gồm cài, kiểm `@version`.
2. **A → B → C** (≈ 60–80 phút): cốt lõi; làm hết trước khi sang mục khác.
3. **F** (≈ 30–40 phút): ngay sau B/C vì dùng cùng trang.
4. **D, G** (≈ 30 phút): ít khi đụng tới dịch vụ ngoài; D chỉ khi người dùng đồng ý.
5. **E** (≈ 20 phút): chỉ khi máy chủ reader sẵn sàng.

Dừng sớm và báo lại nếu A hoặc B1–B3 thất bại: các mục sau dựa vào chúng.

## 4. Tiêu chí đạt/không đạt của cả lượt chạy

- **Đạt:** không có FAIL ở A, B1–B6, C1–C5, mọi `data-zoopdog-*-error` trống, không có `data-last-error`.
- **Đạt có điều kiện:** có FAIL/BLOCKED ở các mục còn lại nhưng đã ghi rõ nguyên nhân và bằng chứng.
- **Không đạt:** có lỗi ghi vào dữ liệu (quy tắc 3), mất tab của người dùng, hoặc userscript làm trang
  đơ > 1 s (không do tab nền) trên trang bình thường.

## 5. Khi một bước thất bại

1. Chụp trạng thái: các thuộc tính ở mục "Bằng chứng trong DOM", URL, ảnh chụp màn hình (nhớ ảnh bị co
   giãn: đổi toạ độ trước khi rê chuột, dùng `elementFromPoint` để xác nhận).
2. Thử lại **một** lần trên tab sạch với hồ sơ trống để loại trừ extension khác.
3. Với lỗi popup: bật `zoopdogDebug`, tải lại, rê lại và đọc chuỗi `data-last-hover` chi tiết.
4. Ghi dòng FAIL, không sửa mã. Nếu nghi do bản chạy không đúng, xác nhận `@version` rồi tải lại.

## 6. Mẫu file kết quả

Lưu kết quả ở `docs/live-test-results-YYYY-MM-DD.md` (tệp mới, một lượt một tệp). Mẫu:

```markdown
# Kết quả chạy thử trực tiếp — <ngày>
Commit: <hash>  Trình duyệt: <tên phiên bản>  Trình quản lý: <tên phiên bản>  HĐH: <…>
Userscript @version: popup <…>, nom-ruby <…>, cjk-ruby <…>

| ID | Kết quả | Trang | Bằng chứng / số đo | Ghi chú |
| --- | --- | --- | --- | --- |
| A1 | PASS | … | … | |
```

Cuối tệp thêm ba phần ngắn: **Lỗi tìm thấy** (mỗi lỗi một dòng, kèm ID và bằng chứng), **Số đo**
(các bảng F, trung vị và khoảng), và **Tiêu chí kế hoạch**: mỗi tiêu chí "Tiêu chí xong" của Giai đoạn 1–2
là *đạt / không đạt / chưa đo*, nêu số.

## 7. Ngoài phạm vi

- Chuyển từ điển sang `@resource`, đổi schema từ điển của website, xoá `evdict.txt` hay
  `db_src/vnedict.json`, đổi tên `zd-extension/`: chờ người duy trì quyết định (xem Giai đoạn 4 của kế
  hoạch). Kết quả F1 là dữ liệu để quyết định mục `@resource`.
- Mọi thay đổi hợp đồng local-mode với `book-translator` (endpoint, payload, phím tắt): việc hai kho,
  không phải phần của lượt chạy này.
- Kiểm trên thiết bị di động thật hoặc trình quản lý userscript trên iOS: ghi BLOCKED nếu không có.
