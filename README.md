# WebCity

網頁版都市經營模擬遊戲，靈感來自 Cities: Skylines 與 SimCity。
在一塊空地上自由規劃道路、劃設區域、管理經濟與交通，打造一座活生生的城市。

## 快速開始

```bash
pnpm install
pnpm dev
```

開啟瀏覽器 `http://localhost:5173`，開始建造你的城市。

## 遊戲特色

- 3D Low Poly 等角視角，在瀏覽器中流暢運行
- 6 種道路類型 + 鐵路系統，自由規劃交通網路
- 多層高架道路與鐵路 — 立體交叉、跨水橋梁、匝道
- 6 種區域規劃（低/高密度住宅、商業、工業、辦公）
- 21 種區域建築，3 級升級系統
- 程序化建築量體 — 每組（區域／密度／等級）8 種變體、獨立挑選的屋頂形式、鄰居不撞版型
- 逐棟不同的立面 — 每棟自己的隨機種子決定窗戶、色調與細節
- 建築附掛三層 — 前庭草皮與地面物件（綠籬／樹／腳踏車架／管架等）、鋪面貼片、雨遮／招牌／卸貨棚
- 夜間語彙 — 招牌、燈頭、落地窗、工業高窗隨日夜發光
- 19 種公共建築專屬模型（CivicPlan 多格量體組裝）
- 遠景細節剔除 — 鏡頭拉遠自動關掉矮物件與懸挑
- 獨立市民模擬 — 每位市民擁有年齡、教育、幸福度、住所、工作
- 10 種市政服務（電力/供水/警察/消防/醫療/教育/垃圾/污水/殯葬/公園）
- 5 種大眾運輸（公車/地鐵/鐵路/渡輪/機場）
- 多模式轉乘 — 最多 3 段運具、7 條腿（步行與乘車交替）
- 車道級交通模擬 — Bezier 曲線車道、紅綠燈、壅塞、行人
- 經濟系統 — 稅收、RCI 需求、預算、全球市場
- 貨運鏈 — 工業生產、商業消費、鐵路/機場/公路進出口
- 15 種地圖圖層 + 5 種聚焦視角（地下、公車、鐵路、渡輪、轉乘）
- 環境模擬 — 污染擴散、天然資源、四季氣候
- 災害系統 — 地震、龍捲風、森林大火
- 行政區/政策/城市特化
- 里程碑解鎖 + 4 種偉大工程
- IndexedDB 本地存檔 + 自動存檔

## 技術架構

| 項目 | 選擇 |
|------|------|
| 語言 | TypeScript |
| 渲染 | Three.js (3D Low Poly) |
| 建構 | Vite |
| 測試 | Vitest (TDD, 382 檔 / 5700+ 測試) |
| 套件管理 | pnpm |
| 多執行緒 | Web Workers (模擬/交通/尋路) |
| 資料同步 | SharedArrayBuffer + postMessage |
| UI | Solid |
| 存檔 | IndexedDB |

### 架構原則

```
Main Thread          Web Workers
┌──────────────┐     ┌─────────────────┐
│ Three.js 渲染 │     │ Pathfinding Pool│
│ UI (Solid)   │     │ Simulation      │
│ 輸入處理      │     │ Workplace Dist  │
│              │     │ Save            │
└──────┬───────┘     └────────┬────────┘
       │  單向讀取              │
       ▼                      │
┌──────────────┐     SharedArrayBuffer
│   Core 邏輯   │◄────postMessage────┘
│ (純 TypeScript │
│  禁止 Three.js)│
└──────────────┘
```

- **Core 模組禁止 import Three.js** — 純邏輯，可獨立測試
- **渲染層單向讀取 Core 狀態** — 不回寫
- **模擬 Tick 與渲染幀脫鉤** — 邏輯穩定不受 FPS 影響
- **TDD 強制** — 所有新功能先寫測試再寫實作

## 專案結構

