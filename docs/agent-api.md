# Agent API (`window.__agent`)

讓**程式**（而不是滑鼠）玩這個遊戲的入口。遊戲裡看得到、按得到的東西，這裡都有一份。

兩種用法，做得到的事完全一樣：

**在瀏覽器裡**（主控台、chrome-devtools MCP、Playwright⋯）

```js
window.__agent.read.city()
window.__agent.act({ tool: 'road', x1: 10, y1: 10, x2: 30, y2: 10 })
```

**用 `curl`**（`npm run dev` 的時候才有，見〈交給另一個 AI〉）

```bash
curl -X POST localhost:5173/agent -d '{"path":"read.city"}'
curl -X POST localhost:5173/agent \
  -d '{"path":"act","args":[{"tool":"road","x1":10,"y1":10,"x2":30,"y2":10}]}'
```

---

## 交給另一個 AI

你 `npm run dev` 之後，把**網址**跟**這份文件**丟給你自己的 Claude Code / Codex，
它就能玩了。

### 為什麼需要 `curl` 這條路

`window.__agent` 活在**瀏覽器分頁裡**，不在網址上。對方 AI 拿到網址去 `curl`，
收到的只有 HTML —— 除非它自己有瀏覽器工具（chrome-devtools MCP、Playwright），
否則碰不到那個介面。而玩家的 agent 不一定裝了那些。

所以 dev server 上開了一條路，把 HTTP 請求**轉進你開著的那個分頁**：

```
對方 AI ──POST /agent──▶ dev server ──HMR 通道──▶ 你的分頁 window.__agent
        ◀──── JSON ─────            ◀────────────
```

### 怎麼呼叫

`path` 就是這份文件裡的方法名，`args` 是它的參數，照順序。

```bash
curl -X POST localhost:5173/agent -d '{"path":"read.city"}'
curl -X POST localhost:5173/agent -d '{"path":"routes.create","args":["bus",[1,2],2]}'
curl -X POST localhost:5173/agent -d '{"path":"ui.openPanel","args":["overview"]}'
curl localhost:5173/agent          # GET 會回用法與幾個例子
```

回應永遠是 `{ ok, result }` 或 `{ ok, error }`，**HTTP 狀態碼一律 200** ——
看 `ok` 就好，不必同時解讀狀態碼跟內容。

裡面那一層有自己的 `ok`。外層的 `ok` 是「這通呼叫成立」，內層的是「遊戲答應了」：

```json
{ "ok": true, "result": { "ok": false, "reason": "Cannot build on water" } }
```

### 兩件會擋下來的事

| 訊息 | 意思 |
|------|------|
| `no game page is connected` | 遊戲沒開在瀏覽器裡。橋是轉進分頁的，沒有分頁就沒地方轉 |
| `refusing to walk into constructor` | 路徑想爬進原型鏈。只走得到這份文件列出來的東西 |

### 這條路只在 `npm run dev` 上

`npm run build` 出來的靜態檔**沒有這一段** —— 不是關掉，是伺服器那半邊根本沒地方住
（它是 dev server 的 middleware）。頁面端走 `import.meta.hot`，build 之後也不存在。

而且沿用 vite 預設**只綁 localhost**。加了 `--host` 的話，同網段的人就能操作你正在玩
的那一局（拆房子、蓋掉你的存檔、讀你的城市資料），只有刪存檔碰不到。自己那台電腦上
的 AI 不需要 `--host`。

---

## 為什麼是一層包裝，不是直接叫底層

**不直接叫 core 的 builder**：`RoadBuilder.buildRoad()` 這種東西從外面叫得到，但 `Game`
在呼叫它們之後還做了一整串**失效通知**（`markLaneGraphDirty`、`roadCoverageDirty`、
`invalidateZoneBlockers`）。少掉任何一個，城市會**安靜地**壞掉 —— 通勤路網圖有快取，
沒有通知就不會重算，市民會繼續走一條已經拆掉的路，而畫面上什麼都看不出來。

**也不直接叫 `Game.handleToolAction()`**：它讀的是一組**留在 `Game` 上的狀態**
（`currentTool`、`placementMode`、`elevationLevel`、`currentRotation`）。玩家剛蓋完
一段高架，`placementMode` 停在 `'elevated'`，程式接著蓋路 —— 蓋出來的是高架橋，
而且不會報錯。所以 `act()` 每次都把全部相關狀態**明寫一次**。

---

