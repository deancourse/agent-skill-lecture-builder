---
name: course-page-generator
description: 將講稿或非結構化筆記轉換為約定的 Markdown 格式，再透過 build script 產生單一 HTML 課程頁面。Skill 的主要任務是 Markdown 格式轉換，build 只是最後一步。
---

# Course Page Generator

原始講稿 → 結構化 Markdown → `node .agents/skills/course-page-generator/scripts/build.mjs <dir>` → `index.html` → `node .agents/skills/course-page-generator/scripts/generate-og.mjs <dir>` → `assets/og-*.jpg`

## 專案結構

```
.agents/skills/course-page-generator/
├── scripts/
│   ├── build.mjs          # 課程頁 build script
│   └── generate-og.mjs    # 針對課程頁產出 1200x630 OG 縮圖（依賴 Puppeteer）
└── reference/             # 格式範例與 HTML 模板（含支援 ?og=1 的 base.html）

<root>/                      # 任意根目錄（例如 course/、lectures/、docs/）
├── config/
│   ├── global.yaml          # 全域設定（講者、社群、頁尾）
│   └── assets/              # 共用圖片（avatar 等）
├── <course-dir>/
│   ├── config.yaml          # 課程專屬設定（覆蓋 global）
│   ├── content.md           # 結構化 Markdown 講稿
│   ├── index.html           # 課程頁（build 生成）
│   └── assets/
│       └── og-*.jpg         # OG 縮圖（generate-og.mjs 產出）
```

## Workflow

### Step 0：偵測輸入類型

在進入轉換流程之前，先判斷使用者提供的是哪種輸入：

| 情境 | 判斷依據 | 行動 |
|------|----------|------|
| **只有主題** | 只給了一句話主題／標題，無對應資料夾或 Markdown | → 執行「主題生成流程」（見下方） |
| **有講稿內容** | 提供了講稿文字、大綱、或已有 content.md | → 直接進入 Step 1 |
| **有現有目錄** | 指定了已存在的課程資料夾 | → 讀取後進入 Step 1 |

#### 主題生成流程

當使用者只提供主題（例如「Python 非同步程式設計」）：

1. **決定課程資料夾位置**：將主題轉為 kebab-case 英文（例如 `python-async`）作為資料夾名稱。
   - 若使用者有指定路徑（例如 `lectures/python-async`），直接使用。
   - 否則，**用 Glob 工具掃描 repo 根目錄**，觀察現有的課程資料夾放在哪一層（例如是否有 `course/`、`lectures/` 等慣例目錄），沿用同層。
   - 若無任何慣例可循，直接建在 **repo 根目錄**下（`<course-dir>/`），不假設子目錄。

2. **建立資料夾結構**：
   ```
   <root>/<course-dir>/
   ├── config.yaml      # 從主題推導課程設定
   ├── content.md       # 根據主題生成骨架
   └── assets/          # 空資料夾（保留圖片用）
   ```

3. **生成 `config.yaml`**：根據主題填入基本欄位（`page.title`、`page.hero_title`、`seo.title`、`seo.description`、`quotes.opening`、`quotes.closing`）；`seo.image` 與 `seo.url` 留空或填入佔位符提醒使用者補充。

4. **生成 `content.md` 骨架**：
   - 推導 3–5 個主要章節（`#`），每章節下 1–2 個子章節（`##`）與 2–3 張卡片（`### Emoji Title`）
   - 每張卡片留 2–4 個條列式占位點（重點提示，非最終內容）
   - 在最後加入 `[summary]` 區塊，列出各章節預期的學習成果
   - 所有占位內容用 `<!-- TODO: ... -->` 或簡短提示標記，讓使用者知道哪裡需要補充
   - 骨架本身應具備足夠結構讓 build 可以成功執行

5. **確認 global config**：檢查是否已有 `config/global.yaml`，若無，在回覆中提示使用者參考 Step 2 建立。

6. **告知使用者**：列出已建立的檔案清單，並說明下一步（補充內容或直接 build）。

7. **完成後繼續 Step 2 以下流程**（確認 config → build → OG 縮圖）。

---

### Step 1：將講稿轉為結構化 Markdown

