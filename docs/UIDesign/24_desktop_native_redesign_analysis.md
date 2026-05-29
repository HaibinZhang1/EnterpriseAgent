# Enterprise Agent Hub 桌面客户端“去网页感”与原生化重构分析报告 (Revised)

> **文档编号**：`docs/UIDesign/24_desktop_native_redesign_analysis.md`
> **设计版本**：v1.3 (根据用户最新反馈修订)
> **适用范围**：Windows/Mac 桌面客户端（Electron + React）
> **目标**：彻底消除当前客户端浓厚的“B端管理后台网页感”，以最小的底层侵入代价，打造极致流畅、专业、沉浸的桌面级两栏式原生软件体验。

---

## 1. 核心设计原则与修正路线

根据用户的最新反馈，我们将重构方案调整为更加聚焦、高性价比的四条修正路线：

1. **两栏式极简布局（No Three-Column）**：
   * **保留两栏**：采用左侧导航栏 + 右侧列表栏的精简布局，无需常驻右侧详情栏（Inspector）。
   * **抽屉展示细节**：当需要查看扩展的 README、版本历史和详细变量配置时，继续保留并精化现有的 `ExtensionDetailDrawer`，使其从右侧优雅滑出，看完即收，保证右侧列表区域有足够的横向展示空间。
2. **顶栏无边框融合与按钮极简化（Frameless Header & Twin-Buttons）**：
   * **顶栏融合**：依然在 Electron 中配置无边框窗口（Frameless Window），顶栏设计为高度约 `48px` 的透明高透磨砂拖拽标题栏。
   * **保留切换按钮**：在顶栏的正中（或左侧）保留 `Agent`、`社区`、`本地` 三大主板块切换按钮。设计为 macOS 原生风格的**精致胶囊式分段切换器 (Segmented Tab Control)**。
   * **双按钮融合（右上角）**：右上角完全并入并精简。**只保留“通知 (Notification)”与“用户 (Account)”两个按钮**。原有的单独“设置 (Settings)”入口彻底融合进用户按钮的点击下拉菜单（Account Popover Menu）中。
3. **行内操作自适应抽屉（High & Low Frequency Buttons）**：
   * **默认高频**：卡片或行尾默认仅平铺展示 **1 个最高频的核心动作按钮**（如：Skill 技能上的 `启用范围`，MCP 上的 `连接检测`，Plugin 上的 `安装/更新`）。
   * **低频隐藏与 Hover 展开**：其余低频按钮（如 `详情`、`清理` 等）在默认状态下折叠收起在一个 `...` (更多) 动作区域中。当鼠标移入（Hover）该折叠区域时，自动无缝展开显示全部操作按钮，鼠标移出时自动缩回，彻底净化视觉噪音。
4. **技术侵入裁剪**：
   * 暂时**不做**“全局快捷键”、“原生通知系统”以及“系统安全凭证安全存储”。重构将 100% 聚焦于纯粹的前端 React/CSS 布局、顶栏融合以及高低频按钮展开动效。

---

## 2. 局部交互与视觉细化方案

### 2.1 顶栏（Title Bar）无边框及控件布局
重构后的顶部标题栏（高度 `48px`，背景为 `glass-primary` 中透磨砂，配有底部 `1px` 极细高光边框）的视觉结构如下：

```text
┌────────────────────────────────────────────────────────────────────────┐
│  ● ● ●  │        [  Agent  |  社区  |  本地  ]        │ 🔔 (3)   👤 Admin │ [无边框顶栏融合]
└─────────┴─────────────────────────────────────────────┴────────────────┘
           [居中：精致胶囊分段切换器 (Segmented Control)]      [右上角极简双按钮]
```

* **左侧控制**：系统原生的三色窗口控制按钮（Mac 上为红黄绿药丸键，Windows 上通过 Electron 渲染）。右侧紧邻侧边栏的顶端边界线。
* **中间导航**：`[ Agent | 社区 | 本地 ]` 页签，背景为高透深色微圆角胶囊状，选中态高亮，有细微的缩放位移微动效。
* **右上角双按钮**：
  * **通知按钮（🔔）**：点击滑出通知抽屉，带有红点气泡（Badge）。
  * **用户/账户按钮（👤 Admin）**：展示用户头像或首字母。**点击后唤起下拉联合账户菜单 Popover**。

#### 👤 联合账户/设置下拉菜单（Popover Menu）设计：
当点击右上角用户按钮时，在下方弹出一个高磨砂质感的精致气泡框，将零散的操作集中治理：
```text
┌────────────────────────┐
│ 👤 **测试系统管理员**   │
│ username: admin        │
├────────────────────────┤
│ ⚙️ 客户端设置...        │ --> [触发 model.modal === 'settings']
│ 🔑 修改密码...          │ --> [触发 model.modal === 'password']
├────────────────────────┤
│ 🚪 退出登录            │ --> [触发 actions.logout]
└────────────────────────┘
```

---

### 2.2 本地页面（D-14）两栏弹性布局
废除原本长网页滚动的模式，整个视口强制填充 Electron 窗口。