## 沒有復原功能

整個 repo 沒有 undo。這決定了這套 API 的幾條規矩：

| 規矩 | 為什麼 |
|------|--------|
| **沒有刪除存檔** | `SaveManager.deleteSave()` 存在，但 `session` 不包它。存檔是唯一的檢查點，程式抹掉就救不回來。要刪請走主選單 |
| **`save()` 不准寫 slot 0** | 那是自動存檔用的 |
| **一次拆除上限 64 格** | 上限管的是單次動作的爆炸半徑。拆一個街廓可以，拆掉半座城不行 |
| **每一支都回結果物件，不丟例外** | 呼叫端是程式，`{ ok: false, reason }` 讀得懂 |
| **擋下來的時候一定沒碰到遊戲** | 驗證失敗就不呼叫底層，測試盯著這件事 |

---

## 分成這幾塊

| | 做什麼 |
|---|---|
| `status()` | **玩家現在在看什麼。** 主選單上也答得出來 |
| `act()` / `history()` | 蓋、拆、劃分區、畫分區 —— 所有工具列上的工具 |
| `routes` | 公車／地鐵／鐵路／渡輪的建線、拆線、加減車 |
| `budget` | 稅率、借款、還款 |
| `policy` | 分區條例、全城條例、城市特化 |
| `districts` | 分區的增刪改名換色合併，筆刷指向誰、用什麼模式 |
| `ui` | 面板、圖層、視角模式、工具、暫停與速度、鏡頭、取消選取 |
| `read` | 城市數字、建築、居民、服務、大眾運輸、逐格資料、面板統計 |
| `session` | 存檔清單、存檔、匯出、匯入、載入、開新局 |

---

## `status()` — 玩家現在在看什麼

**每一輪對話的第一句就該問這個。** 它在主選單上也答得出來 —— 那正是最需要它的時候。

```bash
curl -X POST localhost:5173/agent -d '{"path":"status"}'
```

還沒開始遊戲：

```json
{ "screen": "menu", "menuPage": "main",
  "panel": null, "settingsOpen": false, "tutorial": null }
```

遊戲中：

```json
{ "screen": "game", "menuPage": null,
  "panel": "overview", "settingsOpen": false,
  "tutorial": { "active": true, "step": 1, "total": 9 },
  "tool": "select", "paused": false, "speed": 1,
  "viewMode": "NORMAL", "overlay": "none", "notification": null }
```

| 欄位 | 說明 |
|------|------|
| `screen` | `menu` / `loading` / `game` |
| `menuPage` | 主選單停在哪一頁:`main` / `newGame` / `load`。不在主選單時是 `null` |
| `panel` | 開著哪個面板 |
| `settingsOpen` | 設定畫面開著嗎。**它不走面板橋，`panel` 永遠看不到它** |
| `tutorial` | 新手教程走到哪。`step` 從 1 算起，跟畫面上的「Step 3 of 9」一致 |
| `tool` `paused` `speed` `viewMode` `overlay` `notification` | **只有 `screen === 'game'` 時才有** |

### 沒有遊戲的時候那幾欄是不存在的，不是預設值

主選單與載入中都沒有 `Game`，所以工具、速度那些欄位**整個不出現**，而不是 `0` /
`'select'` / `false`。回一個假的預設值會讓呼叫端以為遊戲正在跑而且暫停著。

這對「載入中」尤其要緊:遊戲中按「載入存檔」的時候，`window.__agent` 還指著**上一局**
（要等新的 `Game` 做好才換）。照著回報的話，會拿一座正在被丟掉的城市回答問題。

---

## `act()` — 動手

```ts
act(action: AgentAction): AgentActionResult
```

### AgentAction

| 欄位 | 型別 | 說明 |
|------|------|------|
| `tool` | ToolType | 見下方工具表 |
| `x1`, `y1` | number | 起點格 |
| `x2`, `y2` | number? | 終點格。省略就是單格 |
| `elevated` | boolean? | 高架。**只有道路與鐵軌吃得到**，其餘工具給了也會被 `setTool` 蓋掉 |
| `elevationLevel` | number? | 高架第幾層，預設 1 |
| `rotation` | 0\|90\|180\|270? | **角度，不是索引** |

### AgentActionResult