```
src/
├── core/               # 遊戲核心邏輯（純 TypeScript，無渲染依賴）
│   ├── grid/           #   網格、地形、座標系統
│   ├── road/           #   道路建設、路網圖
│   ├── rail/           #   鐵路、平交道
│   ├── elevation/      #   高架道路/鐵路、匝道、橋梁、高架維護
│   ├── zone/           #   區域規劃、密度規則
│   ├── building/       #   建築成長/升級/廢棄、基礎設施放置
│   ├── citizen/        #   市民生命週期、幸福度、移民、就業
│   ├── workplace/      #   工作地點距離快取（Worker 客戶端）
│   ├── economy/        #   稅收、預算、地價、全球市場
│   ├── service/        #   電力/供水/警察/消防/醫療等 10 種服務
│   ├── traffic/        #   車道圖、車輛模擬、壅塞、行人
│   ├── pathfinding/    #   水路尋路
│   ├── graph/          #   路網共用的圖結構
│   ├── transport/      #   公車/地鐵/鐵路/渡輪/機場、路線連線幾何
│   ├── district/       #   行政區、政策、特化
│   ├── environment/    #   污染、天然資源、水流
│   ├── climate/        #   季節、災害、預警
│   ├── simulation/     #   SimulationLoop、GameState、GameClock
│   ├── milestone/      #   里程碑、偉大工程
│   ├── overlay/        #   覆蓋層資料建構
│   ├── save/           #   序列化、存檔、遷移
│   ├── tutorial/       #   新手教程
│   ├── config/         #   地圖設定（大小、地形、起始資金）
│   ├── ViewMode.ts     #   檢視模式與各層透明度
│   └── utils/          #   共用工具函式
├── renderer/           # Three.js 渲染層
│   └── geometry/       #   程序化幾何
│       ├── buildings/  #     量體生成、屋頂、地面物件、貼片、懸挑
│       └── civic/      #     19 種公共建築的 CivicPlan
├── ui/                 # UI 元件
├── input/              # 滑鼠／鍵盤輸入
├── audio/              # 音效管理
├── workers/            # Web Worker 執行緒
├── showcase/           # 建築展示區（獨立入口，不載入遊戲）
├── Game.ts             # 遊戲主類（整合 Core + Renderer）
└── main.ts             # 進入點
docs/                   # 遊戲機制 Wiki（22 份文件）
```

## 遊戲機制 Wiki

完整的遊戲機制文件位於 [`docs/`](docs/index.md)，涵蓋所有系統的規則、數值和演算法。

### 城市建設

| 文件 | 內容 |
|------|------|
| [網格系統](docs/grid-system.md) | 世界結構、格子資料、地形生成、方向旗標 |
| [道路系統](docs/road-system.md) | 6 種道路、建設驗證、升級、路口、路網圖 |
| [鐵路系統](docs/rail-system.md) | 軌道建設、平交道、與道路共存規則 |
| [高架系統](docs/elevation-system.md) | 多層高架道路/鐵路、匝道、橋梁、立體交叉 |
| [區域規劃](docs/zone-system.md) | 6 種區域類型、密度規則、規劃限制 |
| [建築系統](docs/building-system.md) | 21 種建築、成長/升級/廢棄機制、基礎設施 |

### 市民與經濟

| 文件 | 內容 |
|------|------|
| [市民系統](docs/citizen-system.md) | 生命週期、教育、幸福度、健康、移民、出生、搬遷、就業 |
| [經濟系統](docs/economy-system.md) | 雙軌稅制、RCI 需求、預算、地價、全球市場 |
| [區域與政策](docs/district-policy-system.md) | 行政區、5 種政策、7 種區域特化、7 種城市特化 |
| [里程碑](docs/milestone-greatworks.md) | 6 階里程碑解鎖、4 種偉大工程 |

### 服務與交通

| 文件 | 內容 |
|------|------|
| [市政服務](docs/services-system.md) | 10 種服務、道路距離覆蓋演算法、服務分數 |
| [交通系統](docs/traffic-system.md) | 車道圖、碰撞偵測、壅塞、紅綠燈、行人、通勤 |
| [大眾運輸](docs/transport-system.md) | 公車/地鐵/鐵路/渡輪/機場、模式選擇 |
| [多模式轉乘](docs/transfer-system.md) | 最多 3 段運具、7 條腿、轉乘步行範圍 |
| [貨運系統](docs/freight-system.md) | 工業生產、商業消費、鐵路/機場/公路進出口 |

### 環境與事件

| 文件 | 內容 |
|------|------|
| [環境系統](docs/environment-system.md) | 3 種污染、天然資源、水流、犯罪率 |
| [氣候與災害](docs/climate-disaster-system.md) | 四季效果、5 種天災、預警系統 |

### 介面與工具

| 文件 | 內容 |
|------|------|
| [模擬迴圈](docs/simulation-loop.md) | 遊戲時鐘、Tick 分層、完整執行順序 |
| [覆蓋層](docs/overlay-system.md) | 15 種地圖覆蓋層視覺化、建築上色、繪製順序 |
| [存檔系統](docs/save-system.md) | 序列化、差分壓縮、版本遷移、Worker |
| [新手教程](docs/tutorial-system.md) | 9 步驟互動引導 |
| [除錯工具與檢視模式](docs/debug-viewmode.md) | Debug Panel、6 種 ViewMode、各層透明度 |

## 開發

```bash
pnpm install     # 安裝依賴
pnpm dev         # 開發伺服器
pnpm test        # 執行測試
pnpm lint        # ESLint
pnpm build       # 正式建構
```

### 建築展示區

`showcase.html` 是第二個 Vite 入口，不載入遊戲，直接排出所有建築模型：

```
http://localhost:5173/showcase.html
```

滑鼠控制鏡頭、時間滑桿驅動日夜、住戶滑桿改變量體，另有一個 civic 檢視模式
一次排出全部 19 種公共建築。細節剔除門檻與遊戲共用同一份。

## 授權

Private