* **左侧侧边栏（Sidebar Wide: 220px）**：保留并调优 `saas-sidebar`。包含：
  * ⚡ `Skills 技能` (数字徽标: 65)
  * 🔌 `MCP 服务` (数字徽标: 0)
  * ⚙️ `插件 Plugins` (数字徽标: 0)
* **右侧主列表区（Flex: 1, height: 100vh, overflow: hidden）**：
  * 右侧为 Flex 垂直布局，上方为极简过滤栏（Status Filter Bar），下方为**主列表独立滚动容器**（`overflow-y: auto`）。
  * 取消繁重复杂的嵌套表格，将扩展项目改写为**紧凑精细的列表卡片（List Cards）**。

---

### 2.3 按钮显隐与 Hover 展开动态交互设计
每一行列表卡片（或精简表格行）右侧的操作区采用以下智能动态展开设计：

```text
默认状态 (极简，仅显示 1 个最高频核心按钮 + 收起标示)：
┌────────────────────────────────────────────────────────────────────────┐
│ 🌐 Wiki  v1.2.0                                   [ 启用范围 ]  [•••]  │
└────────────────────────────────────────────────────────────────────────┘
                                                    (高频核心)   (低频折叠)

当鼠标移入 [•••] 区域时 (自动无缝平滑展开全部操作)：
┌────────────────────────────────────────────────────────────────────────┐
│ 🌐 Wiki  v1.2.0                     [ 详情 ]  [ 清理 ]  [ 启用范围 ]  [•••]  │
└────────────────────────────────────────────────────────────────────────┘
                                      <---- 自动淡入平滑滑出 ---->
```

#### 💡 实现思路（CSS Flex + Width Transition）：
通过 CSS 的 `transition: max-width 0.25s ease, opacity 0.2s ease`，在 Hover 时实现无缝动画：
```css
/* 操作区容器 */
.action-group-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 默认折叠的低频按钮 */
.action-button-low-freq {
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  transition: max-width 250ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease;
}

/* 当鼠标 Hover 触发器或整行时展开 */
.action-group-wrapper:hover .action-button-low-freq,
.list-card-row:hover .action-button-low-freq-on-row-hover {
  max-width: 100px; /* 展开后的合理宽度 */
  opacity: 1;
}
```

---

## 3. 代码重构落地路径（Surgical Steps）

### 3.1 改造一：[App.tsx](file:///Users/zhb/Documents/MyProjects/EnterparseAgent/desktop/src/renderer/App.tsx)
* **修改 Shell 头部结构**：
  1. 将原有 `Shell` 中传递的右上角 `onSettings` 移除，将相关配置直接在 `Shell` 内部的 `AccountMenu` 联合 Popover 中处理。
  2. 隐藏原有的顶栏大标题和 muted 说明文案。将 `activeTab === 'local'` 下的标题区重构成两栏内的局部标题栏，保持视口高度紧凑。
  3. 保留并优化 `ExtensionDetailDrawer` 滑出机制。

### 3.2 改造二：[LocalExtensionsPage.tsx](file:///Users/zhb/Documents/MyProjects/EnterparseAgent/desktop/src/renderer/pages/LocalExtensionsPage.tsx)
* **重构表格为卡片列表**：
  1. 废除超大 `<table className="table">`。改用精简的 `div.list-card-container` 列表结构。
  2. 每一行卡片左侧为图标与名称、本地版本，中间为状态 StatusBadge。
  3. **右侧操作区**：
     * 为每一行实现智能按钮操作抽屉。
     * 根据当前 `activeTab` 渲染其高频核心按钮（例如：Skill 渲染 `启用范围`，MCP 渲染 `连接检测`，Plugin 渲染 `安装` 或 `更新`）。
     * 将 `详情`（点击触发 `onOpenDetail`）和 `清理`（点击触发 `onCleanup`）作为低频按钮隐藏在 `More (...)` 触发器中，配置 Hover 时平滑滑出的 CSS 动画。
  4. **局部滚动优化**：
     * 过滤栏 `filter-bar` 设置为固定，下方的卡片容器设置 `overflow-y: auto; flex: 1;`，确保高度严格限制，不触发全局窗口滚动。

### 3.3 改造三：[index.css](file:///Users/zhb/Documents/MyProjects/EnterparseAgent/desktop/src/renderer/styles/index.css)
* **注入动画与布局样式**：
  1. 添加 `.action-button-low-freq` 伸缩滑出的过渡动画类。
  2. 增加胶囊式分段切换器（Segmented Control）以及顶栏融合所需要的无边框拖拽（`-webkit-app-region: drag` 和 `no-drag`）相关的样式控制。

---

> [!NOTE]
> **落地执行建议**
> 本次修改完美契合“高性价比、高视觉感知、低底层破坏”的精细重构理念。一旦您对这份修订后的方案表示认同，我们将立刻在脑区建立任务清单，并在您的确认下以最严谨、优雅的代码手术对 `App.tsx` 和 `LocalExtensionsPage.tsx` 实施外科手术式改造！