| 欄位 | 型別 | 說明 |
|------|------|------|
| `ok` | boolean | 遊戲沒有拒絕。**不等於「有東西改變」**（見下） |
| `tool` | ToolType | |
| `rect` | `{x1,y1,x2,y2}` | |
| `cost` | number | 花掉多少。負數是退錢 |
| `reason` | string? | 被拒絕時遊戲自己的說法 |
| `info` | string? | 成功時遊戲還是說了話（分區筆刷每一筆都會說） |

> **`ok` 不等於「有東西改變」。** 在已經有路的地方再蓋一次不會被拒絕，也不會花錢。
> `cost === 0 && ok` 多半代表這個動作什麼也沒做。唯一的例外是分區筆刷 —— 它有自己的
> 判定（見下）。

### 工具

| 類別 | 值 |
|------|-----|
| 選取 | `select` |
| 道路 | `road`（＝`road_2lane`）、`road_rural`、`road_2lane`、`road_4lane`、`road_6lane`、`road_highway` |
| 鐵軌 | `rail_track` |
| 分區 | `zone_r` `zone_rh` `zone_c` `zone_ch` `zone_i` `zone_o` |
| 服務 | `police` `fire` `hospital` `school` `school_high` `school_univ` `cemetery` |
| 公用 | `power` `water` `sewage` `garbage` `park` |
| 大眾運輸 | `bus_stop` `metro_station` `train_station` `ferry_dock` `airport_s` `airport_m` `airport_l` |
| 行政區筆刷 | `district` |
| 拆除 | `demolish` |

### 分區筆刷的成敗不看通知

這支筆刷**每一筆都會出聲**，而那是刻意的：選取的分區在畫面外時，「Downtown +15 cells」
那句話是唯一的痕跡。所以 `ok` 對它是看**筆刷到底做了什麼**（`Game.lastDistrictGesture`），
成功時遊戲說的話放在 `info` 而不是 `reason`。

```js
a.act({ tool: 'district', x1: 20, y1: 20, x2: 24, y2: 22 })
// { ok: true, cost: 0, info: 'Downtown +15 cells' }
```

點一下（不拖曳）是**撿起**那一區，再點一次是放掉。

### `history()`

最近 50 筆動作，新的在後面。

---

## `routes` — 路線

四種運具建路線的方式**沒有一個一樣**（公車要沿馬路做車道尋路、渡輪要驗水路連不連得通、
鐵路要指定客貨運），差異包在各自的 adapter 裡，這一層做共通的把關。

| 方法 | 說明 |
|------|------|
| `modes()` | `['bus', 'metro', 'rail', 'ferry']` |
| `stops(mode)` | 已經蓋好的站牌 `[{id, x, y}]`。建路線要的 ID 從這裡來 |
| `list(mode)` | 跑著的路線 `[{routeId, stopIds, vehicleCount, suspended}]` |
| `create(mode, stopIds, vehicleCount = 1)` | `stopIds` 的**順序就是行駛順序**，不排序也不去重 |
| `delete(mode, routeId)` | |
| `addVehicle(mode, routeId)` | |
| `removeVehicle(mode, routeId)` | |

```js
const stops = a.routes.stops('bus');            // [{id:1,...}, {id:2,...}]
a.routes.create('bus', [1, 2], 3);              // 三台車跑 1→2
a.routes.addVehicle('bus', 1);
```

**幾件會被擋下來的事**：不到兩站、站牌 ID 不存在、車輛數不是整數、遊戲說到不了
（公車沒路／渡輪沒水路）、路線 ID 不是這種運具的（各運具的 ID 各自從小編，撞號是常態）。

> **減車的下限是一台，不是零。** `removeVehicleFromRoute` 判 `vehicles <= 1` 就直接
> return —— 四種運具都繼承這一支。想讓路線停掉要**拆線**。

---

## `budget` — 稅率與貸款

| 方法 | 說明 |
|------|------|
| `taxes()` | `{incomeTax, businessTax, min, max}` |
| `setIncomeTax(rate)` | 所得稅（住宅） |
| `setBusinessTax(rate)` | 營業稅 |
| `debt()` | `{funds, loans}` |
| `takeLoan(amount)` | |
| `repayLoan(amount)` | |

稅率只收 **1–20 的整數**（`TAX_RATE_MIN` / `TAX_RATE_MAX`，面板的滑桿讀同一份）。

**營業稅四個欄位一起動**（`business` + `commercial` / `industrial` / `office`）。三個逐區的
舊欄位還在被計算 —— 只設 `business` 的話商業區會照舊稅率繳，而面板上看不出來。逐欄位
開放會讓程式做得出面板做不到的狀態，那時候滑桿顯示的就是謊話。