這是 Skill 的核心任務。使用者提供的可能是：
- 非結構化的演講筆記或大綱
- 已部分格式化的 Markdown
- 課程投影片的文字內容

AI 需要根據以下語法規則，將內容轉換為 `content.md`。

#### Markdown 語法約定

| 語法 | 用途 | 範例 |
|------|------|------|
| `# LABEL：TITLE` | 主章節 | `# 新專案：用 SDD 讓 AI 根據規格建立專案` |
| `> lead text` | 章節引言（緊接 `#` 後） | `> 規格驅動開發（Spec-Driven Development）` |
| `## Title` | 子章節 | `## OpenSpec 初始化` |
| `### Emoji Title` | 卡片標題 | `### 🔧 為什麼需要 OpenSpec？` |
| `` ```prompt [label="..."] `` | 終端機/Prompt 區塊 | 見下方 |
| `> **Bold Title**` | 洞察框（Insight） | `> **AI 正在改變企業決策**` |
| `[flow]...[/flow]` | 流程步驟 | 見下方 |
| `[tags]...[/tags]` | 標籤（必須用此區塊包裹） | `- [green] 正面` |
| `[summary]...[/summary]` | 總結卡片 | `- 🏗️ **標題** \| 描述` |
| `- [x] item` | 勾選清單（僅用於已驗證/已完成的事項） | `- [x] 已完成項目` |
| `![alt](src)` | 獨立圖片 | `![架構圖](images/arch.png)` |
| `[image-text]...[/image-text]` | 圖文並排 | 見下方 |
| `[youtube id="..." title="..."]` | YouTube 影片嵌入 | 見下方 |
| `---` | 章節分隔線 | 放在 `#` 章節之間 |

#### 詳細語法

**Prompt Block：**
~~~markdown
```prompt [label="安裝指令"]
npm install -g @fission-ai/openspec@latest
```
~~~

- Shell 指令開頭（`npm`, `git`, `docker` 等）→ header 顯示 "Terminal"
- 其他內容 → header 顯示 "Prompt"

**Flow Steps：**
```markdown
[flow]
1. proposal.md — 確認目標與範圍
2. design.md — 技術選型與風險評估
[/flow]
```

**Tags：**
```markdown
[tags]
- [green] 正面標籤
- [orange] 警告標籤
- [purple] 中性標籤
- [blue] 資訊標籤
[/tags]
```
⚠️ `- [color] text` 必須放在 `[tags]...[/tags]` 內，獨立使用不會套用顏色。

**Summary Grid：**
```markdown
[summary]
- 🏗️ **標題** | 描述文字
- ⚙️ **標題** | 描述文字
[/summary]
```

**Insight Box：**
```markdown
> **洞察標題**
> 第一段落內容。
>
> 第二段落內容（空行分隔）。
```

**獨立圖片：**
```markdown
![架構示意圖](images/architecture.png)
```
- 獨立一行 → 置中顯示，alt 文字自動成為圖說
- 在段落或列表中使用 → 行內圖片

**圖文並排（Image-Text）：**
```markdown
[image-text position="left" width="50"]
![產品截圖](images/screenshot.png)
這是產品的主要介面，提供了 **直覺式操作** 體驗。
- 支援拖放操作
- 即時預覽結果
[/image-text]
```
- `position="left"`（預設）：圖片在左、文字在右
- `position="right"`：圖片在右、文字在左
- `width="N"` 設定圖片佔比百分比（預設 40），例如 `width="30"` 或 `width="60"`
- 文字區域支援段落、粗體、程式碼、連結、列表
- 響應式：平板（≤ 900px）及手機自動改為上下排列

**YouTube 影片嵌入：**

單行：
```markdown
[youtube id="dQw4w9WgXcQ" title="Demo 影片"]
```

區塊（含說明文字）：
```markdown
[youtube id="dQw4w9WgXcQ"]
這是一段示範影片的說明
[/youtube]
```
- `id` 為 YouTube 影片 ID（網址中 `v=` 後面的值）
- `title` 為選填標題，顯示在影片下方
- 影片以 16:9 比例響應式嵌入
- 列印模式下顯示 YouTube 連結取代 iframe

完整元件對照請參考：[components.md](reference/components.md)
Markdown 範例請參考：[content-example.md](reference/content-example.md)

