# 講座單據一次填 receipt-autofill-tool

受邀演講、審查、出席時常要填的「領據、匯款委託書、勞務報酬單」，一次完成：

1. **存好自己的資料**：姓名、電話、戶籍／通訊地址、身分證字號、銀行名稱與代碼、分行與代碼、帳號、戶名，以及身分證正反面與存摺封面影像。
2. **丟入空白單據**：支援 Word `.docx`、可填寫 PDF、一般 PDF。自動找出對應欄位填好，可逐項修改；一般 PDF 可在預覽上拖曳調整位置。
3. **產生浮水印影本**：身分證正反面與存摺排在同一頁 A4 PDF，浮水印文字自動帶入「僅供〇〇單位講座費請領使用・他用無效・日期」。

簽名、蓋章與機關內部核章欄位一律留白。

## 隱私

- 全部在瀏覽器裡處理，不上傳任何伺服器。頁面載入後可以斷網使用。
- 資料檔是加密的 `.json`（PBKDF2-SHA256 310,000 次 + AES-GCM-256，瀏覽器內建 WebCrypto）。檔案外流也無法讀取；**密碼忘記無法還原**。
- 可選擇在這台電腦記住「加密後」的資料，下次只要輸入密碼。

## 兩種欄位判斷方式

| | 一般網頁（GitHub Pages） | 在 claude.ai 開啟 |
|---|---|---|
| 方式 | 規則比對（標籤字典＋表格線偵測） | AI 判斷（Claude），也可切回規則比對 |
| 送出資料 | 無 | 只送空白表單的版面文字與欄位名稱；身分證、帳號、地址、電話等內容不會送出 |

同一份空白單據調整過一次後，對應方式會記在資料檔裡，下次直接套用。

## 限制

- 舊版 `.doc` 瀏覽器無法讀取，請先另存成 `.docx` 或 PDF。
- 掃描成圖片的 PDF 沒有文字可辨識，需用「新增文字到頁面」手動放置（只需做一次）。
- PDF 疊印字型為 Noto Sans TC 的 Big5 子集，罕用字可能無法顯示。

## 使用的開源元件

[pdf.js](https://github.com/mozilla/pdf.js)（Apache-2.0）、[pdf-lib](https://github.com/Hopding/pdf-lib) 與 @pdf-lib/fontkit（MIT）、[JSZip](https://github.com/Stuk/jszip)（MIT）、[Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC)（OFL-1.1）。

浮水印樣式延續 [護照影本浮水印工具](https://otaru-nthu.github.io/passport-watermark-tool/)。