**借款不設上限**：它是可逆的（還得掉），憑空定一個「最多借多少」需要這個經濟模型的
知識。擋的是型別 —— 非正整數。還款會先問清楚有沒有債、夠不夠還、手上錢夠不夠，因為
遊戲的 `repayLoan` 會**靜靜地**夾成 0。

---

## `policy` — 條例與特化

| 方法 | 說明 |
|------|------|
| `list(districtId?)` | 全部條例 `[{type, name, scope, maxLevel, level}]` |
| `setLevel(type, level, districtId?)` | `0` 是關閉 |
| `specializations()` | `{current, population, options}` |
| `chooseSpecialization(type)` | `'NONE'` 是取消 |

### 範圍不是選項

每個條例只屬於**分區**或**全城**其中一邊（`POLICY_SCOPE`）。全城條例帶了 `districtId`
是錯誤，分區條例沒帶也是錯誤，**兩種都擋** —— 同一條兩邊都生效的話效果會加倍，
而費用只收一次。

`list()` 不帶 `districtId` 時，分區條例的 `level` 是 **`null`**（「還不知道」，不是「關著」）。

### 設完一定讀回來

`CityOrdinances.setLevel()` 與 `PolicyManager.setPolicyLevel()` 遇到不合法輸入
**一律靜靜地 return** —— 不丟例外、不回值。對按鈕是對的（按鈕產生不出不合法的輸入），
對程式呼叫就不是：回一個 `ok: true` 而條例根本沒開，之後只能從帳單上少的那一筆錢反推。

所以這一層設完會讀回來對一次，對不上就回 `ok: false`。

```js
a.policy.setLevel('ENERGY_REGULATION', 2);              // 全城
a.policy.setLevel('CONGESTION_CHARGE', 1, 'district_1'); // 分區
```

城市特化的人口門檻**不抄第二份** —— 問遊戲，被拒絕之後才回頭解釋為什麼。

---

## `districts` — 行政區

**格子不在這裡畫。** 分區的格子是拖出來的（`act({ tool: 'district', ... })`）。這一層決定
筆刷**指向誰**、用**哪一種模式**，以及分區本身的增刪改名換色。

| 方法 | 說明 |
|------|------|
| `list()` | `[{id, name, cellCount, colorIndex, active}]` |
| `active()` / `brush()` | 筆刷指著誰、什麼模式 |
| `setActive(id \| null)` | `null` 是放掉 —— 下一筆拖曳會開一個新的分區 |
| `setBrushMode(mode)` | `'replace'` / `'add'` / `'subtract'` |
| `create(name?)` | 順手把筆刷指過去。不給名字遊戲自己編號 |
| `rename(id, name)` | |
| `setColor(id, colorIndex)` | 色票索引 0–7 |
| `delete(id)` | 連同它身上的條例。筆刷正指著它的話會一起放掉 |
| `merge(keepId, mergedId)` | |

**名字不給撞。** 分區靠 id 分辨，但人是靠名字講話的 —— 清單上兩個 Downtown 會讓
「把 Downtown 的壅塞費關掉」變成一句沒有答案的話。遊戲自己不擋（自動命名會避開，
手動取名不會）。

**一律先驗 id。** `DistrictManager` 的寫入遇到不存在的 id 幾乎都是靜靜地 return，
唯獨 `mergeDistricts` 是**丟例外**。

---

## `ui` — 看得到按得到的

| 方法 | 說明 |
|------|------|
| `panels()` / `panel()` | 可以開哪些、現在開著誰 |
| `openPanel(id)` / `closePanel()` | `overview` `layers` `cityspec` `district` `transit` `debug` |
| `overlay()` / `setOverlay(type)` | `none` `traffic` `landValue` `pollution` `crime` `power` `water` `zone` `police` `fire` `health` `education` `park` `garbage` `district` `commute` |
| `viewMode()` / `setViewMode(mode)` | `NORMAL` `UNDERGROUND` `RAIL_FOCUS` `FERRY_FOCUS` `BUS_FOCUS` `TRANSFER_FOCUS` |
| `tool()` / `setTool(tool)` | 只切工具，不動 `placementMode` 那些 —— 要蓋東西請用 `act()` |
| `paused()` / `setPaused(b)` | |
| `speed()` / `setSpeed(target)` | |
| `camera()` / `setCamera(target)` | |
| `deselect()` | 關掉詳情面板 |
| `notification()` | 遊戲現在顯示的那一則訊息 |