### Step 2：確認或建立課程 Config

Config 分為兩層：

| 檔案 | 用途 | 必要性 |
|------|------|--------|
| `config/global.yaml` | 全域設定（講者資訊、社群連結、頁尾） | 首次使用時建立一次 |
| `<course-dir>/config.yaml` | 課程專屬設定（覆蓋 global） | 每個課程各一份 |

> `config/global.yaml` 不需要放在固定位置，build 會從課程目錄往上搜尋最多 4 層父目錄。只需確保它存在於課程目錄的某個祖層即可。

#### 首次設定：建立 Global Config

如果還沒有 `config/global.yaml`，需要先建立全域設定。可參考 [config-example.yaml](reference/config-example.yaml) 作為模板：

1. 在課程目錄的任意祖層建立 `config/global.yaml`，填入講者資訊、社群連結、頁尾預設值
2. 在同層建立 `config/assets/` 資料夾，放入講師頭像（檔名為 `author`，副檔名可省略，build 會自動偵測 jpg/jpeg/png/webp/gif/svg）

全域設定的關鍵欄位：

```yaml
instructor:
  name: "講者姓名"
  tagline: "一句話簡介"
  bio: "講者介紹（支援 <br> 換行）"
  avatar: "config/assets/author"    # 可省略副檔名
  stats:                             # text 支援 **粗體** 等 inline markdown
    - text: "📚 出版 **7** 本專業書籍"
      url: "https://..."
  socials:                           # 支援 Medium/Facebook/Threads/YouTube/GitHub/LinkedIn/Email
    - platform: "YouTube"
      url: "https://..."

footer:
  cta: "行動呼籲文字"
  copyright: "© 你的名字"
  show_socials: true

seo:
  site_name: "網站名稱"
```

#### 課程 Config

每個課程目錄的 `config.yaml` 只需寫要覆蓋全域設定的欄位：

```yaml
page:
  title: "課程標題"
  badge: "BADGE 文字"
  hero_title: "Hero 大標題<br>支援換行"
  subtitle: "副標題"

seo:
  title: "SEO 標題"
  description: "頁面描述"
  image: "https://yourdomain.com/<course-dir>/assets/og-image.jpg"
  url: "https://yourdomain.com/<course-dir>/"

quotes:
  opening:
    text: "開場引言"
  closing:
    text: >
      結尾引言
```

⚠️ **`seo.image` 必須使用絕對 URL**（`https://...`），社群平台無法解析相對路徑，會導致 OG 預覽圖片無法顯示。

`nav`（Hero 導覽按鈕）預設從 `content.md` 的 `#` 章節自動產生，不需手動維護。
若需自訂按鈕文字，可在 config.yaml 中覆蓋：

```yaml
nav:
  - text: "自訂文字"
    href: "#section-id"
```

YAML 完整範例：[config-example.yaml](reference/config-example.yaml)

### Step 3：執行 Build（產出課程頁）

所有指令都從 **repo 根目錄** 執行：

```bash
node .agents/skills/course-page-generator/scripts/build.mjs <course-dir>
```

範例：

```bash
node .agents/skills/course-page-generator/scripts/build.mjs course/cake
```

自動流程：
1. 讀取 `config/global.yaml`（base config）
2. 讀取 `<course-dir>/config.yaml`（deep merge 覆蓋）
3. 解析 `<course-dir>/content.md`
4. 套用 HTML 模板 → 填入 TOC / Scroll Spy
5. 輸出 `<course-dir>/index.html`

### Step 4：為課程頁產生 OG 縮圖

Build 完之後，**一律**針對同一個課程目錄產生 1200×630（1.91:1）的 OG 縮圖：

```bash
node .agents/skills/course-page-generator/scripts/generate-og.mjs <course-dir>
```

> ⚠️ 此步驟為必要步驟，每次 build 完成後都要執行。需要 Puppeteer（`npm install --save-dev puppeteer`）。

`generate-og.mjs` 的行為概要：

1. 使用 Puppeteer 開啟 `file://<course-dir>/index.html?og=1`
   - `?og=1` 會觸發 `base.html` 中的 `og-mode`：
     - 隱藏 sidebar / footer / 一般內容 section
     - 只保留 hero 區塊，適合作為社群縮圖