### 速度是固定檔位

**1 / 3 / 5 / 10**，不是連續值。不在檔位上的目標會**對齊到最近的一檔**，一樣近取慢的
（快轉會把玩家還沒看到的事情跑掉）。`0` 在 `GameSpeed` 裡代表暫停，但遊戲的
`setSpeed(0)` 直接不理它 —— 暫停有自己的入口，這裡把 `0` 當成最慢的一檔。

選了速度就是要它跑：**會順手解除暫停**，跟工具列的速度鈕一樣。

### 鏡頭

```ts
setCamera({ x?, y?, size?, angle?, elevation? })
```

| 欄位 | 說明 |
|------|------|
| `x`, `y` | 看向地圖上的哪一格 |
| `size` | 畫面高度換算成幾格。**這是正交相機的視錐高度，不是距離** —— 改 `cameraDistance` 幾乎不影響縮放 |
| `angle` | 方位角（弧度）。0 是軸向對齊，π/4 是預設的等角視角 |
| `elevation` | 俯角（弧度），夾在 π/18 ~ 4π/9 |

### 面板那一路要有 UI

面板住在 Solid 的 signal 裡，不是 `Game` 的方法 —— `GameUI` 掛載時把入口**註冊**進
`registry`。所以在沒有 UI 的環境（單元測試）`openPanel()` 回 `false` 而不是丟例外。

---

## `read` — 讀

### 吐事實，不吐面板的彙總

Overview 那八頁把數字算在各自的 `createMemo` 裡（共兩千多行 TSX）。抄一份過來就是這個
repo 一再警告的那個錯 —— 同一個數字兩個地方各記一份，然後靜靜地分家（BUG-342 就是
這樣來的）。所以規則是：

- **已經抽成純模組的直接重用**（大眾運輸走 `transitRows.ts`，面板自己也在用那一支）
- **`Game` 已經算好的原封不動轉手**，不重算也不複製
- **其餘吐原始事實**，彙總留給呼叫端

| 方法 | 回什麼 |
|------|--------|
| `city()` | 季節、週、日、時、市庫、每 tick 淨收支、人口、就業、幸福、RCI、電力、水 |
| `buildings(query?)` | 每一棟的座標、型別、分區、等級、容量、住戶、員工、地價、汙染、是否廢棄 |
| `citizens(query?)` | 年齡、教育、幸福、住哪、在哪上班 |
| `services()` | 各服務的維運費與總計 |
| `transit()` | 各運具的路線、班距、載重、狀態（跟 Traffic 頁同一份） |
| `cells(rect)` | 一塊範圍內每一格的原始欄位 |
| `selected()` | 現在點開的那一棟（詳情面板那一份） |

`buildings()` 的查詢：`zone`（分區白名單）、`rect`、`limit`（預設 500）、`derelictOnly`。
`citizens()` 的查詢：`limit`（預設 200）、`homeId`、`workplaceId`、`unemployedOnly`。
`homeId` / `workplaceId` 的鍵是 `"x,y"`。

### `Game` 已經算好的

這幾支面板正在讀，**原封不動**交出去：

| 方法 | 內容 |
|------|------|
| `economyBreakdown()` | 帳本明細，收入支出逐項 |
| `billableDistricts()` | 收費分區的道路格數與付費駕駛數 |
| `commuteStats()` | 通勤時間分佈 |
| `trafficStats()` | 車流量、最塞的路段、平均路徑長度 |
| `transferStats()` | 轉乘率與轉乘熱點 |
| `abandonmentStress(x, y)` | 某一格的遺棄壓力。滿了就會變成廢墟 |

> **有兩個欄位是 `Map` / `Set`**（`commuteStats().byHome`、分區的 `cells`），
> `JSON.stringify` 會把它們變成 `{}`。要跨進程送的話呼叫端自己 `[...map]`。

`cells(rect)` 是最貴的讀法 —— 60×60 全開是 3600 筆。用來看一小塊地能不能蓋，
不是用來看全城。

---

## `session` — 主選單那一層

| 方法 | 說明 |
|------|------|
| `list()` | 有哪些存檔 |
| `save(slotId = 1, name = 'Agent Save')` | **會蓋掉那一格**。slot 0 被拒絕 |
| `export(slotId)` | 匯出成檔案下載 |
| `importSave(fileContent, name?)` | 匯入匯出檔。**寫到第一個空格子，不蓋任何東西** |
| `load(slotId)` | 目前這局會被整個換掉 |
| `newGame(mapConfig?)` | 目前這局會被整個丟掉。設定的形狀見下 |