2. 將 viewport 設為接近手機寬度、較高 `deviceScaleFactor`，輸出 1200×630 截圖
3. 將結果存到 `<course-dir>/assets/og-*.jpg`，課程 config 的 `seo.image` 應指向該檔案

## Config 合併規則

- **Deep merge**：課程 config 只需寫要覆蓋的欄位
- **Arrays 整個取代**：例如 `nav` 或 `socials` 在課程 config 有定義時，完整取代全域的
- **沒有課程 config**：直接使用全域 config

## 轉換指引

**⚠️ 核心原則：講義是傳遞資訊的載體，請「萃取重點」而非「逐字轉錄」。**
請忽略口語化的過場詞（如：大家好、接下來我們看、老實說）、贅字與講者自我呢喃，直接將講稿「提煉」成結構化的條列重點、圖表或卡片。

當使用者提供原始講稿時，AI 應該：

1. **萃取章節結構** — 移除口語過場，找出核心主題的轉換點，對應到 `#` 主章節與 `##` 子章節。
2. **資訊卡片化（極其重要）** — 將長篇大論的解說，提煉成精簡的 `### Emoji Title` 卡片與條列式列表，不要把講稿的段落直接複製貼上。
   - **原則：所有內容都應該落在結構化元件內**（卡片、Insight、Flow、Tags 等），避免出現裸段落（`loose-text`）。
   - ❌ 錯誤示範：直接把講稿貼成段落
     ```markdown
     一開始我把課程大綱交給 AI，第一版完成度很高。
     但 AI 會自己增減文字，想修改時得回去改 HTML。
     ```
   - ✅ 正確做法：提煉成卡片 + Insight
     ```markdown
     ### 💡 第一版很快，但改不動
     - 把課程大綱直接交給 AI，第一版完成度很高
     - 但 AI 會自行增減文字、改變強調方式
     - 想修改時，得回去改 HTML 原始碼

     > **不能只停留在 AI 幫我生成第一版**
     > 講義要維護的是內容，不是 HTML。
     ```
3. **標記指令與操作** — 程式碼、CLI 指令、Prompt 範例，用 `` ```prompt `` 包裹。
4. **整理流程步驟** — 講述到操作或邏輯步驟時，將其整理成清晰的 `[flow]...[/flow]`。
5. **提煉深度觀點** — 將講稿中的核心洞察、反思或重要結論，轉為 `> **Title**` Insight Box 點出。
6. **產生總結** — 最後一個段落請直接用 `[summary]...[/summary]` 歸納本次課程精華。
7. **確認開場與結尾引言** — 檢查課程 `config.yaml`（或 `global.yaml`）是否已設定 `quotes.opening` 和 `quotes.closing`。若尚未設定，根據講稿的核心精神各撰寫一段引言，寫入 `config.yaml`。開場引言出現在講師介紹之後、第一個章節之前；結尾引言出現在所有章節之後、頁尾之前，用於收束整場課程的訊息。
9. **搜尋並插入圖片** — 當內容適合搭配圖片時（架構圖、截圖、流程圖等），主動用 Glob 工具搜尋 `<course-dir>/assets/` 資料夾中的圖片檔（`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.svg`, `*.webp`）。
   - **找到匹配圖片**：根據檔名判斷最適合的圖片，插入對應的 `![alt](assets/filename)` 或 `[image-text]` 區塊。
   - **找不到圖片**：在該處插入 HTML 註解標記，格式為 `<!-- TODO: 建議在此加入圖片：{圖片描述}，請將圖片放到 assets/ 資料夾 -->`，同時在回覆中彙整所有缺圖位置，提醒使用者補充。
   - **assets 資料夾不存在**：提醒使用者建立 `<course-dir>/assets/` 並放入相關圖片。
10. **驗證格式** — 對照 [components.md](reference/components.md) 確認語法正確。

## Reference Files

- 元件對照：[components.md](reference/components.md)
- YAML 範例：[config-example.yaml](reference/config-example.yaml)
- Markdown 範例：[content-example.md](reference/content-example.md)
- HTML 模板：[base.html](reference/base.html)