**沒有 `delete`。** `AgentSession.test.ts` 有一條測試列舉了 `delete` / `deleteSave` /
`remove` / `removeSave` / `clear` / `destroy`，日後有人補上去會在那裡絆倒。

### 開新局的設定

**可以只給幾個欄位**，其餘補預設；完全不給就用遊戲自己的預設。

| 欄位 | 值 |
|------|-----|
| `seed` | 1 ~ 2147483646 的整數 |
| `waterAmount` | `low` / `medium` / `high` / `very_high` |
| `forestDensity` | `sparse` / `normal` / `dense` |
| `startingFunds` | `easy`（$75,000）/ `normal`（$50,000）/ `hard`（$25,000） |
| `disastersEnabled` | `true` / `false` |
| `disasterFrequency` | `low` / `medium` / `high` |

```bash
curl -X POST localhost:5173/agent \
  -d '{"path":"session.newGame","args":[{"waterAmount":"very_high","disastersEnabled":false}]}'
```

**沒有地圖大小這個選項。** 不認得的欄位會被擋下來，而且錯誤訊息會把六個合法欄位
全列出來 —— 呼叫端是程式，它只能從訊息裡學會下一次該怎麼寫。

不合法的設定**擋在動手之前**：地形產生器不驗，錯的值會讓開局炸在一半然後退回
主選單 —— 連帶把正在玩的那一局也賠進去。

### 「沒有 error」不等於「開起來了」

`newGame()` 與 `load()` 等完之後會**再確認一次遊戲真的開起來了**。

遊戲啟動失敗時走的是「退回主選單」，**不是丟例外**（`startGameGuarded` 會吞掉）。
所以沒有這道確認的話，玩家看到載入畫面閃一下跳回主選單，而 API 回報成功：

```json
{ "ok": false, "reason": "the game did not start — the game is back on the menu screen" }
```

### `load()` 與 `newGame()` 會把整個 `Game` 換掉

那兩件事住在 `main.ts`（`new Game` 之後重建 UI）。`window.__game` 與 `window.__agent`
都會指向新的實例，**呼叫前抓在手上的參照全部作廢**：

```js
const a = window.__agent;
await a.session.load(1);
a.read.city();            // 讀的是舊的那一局
window.__agent.read.city(); // 這才是新的
```

在舊實例上打的補丁（例如把 `autoSaver.shouldSave` 換成 `() => false`）也**不會跟過去**，
而且沒有任何提示。

### 主選單也有

還沒開始遊戲時 `window.__agent` 只有 `session` 一塊（那時候還沒有 `Game`）—— 而
`list()` / `load()` / `newGame()` 正是那時候唯一有意義的事。`save()` 回
`{ ok: false, reason: 'Error: no game is running' }`（跟其他地方一樣不丟例外）。
開局之後 `startGame` 會換成完整的那一份。

---

## 相關

| 檔案 | 內容 |
|------|------|
| `src/agent/index.ts` | `createAgent()`，四種運具與各 host 的接線 |
| `src/agent/AgentApi.ts` | `act()`、動作記錄、拆除上限 |
| `src/agent/AgentRoutes.ts` | 路線的共通把關與 `ModeAdapter` |
| `src/agent/AgentBudget.ts` | 稅率與貸款 |
| `src/agent/AgentPolicy.ts` | 條例與特化 |
| `src/agent/AgentDistrict.ts` | 行政區 |
| `src/agent/AgentUi.ts` | 面板、圖層、鏡頭 |
| `src/agent/AgentRead.ts` | 讀取層 |
| `src/agent/AgentSession.ts` | 存檔與開局 |
| `src/agent/status.ts` | `status()` —— 玩家在看什麼 |
| `src/agent/mapConfig.ts` | 開新局設定的驗證與補齊 |
| `src/agent/registry.ts` | 面板、開局、畫面狀態的註冊橋 |
| `src/agent/bridge/dispatch.ts` | 把 `{"path":"read.city"}` 變成真的呼叫，以及路徑的把關 |
| `src/agent/bridge/client.ts` | 頁面端:收下呼叫、執行、回傳 |
| `plugins/agent-bridge.ts` | dev server 的 `POST /agent` |
