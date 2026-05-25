# Glassmorphism 客户端界面设计规范

> 适用范围：Web 客户端、桌面客户端、移动端 App、后台管理界面、工具型客户端界面。  
> 设计目标：在保证可读性、可用性和性能的前提下，使用玻璃拟态营造轻盈、通透、现代的界面质感。

---

## 1. 设计风格概述

Glassmorphism，通常称为玻璃拟态，是一种通过半透明背景、背景模糊、柔和边框、高光、阴影和渐变背景形成“磨砂玻璃”视觉效果的设计风格。

该风格适合用于：

- 登录页、欢迎页、仪表盘首页。
- 客户端控制台、设置页、数据概览页。
- 卡片式信息展示、弹窗、侧边栏、悬浮操作区。
- 需要体现科技感、现代感、轻量感的产品界面。

不建议大面积滥用在：

- 高密度表格页面。
- 长文本阅读页面。
- 强可访问性要求的业务操作页。
- 弱性能设备或低端移动端页面。

---

## 2. 核心设计原则

### 2.1 通透但不牺牲可读性

玻璃拟态的核心是“半透明 + 模糊”，但文字、图标和关键操作必须始终清晰。任何情况下，内容可读性优先于视觉效果。

要求：

- 文本与背景必须有足够对比度。
- 卡片透明度不宜过低。
- 背景图案不能干扰前景内容。
- 关键按钮、错误提示、状态标签不能过度透明。

### 2.2 层级清晰

通过透明度、模糊强度、阴影、边框和空间间距表达层级关系。

推荐层级：

1. 页面背景：渐变、光斑、抽象图形。
2. 主容器：较强玻璃质感，承载核心内容。
3. 卡片/模块：中等玻璃质感，展示分组信息。
4. 悬浮层/弹窗：更高透明遮罩、更强阴影、更高模糊。
5. 交互控件：按钮、输入框、选择器、标签等。

### 2.3 少即是多

玻璃拟态的视觉吸引力较强，应控制使用密度。

建议：

- 一个页面中只选择 1 到 2 个主要玻璃容器。
- 普通内容区域可使用轻微透明或纯色底。
- 高密度表格、表单、列表可采用“轻玻璃”或“实底卡片”。

### 2.4 视觉与性能平衡

背景模糊、阴影、透明叠加对渲染性能有影响，尤其在低端设备和移动端上更明显。

建议：

- 不在大量列表项中逐项使用强 blur。
- 滚动容器中避免过多 `backdrop-filter`。
- 移动端降低 blur 和阴影强度。
- 必要时提供低性能模式或降级样式。

---

## 3. 视觉关键词

| 关键词 | 说明 |
|---|---|
| 通透 | 半透明材质，背景隐约可见 |
| 柔和 | 低饱和渐变、柔和阴影、圆角边界 |
| 层次 | 通过透明度、模糊、边框、投影区分前后关系 |
| 轻盈 | 避免厚重色块和强边框 |
| 科技感 | 可配合蓝紫渐变、发光点、细线图标 |
| 高级感 | 控制颜色数量、留白充足、动效克制 |

---

## 4. 色彩系统

### 4.1 色彩使用原则

Glassmorphism 不依赖大量颜色，而依赖透明度、光影和背景层次。颜色应保持简洁。

建议使用：

- 1 个主色。
- 1 个辅助色。
- 1 个强调色。
- 1 套中性色。
- 1 套语义色。

避免：

- 多个高饱和颜色同时出现。
- 卡片背景颜色过重。
- 透明背景叠加后导致文字发灰。
- 渐变背景与前景按钮颜色冲突。

---

## 4.2 推荐色板：浅色主题

### 页面背景

| Token | 色值 | 用途 |
|---|---:|---|
| `--bg-base` | `#EEF3FF` | 页面基础背景 |
| `--bg-gradient-start` | `#EAF1FF` | 背景渐变起点 |
| `--bg-gradient-mid` | `#F8ECFF` | 背景渐变中段 |
| `--bg-gradient-end` | `#E8FFF7` | 背景渐变终点 |
| `--bg-orb-blue` | `rgba(80, 140, 255, 0.35)` | 蓝色背景光斑 |
| `--bg-orb-purple` | `rgba(170, 105, 255, 0.28)` | 紫色背景光斑 |
| `--bg-orb-cyan` | `rgba(70, 220, 210, 0.25)` | 青色背景光斑 |

### 玻璃材质

| Token | 色值 | 用途 |
|---|---:|---|
| `--glass-primary` | `rgba(255, 255, 255, 0.58)` | 主玻璃容器 |
| `--glass-secondary` | `rgba(255, 255, 255, 0.42)` | 次级玻璃卡片 |
| `--glass-subtle` | `rgba(255, 255, 255, 0.28)` | 轻玻璃背景 |
| `--glass-solid` | `rgba(255, 255, 255, 0.78)` | 高可读性区域 |
| `--glass-border` | `rgba(255, 255, 255, 0.62)` | 玻璃高光边框 |
| `--glass-border-soft` | `rgba(255, 255, 255, 0.36)` | 轻边框 |

### 文本颜色

| Token | 色值 | 用途 |
|---|---:|---|
| `--text-primary` | `#101828` | 一级文本 |
| `--text-secondary` | `#344054` | 二级文本 |
| `--text-tertiary` | `#667085` | 辅助文本 |
| `--text-placeholder` | `#98A2B3` | 占位文本 |
| `--text-inverse` | `#FFFFFF` | 深色背景反色文本 |

### 品牌色与语义色

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-primary` | `#4F7CFF` | 主按钮、选中态、重点链接 |
| `--color-primary-hover` | `#3E68E8` | 主色 hover |
| `--color-secondary` | `#8B5CF6` | 辅助强调 |
| `--color-accent` | `#20D6C7` | 高亮、图形点缀 |
| `--color-success` | `#16A34A` | 成功 |
| `--color-warning` | `#F59E0B` | 警告 |
| `--color-danger` | `#EF4444` | 错误/危险 |
| `--color-info` | `#0EA5E9` | 信息提示 |

---

## 4.3 推荐色板：深色主题

### 页面背景

| Token | 色值 | 用途 |
|---|---:|---|
| `--bg-base` | `#080B16` | 页面基础背景 |
| `--bg-gradient-start` | `#07111F` | 背景渐变起点 |
| `--bg-gradient-mid` | `#161124` | 背景渐变中段 |
| `--bg-gradient-end` | `#081A1A` | 背景渐变终点 |
| `--bg-orb-blue` | `rgba(61, 120, 255, 0.32)` | 蓝色背景光斑 |
| `--bg-orb-purple` | `rgba(145, 84, 255, 0.28)` | 紫色背景光斑 |
| `--bg-orb-cyan` | `rgba(32, 214, 199, 0.22)` | 青色背景光斑 |

### 玻璃材质

| Token | 色值 | 用途 |
|---|---:|---|
| `--glass-primary` | `rgba(18, 25, 43, 0.68)` | 主玻璃容器 |
| `--glass-secondary` | `rgba(18, 25, 43, 0.52)` | 次级玻璃卡片 |
| `--glass-subtle` | `rgba(18, 25, 43, 0.36)` | 轻玻璃背景 |
| `--glass-solid` | `rgba(18, 25, 43, 0.86)` | 高可读性区域 |
| `--glass-border` | `rgba(255, 255, 255, 0.18)` | 玻璃边框 |
| `--glass-border-soft` | `rgba(255, 255, 255, 0.10)` | 轻边框 |

### 文本颜色

| Token | 色值 | 用途 |
|---|---:|---|
| `--text-primary` | `#F8FAFC` | 一级文本 |
| `--text-secondary` | `#CBD5E1` | 二级文本 |
| `--text-tertiary` | `#94A3B8` | 辅助文本 |
| `--text-placeholder` | `#64748B` | 占位文本 |
| `--text-inverse` | `#0F172A` | 浅色背景反色文本 |

### 品牌色与语义色

| Token | 色值 | 用途 |
|---|---:|---|
| `--color-primary` | `#6D8DFF` | 主按钮、选中态 |
| `--color-primary-hover` | `#8AA2FF` | 主色 hover |
| `--color-secondary` | `#A78BFA` | 辅助强调 |
| `--color-accent` | `#2DD4BF` | 高亮、图形点缀 |
| `--color-success` | `#22C55E` | 成功 |
| `--color-warning` | `#FBBF24` | 警告 |
| `--color-danger` | `#F87171` | 错误/危险 |
| `--color-info` | `#38BDF8` | 信息提示 |

---

## 5. 背景设计

### 5.1 背景结构

推荐背景由三层组成：

1. 基础渐变背景。
2. 模糊光斑或抽象渐变形状。
3. 轻微纹理或网格线，按需使用。

### 5.2 背景渐变

推荐形式：

```css
background:
  radial-gradient(circle at 18% 20%, rgba(80, 140, 255, 0.35), transparent 32%),
  radial-gradient(circle at 82% 18%, rgba(170, 105, 255, 0.28), transparent 30%),
  radial-gradient(circle at 60% 78%, rgba(70, 220, 210, 0.25), transparent 34%),
  linear-gradient(135deg, #EAF1FF 0%, #F8ECFF 48%, #E8FFF7 100%);
```

深色主题：

```css
background:
  radial-gradient(circle at 18% 20%, rgba(61, 120, 255, 0.32), transparent 32%),
  radial-gradient(circle at 82% 18%, rgba(145, 84, 255, 0.28), transparent 30%),
  radial-gradient(circle at 60% 78%, rgba(32, 214, 199, 0.22), transparent 34%),
  linear-gradient(135deg, #07111F 0%, #161124 48%, #081A1A 100%);
```

### 5.3 背景使用要求

- 背景光斑不要与主要文字区域重叠过强。
- 背景颜色应低饱和，避免喧宾夺主。
- 登录页、欢迎页可以使用更强背景表现。
- 工作台、管理台应降低背景复杂度。
- 表格页和表单页背景应更简洁。

---

## 6. 玻璃材质规范

### 6.1 标准玻璃效果

```css
.glass-panel {
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.62);
  box-shadow: 0 24px 80px rgba(31, 38, 135, 0.16);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-radius: 24px;
}
```

### 6.2 玻璃层级

| 层级 | 场景 | 背景透明度 | Blur | 阴影 | 圆角 |
|---|---|---:|---:|---:|---:|
| Level 1 | 页面主容器 | 0.56 - 0.72 | 18 - 24px | 中 | 24 - 32px |
| Level 2 | 卡片/模块 | 0.36 - 0.56 | 12 - 18px | 轻中 | 16 - 24px |
| Level 3 | 输入框/小控件 | 0.20 - 0.40 | 8 - 12px | 轻 | 10 - 16px |
| Level 4 | 弹窗/抽屉 | 0.68 - 0.88 | 24 - 32px | 重 | 24 - 32px |
| Level 5 | Tooltip/浮层 | 0.78 - 0.92 | 16 - 24px | 中 | 10 - 14px |

### 6.3 边框规范

玻璃边框需要体现高光感，但不能像普通实线边框一样厚重。

推荐：

```css
border: 1px solid rgba(255, 255, 255, 0.48);
```

深色主题：

```css
border: 1px solid rgba(255, 255, 255, 0.14);
```

顶部高光可使用伪元素：

```css
.glass-panel::before {
  content: "";
  position: absolute;
  left: 16px;
  right: 16px;
  top: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.72),
    transparent
  );
}
```

### 6.4 阴影规范

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-xs` | `0 4px 12px rgba(15, 23, 42, 0.06)` | 小控件 |
| `--shadow-sm` | `0 8px 24px rgba(15, 23, 42, 0.08)` | 普通卡片 |
| `--shadow-md` | `0 16px 48px rgba(15, 23, 42, 0.12)` | 主卡片 |
| `--shadow-lg` | `0 24px 80px rgba(15, 23, 42, 0.18)` | 弹窗、悬浮层 |
| `--shadow-glow` | `0 0 32px rgba(79, 124, 255, 0.24)` | 强调态、聚焦态 |

使用要求：

- 阴影应柔和、扩散，不要使用硬阴影。
- 大面积玻璃容器阴影可偏蓝紫，增强通透感。
- 业务系统中不要大量使用发光阴影。

---

## 7. 排版系统

### 7.1 字体

中文推荐：

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Helvetica Neue",
  Arial,
  sans-serif;
```

数字和代码推荐：

```css
font-family:
  "SF Mono",
  "JetBrains Mono",
  "Cascadia Code",
  Consolas,
  monospace;
```

### 7.2 字号层级

| Token | 大小 | 行高 | 用途 |
|---|---:|---:|---|
| `--font-display` | 40px | 48px | 大标题、欢迎页 |
| `--font-h1` | 32px | 40px | 页面主标题 |
| `--font-h2` | 24px | 32px | 模块标题 |
| `--font-h3` | 20px | 28px | 卡片标题 |
| `--font-body-lg` | 16px | 24px | 重要正文 |
| `--font-body` | 14px | 22px | 默认正文 |
| `--font-caption` | 12px | 18px | 辅助说明、标签 |
| `--font-mini` | 11px | 16px | 极小辅助信息 |

### 7.3 字重

| Token | 字重 | 用途 |
|---|---:|---|
| `--font-regular` | 400 | 正文 |
| `--font-medium` | 500 | 按钮、标签、表头 |
| `--font-semibold` | 600 | 模块标题、重点信息 |
| `--font-bold` | 700 | 页面标题、关键数字 |

### 7.4 排版要求

- 标题与正文之间保持清晰层级，不只依赖颜色区分。
- 玻璃背景上的正文不宜低于 14px。
- 辅助文本不要使用过浅颜色，避免叠加透明背景后不可读。
- 关键数字可使用 24px 以上字号并加粗。
- 表格和表单页面以清晰为主，不追求过强装饰性。

---

## 8. 间距与圆角

### 8.1 间距 Token

采用 4px 基础栅格。

| Token | 值 | 用途 |
|---|---:|---|
| `--space-1` | 4px | 极小间距 |
| `--space-2` | 8px | 控件内部间距 |
| `--space-3` | 12px | 小组件间距 |
| `--space-4` | 16px | 默认间距 |
| `--space-5` | 20px | 卡片内部间距 |
| `--space-6` | 24px | 模块间距 |
| `--space-8` | 32px | 页面分区间距 |
| `--space-10` | 40px | 大区块间距 |
| `--space-12` | 48px | 首页大模块间距 |

### 8.2 圆角 Token

| Token | 值 | 用途 |
|---|---:|---|
| `--radius-xs` | 6px | 标签、小按钮 |
| `--radius-sm` | 10px | 输入框、选择器 |
| `--radius-md` | 14px | 普通按钮、小卡片 |
| `--radius-lg` | 20px | 卡片 |
| `--radius-xl` | 24px | 主容器 |
| `--radius-2xl` | 32px | 大弹窗、首页面板 |
| `--radius-full` | 999px | 胶囊按钮、头像 |

### 8.3 使用建议

- 玻璃容器圆角应偏大，体现柔和质感。
- 输入框、按钮圆角可略小于容器圆角。
- 同一页面最多使用 3 种圆角级别，避免混乱。
- 表格页不建议使用过大圆角，避免降低信息密度。

---

## 9. 布局系统

### 9.1 页面布局原则

- 使用充足留白体现轻盈感。
- 页面内容不应贴边，桌面端推荐左右 24px - 48px 外边距。
- 重要操作区应放在清晰稳定的位置，不建议过度悬浮。
- 内容密集场景中，玻璃效果应让位于信息清晰度。

### 9.2 桌面端布局

推荐结构：

```text
┌──────────────────────────────────────────────┐
│ Top Bar                                      │
├───────────────┬──────────────────────────────┤
│ Side Nav      │ Main Content                 │
│               │ ┌──────────────┐ ┌────────┐ │
│               │ │ Glass Card   │ │ Card   │ │
│               │ └──────────────┘ └────────┘ │
│               │ ┌──────────────────────────┐ │
│               │ │ Data / Form Area          │ │
│               │ └──────────────────────────┘ │
└───────────────┴──────────────────────────────┘
```

桌面端建议：

- 侧边栏宽度：240px - 280px。
- 顶部栏高度：56px - 72px。
- 主内容最大宽度：根据业务复杂度控制在 1180px - 1440px。
- 工作台类页面采用 12 栅格布局。
- 设置页、详情页可采用 2 栏布局。

### 9.3 移动端布局

移动端建议：

- 减少强 blur 和复杂背景。
- 卡片透明度提高，保证内容可读。
- 单列布局优先。
- 底部导航优先于复杂侧边栏。
- 避免多个悬浮玻璃层叠加。

推荐结构：

```text
┌────────────────────┐
│ Header             │
├────────────────────┤
│ Summary Card       │
├────────────────────┤
│ List / Form Card   │
├────────────────────┤
│ Bottom Navigation  │
└────────────────────┘
```

### 9.4 后台/管理台布局

后台管理界面中，玻璃拟态应作为轻量视觉增强，而不是主导所有区域。

建议：

- 导航栏、概览卡片、弹窗可使用玻璃效果。
- 表格区域使用高透明度或实底背景。
- 表单区域优先保证字段分组清晰。
- 批量操作按钮、危险操作按钮使用实色。

---

## 10. 组件设计规范

## 10.1 顶部导航 Top Bar

### 视觉

- 背景：中等透明玻璃。
- 高度：56px - 72px。
- 边框：底部 1px 轻边框。
- 模糊：12px - 20px。
- 阴影：轻阴影或无阴影。

### 内容

- 左侧：Logo、产品名称、页面标题。
- 中间：主导航或搜索框。
- 右侧：通知、帮助、主题切换、用户头像。

### 状态

- 滚动前：可更透明。
- 滚动后：提高背景不透明度，增强可读性。

---

## 10.2 侧边导航 Side Nav

### 视觉

- 背景：深色或浅色玻璃面板。
- 宽度：240px - 280px。
- 圆角：桌面端可使用 24px，贴边布局可取消外侧圆角。
- 选中态：主色轻背景 + 左侧高亮条或胶囊背景。

### 导航项

| 状态 | 样式 |
|---|---|
| 默认 | 透明背景，二级文本色 |
| Hover | 轻玻璃背景，文字变一级色 |
| Active | 主色半透明背景，文字主色或反色 |
| Disabled | 降低透明度，禁止点击 |

示例：

```css
.nav-item.active {
  background: rgba(79, 124, 255, 0.16);
  color: var(--color-primary);
  box-shadow: inset 0 0 0 1px rgba(79, 124, 255, 0.18);
}
```

---

## 10.3 卡片 Card

### 类型

| 类型 | 用途 | 样式 |
|---|---|---|
| 主卡片 | 页面核心区域 | 强玻璃、较大圆角、中阴影 |
| 信息卡片 | 数据概览 | 中玻璃、轻阴影 |
| 操作卡片 | 表单、设置 | 高透明度、较清晰背景 |
| 强调卡片 | 重要提示、营销内容 | 玻璃 + 渐变边框或光晕 |

### 卡片结构

```text
┌────────────────────────────┐
│ Header                     │
│ Title              Action  │
├────────────────────────────┤
│ Content                    │
│                            │
├────────────────────────────┤
│ Footer / Meta / Action     │
└────────────────────────────┘
```

### 卡片规范

- 内边距：20px - 32px。
- 圆角：16px - 24px。
- 标题区与内容区间距：12px - 20px。
- 多卡片并列时，保持统一高度或清晰对齐。
- 卡片背景透明度应根据内容密度调整。

---

## 10.4 按钮 Button

### 按钮类型

| 类型 | 用途 | 样式 |
|---|---|---|
| Primary | 主操作 | 主色实底或渐变实底 |
| Secondary | 次操作 | 玻璃背景 + 边框 |
| Ghost | 弱操作 | 透明背景，hover 时轻玻璃 |
| Danger | 危险操作 | 红色实底或红色描边 |
| Icon Button | 图标操作 | 圆形或小圆角玻璃背景 |

### 主按钮

主按钮不建议过度透明，应保持强可识别性。

```css
.button-primary {
  color: #FFFFFF;
  background: linear-gradient(135deg, #4F7CFF 0%, #8B5CF6 100%);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 12px 28px rgba(79, 124, 255, 0.28);
  border-radius: 14px;
}
```

### 次按钮

```css
.button-secondary {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(12px);
  border-radius: 14px;
}
```

### 尺寸

| 尺寸 | 高度 | 字号 | 内边距 |
|---|---:|---:|---:|
| Small | 32px | 12px | 12px |
| Medium | 40px | 14px | 16px |
| Large | 48px | 16px | 20px |

### 交互状态

| 状态 | 样式 |
|---|---|
| Hover | 亮度提升，阴影略增强 |
| Active | 缩放至 0.98 或背景加深 |
| Focus | 显示主色光环，不只依赖阴影 |
| Disabled | 降低透明度和饱和度，禁用阴影 |
| Loading | 显示加载图标，禁止重复点击 |

---

## 10.5 输入框 Input

### 视觉

- 背景：轻玻璃或高透明白色。
- 边框：弱边框。
- 聚焦：主色边框 + 外发光。
- 错误：红色边框 + 错误提示。

```css
.input {
  height: 40px;
  padding: 0 12px;
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(255, 255, 255, 0.50);
  border-radius: 12px;
  outline: none;
  backdrop-filter: blur(10px);
}

.input:focus {
  border-color: rgba(79, 124, 255, 0.72);
  box-shadow: 0 0 0 4px rgba(79, 124, 255, 0.16);
}
```

### 表单规范

- Label 必须清晰，不建议只使用 placeholder。
- 必填项使用星号或明确标识。
- 错误提示靠近字段下方。
- 表单分组使用卡片或分割线，不只依赖间距。

---

## 10.6 搜索框 Search

搜索框可作为玻璃拟态中的重点组件。

建议：

- 宽度：桌面端 280px - 420px。
- 高度：40px - 48px。
- 左侧搜索图标，右侧快捷键提示。
- 聚焦后提高背景不透明度。
- 搜索结果浮层使用更强玻璃材质。

---

## 10.7 标签 Tag / Badge

### 类型

| 类型 | 用途 | 样式 |
|---|---|---|
| Status | 状态标识 | 语义色轻背景 |
| Category | 分类 | 灰色或品牌色轻背景 |
| Count | 数量 | 胶囊形状 |
| Warning | 风险提醒 | 黄色/红色轻背景 |

示例：

```css
.badge-success {
  color: #16A34A;
  background: rgba(22, 163, 74, 0.12);
  border: 1px solid rgba(22, 163, 74, 0.20);
  border-radius: 999px;
}
```

---

## 10.8 表格 Table

表格是玻璃拟态中最容易影响可读性的组件，必须优先保证信息清晰。

### 推荐样式

- 表格外层可使用玻璃容器。
- 表格主体建议使用高透明度白色或深色实底。
- 表头使用轻微玻璃或浅色背景。
- 行 hover 使用主色极浅背景。
- 边框使用弱分割线。

### 不建议

- 每一行都使用强玻璃效果。
- 透明背景直接叠加复杂渐变背景。
- 表头和内容缺少明确分隔。
- 表格中文字低于 12px。

### 表格规范

| 项目 | 建议 |
|---|---|
| 表头高度 | 40px - 48px |
| 行高 | 44px - 56px |
| 单元格左右间距 | 12px - 16px |
| 分割线 | `rgba(148, 163, 184, 0.18)` |
| 选中行 | 主色 8% - 12% 透明背景 |

---

## 10.9 弹窗 Modal

### 视觉

- 弹窗使用高层级玻璃材质。
- 背景遮罩使用半透明暗色。
- 弹窗阴影更强，突出层级。
- 内容区域背景不应过低透明，避免被遮罩和背景干扰。

```css
.modal {
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.62);
  box-shadow: 0 32px 96px rgba(15, 23, 42, 0.24);
  backdrop-filter: blur(28px) saturate(160%);
  border-radius: 28px;
}

.modal-mask {
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(8px);
}
```

### 行为

- 弹窗出现：淡入 + 轻微上浮。
- 弹窗关闭：淡出 + 轻微缩小。
- 危险操作弹窗应使用更明确的红色标识。
- 表单弹窗中按钮区域固定在底部。

---

## 10.10 抽屉 Drawer

适合设置、详情、筛选等场景。

建议：

- 宽度：桌面端 360px - 520px。
- 背景：高不透明玻璃。
- 边框：靠内容侧加 1px 轻边框。
- 动效：从右侧或底部滑入。
- 内容多时内部滚动，头部和底部操作区固定。

---

## 10.11 Toast / Message

Toast 应轻量、短暂、清晰。

建议：

- 使用半透明深色或浅色玻璃背景。
- 配合语义色图标。
- 不使用过强阴影。
- 一次最多展示 3 条。

---

## 10.12 Tooltip

建议：

- 深色玻璃背景优先，保证文字清晰。
- 文字不超过两行。
- 延迟 200ms - 400ms 出现。
- 不承载复杂交互。

---

## 10.13 图标 Icon

### 风格

- 推荐线性图标或轻量双色图标。
- 线宽：1.5px - 2px。
- 圆角端点优先。
- 避免过于复杂、厚重的填充图标。

### 尺寸

| 场景 | 尺寸 |
|---|---:|
| 导航图标 | 18px - 22px |
| 按钮图标 | 16px - 20px |
| 空状态图标 | 48px - 96px |
| 数据卡片图标 | 28px - 40px |

---

## 10.14 空状态 Empty State

空状态可以适度使用玻璃拟态增强亲和力。

组成：

- 轻量插画或图标。
- 简短标题。
- 一句说明。
- 一个明确操作按钮。

示例文案：

```text
暂无数据
当前条件下未查询到结果，可调整筛选条件后重试。
```

---

## 10.15 加载状态 Loading

推荐方式：

- 页面级加载：居中 loading + 半透明遮罩。
- 卡片级加载：Skeleton 骨架屏。
- 按钮级加载：按钮内部 spinner。
- 长任务：显示进度、状态和可取消操作。

Skeleton 样式：

```css
.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.20),
    rgba(255, 255, 255, 0.46),
    rgba(255, 255, 255, 0.20)
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: 10px;
}

@keyframes skeleton-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
```

---

## 11. 动效设计

### 11.1 动效原则

- 动效应服务于层级、反馈和状态变化。
- 不使用大幅度、长时间、反复吸引注意的动效。
- 业务系统中动效应克制。
- 对减少动态效果的用户提供降级。

### 11.2 时间规范

| 动效类型 | 时长 | 缓动 |
|---|---:|---|
| Hover | 120ms - 180ms | ease-out |
| 按钮点击 | 80ms - 120ms | ease-out |
| 弹窗进入 | 180ms - 240ms | cubic-bezier(0.16, 1, 0.3, 1) |
| 弹窗退出 | 120ms - 180ms | ease-in |
| 抽屉滑入 | 220ms - 300ms | cubic-bezier(0.16, 1, 0.3, 1) |
| 页面切换 | 240ms - 360ms | ease-in-out |
| Skeleton | 1200ms - 1600ms | ease-in-out |

### 11.3 典型动效

#### 卡片 Hover

```css
.card {
  transition:
    transform 160ms ease-out,
    box-shadow 160ms ease-out,
    border-color 160ms ease-out,
    background-color 160ms ease-out;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 56px rgba(15, 23, 42, 0.14);
  border-color: rgba(255, 255, 255, 0.72);
}
```

#### 按钮 Active

```css
.button:active {
  transform: scale(0.98);
}
```

#### 弹窗进入

```css
@keyframes modal-enter {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

### 11.4 减少动态效果

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 12. 交互状态

所有可交互元素必须具备以下状态：

| 状态 | 必须体现 |
|---|---|
| Default | 默认可识别 |
| Hover | 鼠标悬停反馈 |
| Active | 点击反馈 |
| Focus | 键盘聚焦反馈 |
| Disabled | 禁用状态 |
| Loading | 加载中状态 |
| Error | 错误状态 |
| Success | 成功状态 |

### Focus 规范

Focus 状态不能只依赖颜色变化，建议使用外轮廓或光环。

```css
:focus-visible {
  outline: 2px solid rgba(79, 124, 255, 0.88);
  outline-offset: 2px;
}
```

---

## 13. 可访问性规范

### 13.1 可读性

- 一级文本必须与背景形成明确对比。
- 玻璃背景上不使用过浅灰色正文。
- 小字号文本需要提高不透明度。
- 背景复杂时，应提高容器背景透明度或加遮罩。

### 13.2 键盘可用性

- 所有按钮、链接、表单控件必须可通过键盘访问。
- Focus 状态必须清晰。
- 弹窗打开后焦点应进入弹窗内部。
- 弹窗关闭后焦点应回到触发元素。

### 13.3 色彩无障碍

- 状态不能只通过颜色表达，需配合文字、图标或形状。
- 错误状态使用红色 + 错误文案。
- 成功状态使用绿色 + 成功文案或图标。
- 警告状态使用黄色/橙色 + 警告文案。

### 13.4 动效无障碍

- 尊重 `prefers-reduced-motion`。
- 不使用频繁闪烁效果。
- 动画不应阻塞用户操作。

---

## 14. 响应式规范

### 14.1 断点

| Token | 宽度 | 说明 |
|---|---:|---|
| `--breakpoint-xs` | 360px | 小屏手机 |
| `--breakpoint-sm` | 576px | 手机 |
| `--breakpoint-md` | 768px | 平板 |
| `--breakpoint-lg` | 1024px | 小桌面 |
| `--breakpoint-xl` | 1280px | 桌面 |
| `--breakpoint-2xl` | 1440px | 大桌面 |

### 14.2 响应式策略

| 场景 | 桌面端 | 移动端 |
|---|---|---|
| 导航 | 侧边栏 + 顶栏 | 顶栏 + 底部导航 |
| 卡片 | 多列网格 | 单列堆叠 |
| 表格 | 完整表格 | 卡片列表或横向滚动 |
| 弹窗 | 居中 Modal | 底部 Sheet 或全屏页 |
| Blur | 16 - 28px | 8 - 16px |
| 阴影 | 可中等偏强 | 降低强度 |

---

## 15. 页面模板

## 15.1 登录页

### 风格

登录页适合完整使用玻璃拟态。

结构：

```text
背景渐变 + 光斑
┌──────────────────────────┐
│ Logo                     │
│ 欢迎语                   │
│ 账号输入框               │
│ 密码输入框               │
│ 登录按钮                 │
│ 辅助链接                 │
└──────────────────────────┘
```

建议：

- 登录卡片宽度：360px - 440px。
- 背景可以更具视觉表现力。
- 表单区域保持高可读性。
- 登录按钮使用实色或渐变实色。

---

## 15.2 工作台 Dashboard

结构：

```text
Top Bar
Side Nav
Main Content
  - 欢迎区 / 总览区
  - 指标卡片
  - 趋势图表
  - 待办列表
  - 最近操作
```

建议：

- 总览卡片使用玻璃效果。
- 图表区域使用高透明度背景。
- 数据数字突出，辅助文字弱化。
- 避免背景光斑干扰图表。

---

## 15.3 列表页

建议：

- 筛选区可使用轻玻璃容器。
- 表格主体使用高透明度或实底卡片。
- 批量操作栏使用固定位置或表格上方区域。
- 分页区域保持清晰。

---

## 15.4 详情页

建议：

- 顶部概要卡片使用玻璃效果。
- 详情内容分组使用普通卡片。
- 操作区固定在右上角或底部。
- 状态、风险、告警信息必须明确。

---

## 15.5 设置页

建议：

- 左侧设置导航，右侧内容区。
- 表单卡片背景透明度较高，保证可读。
- 保存、取消按钮固定在底部或卡片尾部。
- 危险操作单独分区，不能与普通设置混在一起。

---

## 16. 图表与数据可视化

### 16.1 图表容器

- 图表外层可使用玻璃卡片。
- 图表绘图区背景尽量干净。
- 坐标轴、网格线使用低透明中性色。
- Tooltip 使用玻璃浮层，但内容背景需要足够不透明。

### 16.2 图表配色

推荐顺序：

1. 主色蓝：`#4F7CFF`
2. 紫色：`#8B5CF6`
3. 青色：`#20D6C7`
4. 绿色：`#16A34A`
5. 橙色：`#F59E0B`
6. 红色：`#EF4444`

### 16.3 数据卡片

数据卡片结构：

```text
┌───────────────────────┐
│ 指标名称        图标  │
│ 12,840                │
│ 环比 +12.5%           │
└───────────────────────┘
```

要求：

- 数字使用大字号和中重字重。
- 趋势信息使用语义色。
- 不只依赖颜色表达升降，应配合箭头或文字。

---

## 17. 图像与插画

### 17.1 风格

推荐：

- 抽象渐变插画。
- 轻量 3D 图形。
- 线性科技图形。
- 柔和光斑和粒子。

不推荐：

- 过度写实的复杂背景图。
- 高对比度照片直接作为背景。
- 过多饱和色插画。
- 与玻璃材质冲突的厚重阴影插画。

### 17.2 图片作为背景

如果使用图片背景，必须加遮罩：

```css
background:
  linear-gradient(rgba(8, 11, 22, 0.42), rgba(8, 11, 22, 0.42)),
  url("background.jpg") center / cover no-repeat;
```

要求：

- 文字区域必须有额外玻璃容器或遮罩。
- 图片对比度不能过强。
- 避免图片主体与前景内容重叠。

---

## 18. 设计 Token 汇总

```css
:root {
  /* Color */
  --color-primary: #4F7CFF;
  --color-primary-hover: #3E68E8;
  --color-secondary: #8B5CF6;
  --color-accent: #20D6C7;
  --color-success: #16A34A;
  --color-warning: #F59E0B;
  --color-danger: #EF4444;
  --color-info: #0EA5E9;

  /* Text */
  --text-primary: #101828;
  --text-secondary: #344054;
  --text-tertiary: #667085;
  --text-placeholder: #98A2B3;
  --text-inverse: #FFFFFF;

  /* Glass */
  --glass-primary: rgba(255, 255, 255, 0.58);
  --glass-secondary: rgba(255, 255, 255, 0.42);
  --glass-subtle: rgba(255, 255, 255, 0.28);
  --glass-solid: rgba(255, 255, 255, 0.78);
  --glass-border: rgba(255, 255, 255, 0.62);
  --glass-border-soft: rgba(255, 255, 255, 0.36);

  /* Radius */
  --radius-xs: 6px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 24px;
  --radius-2xl: 32px;
  --radius-full: 999px;

  /* Shadow */
  --shadow-xs: 0 4px 12px rgba(15, 23, 42, 0.06);
  --shadow-sm: 0 8px 24px rgba(15, 23, 42, 0.08);
  --shadow-md: 0 16px 48px rgba(15, 23, 42, 0.12);
  --shadow-lg: 0 24px 80px rgba(15, 23, 42, 0.18);
  --shadow-glow: 0 0 32px rgba(79, 124, 255, 0.24);

  /* Blur */
  --blur-sm: 8px;
  --blur-md: 14px;
  --blur-lg: 20px;
  --blur-xl: 28px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Motion */
  --motion-fast: 120ms;
  --motion-normal: 180ms;
  --motion-slow: 260ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

深色主题 Token：

```css
[data-theme="dark"] {
  --color-primary: #6D8DFF;
  --color-primary-hover: #8AA2FF;
  --color-secondary: #A78BFA;
  --color-accent: #2DD4BF;

  --text-primary: #F8FAFC;
  --text-secondary: #CBD5E1;
  --text-tertiary: #94A3B8;
  --text-placeholder: #64748B;
  --text-inverse: #0F172A;

  --glass-primary: rgba(18, 25, 43, 0.68);
  --glass-secondary: rgba(18, 25, 43, 0.52);
  --glass-subtle: rgba(18, 25, 43, 0.36);
  --glass-solid: rgba(18, 25, 43, 0.86);
  --glass-border: rgba(255, 255, 255, 0.18);
  --glass-border-soft: rgba(255, 255, 255, 0.10);

  --shadow-xs: 0 4px 12px rgba(0, 0, 0, 0.18);
  --shadow-sm: 0 8px 24px rgba(0, 0, 0, 0.22);
  --shadow-md: 0 16px 48px rgba(0, 0, 0, 0.28);
  --shadow-lg: 0 24px 80px rgba(0, 0, 0, 0.36);
}
```

---

## 19. CSS 基础实现示例

### 19.1 页面背景

```css
.app-background {
  min-height: 100vh;
  color: var(--text-primary);
  background:
    radial-gradient(circle at 18% 20%, rgba(80, 140, 255, 0.35), transparent 32%),
    radial-gradient(circle at 82% 18%, rgba(170, 105, 255, 0.28), transparent 30%),
    radial-gradient(circle at 60% 78%, rgba(70, 220, 210, 0.25), transparent 34%),
    linear-gradient(135deg, #EAF1FF 0%, #F8ECFF 48%, #E8FFF7 100%);
  overflow-x: hidden;
}
```

### 19.2 玻璃容器

```css
.glass {
  position: relative;
  background: var(--glass-primary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(var(--blur-lg)) saturate(160%);
  -webkit-backdrop-filter: blur(var(--blur-lg)) saturate(160%);
}
```

### 19.3 轻玻璃卡片

```css
.glass-card {
  background: var(--glass-secondary);
  border: 1px solid var(--glass-border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(var(--blur-md)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--blur-md)) saturate(140%);
}
```

### 19.4 兼容降级

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass,
  .glass-card {
    background: rgba(255, 255, 255, 0.92);
  }

  [data-theme="dark"] .glass,
  [data-theme="dark"] .glass-card {
    background: rgba(18, 25, 43, 0.96);
  }
}
```

---

## 20. 性能建议

### 20.1 Blur 使用限制

建议：

- 单页强 blur 容器不超过 6 个。
- 长列表中避免每个列表项都使用 `backdrop-filter`。
- 滚动区域内的玻璃效果尽量固定层级，不随列表大量重复。
- 移动端 blur 建议不超过 16px。

### 20.2 阴影使用限制

- 大阴影只用于主容器、弹窗、抽屉。
- 普通列表项使用轻阴影或无阴影。
- Hover 阴影变化不要过大。

### 20.3 图片与背景

- 背景图优先使用压缩后的静态图片或 CSS 渐变。
- 避免复杂视频背景。
- 大图需要懒加载或预加载策略。

---

## 21. 设计检查清单

### 21.1 视觉检查

- [ ] 页面是否有清晰主次层级。
- [ ] 玻璃容器是否过多。
- [ ] 背景是否干扰正文内容。
- [ ] 文字在浅色和深色主题下是否都清晰。
- [ ] 主按钮是否足够突出。
- [ ] 危险操作是否足够明确。

### 21.2 交互检查

- [ ] 所有可点击元素是否有 hover/active/focus 状态。
- [ ] 表单错误提示是否清晰。
- [ ] 加载状态是否防止重复提交。
- [ ] 弹窗是否支持 Esc 关闭。
- [ ] 键盘焦点是否可见。

### 21.3 可访问性检查

- [ ] 文字与背景对比度是否足够。
- [ ] 状态是否不只依赖颜色表达。
- [ ] 是否支持减少动态效果。
- [ ] 弹窗焦点管理是否正确。
- [ ] 禁用态是否能被识别。

### 21.4 性能检查

- [ ] 是否避免在长列表中重复使用强 blur。
- [ ] 移动端是否降低 blur 和阴影。
- [ ] 背景图是否压缩。
- [ ] 页面滚动是否流畅。
- [ ] 是否提供 `backdrop-filter` 降级样式。

---

## 22. 常见错误与规避

| 错误 | 影响 | 规避方式 |
|---|---|---|
| 背景过于复杂 | 内容难读 | 降低背景饱和度，增加容器不透明度 |
| 卡片过度透明 | 信息不可读 | 提高透明度到 0.56 以上 |
| 大量使用 blur | 性能下降 | 只在核心容器使用 |
| 主按钮也做成透明 | 操作不突出 | 主按钮使用实色或渐变实底 |
| 所有元素都玻璃化 | 页面混乱 | 仅主容器、卡片、弹窗使用 |
| 表格透明度过低 | 数据难读 | 表格主体使用高透明或实底背景 |
| 动效过长 | 操作拖沓 | 控制在 120ms - 300ms |
| 深色模式边框过亮 | 界面廉价 | 降低边框透明度到 0.10 - 0.18 |

---

## 23. 推荐落地方式

### 23.1 设计阶段

1. 先确定主题：浅色、深色，或双主题。
2. 定义背景系统：渐变、光斑、纹理。
3. 定义玻璃材质层级：主容器、卡片、浮层。
4. 定义基础组件：按钮、输入框、卡片、导航、弹窗。
5. 定义业务组件：数据卡片、表格、筛选区、详情区。
6. 检查可读性和性能风险。

### 23.2 开发阶段

1. 使用 CSS 变量或设计 Token 管理颜色、圆角、阴影、模糊。
2. 封装统一的 Glass 容器组件。
3. 对 `backdrop-filter` 做兼容降级。
4. 为低端设备或移动端降低 blur。
5. 统一处理 focus、disabled、loading 状态。
6. 对常用页面建立模板，避免每页重复设计。

---

## 24. 推荐组件命名

| 组件 | 建议命名 |
|---|---|
| 玻璃容器 | `GlassPanel` |
| 玻璃卡片 | `GlassCard` |
| 玻璃按钮 | `GlassButton` |
| 玻璃输入框 | `GlassInput` |
| 背景光斑 | `GradientOrb` |
| 页面背景 | `GlassBackground` |
| 顶部导航 | `GlassTopBar` |
| 侧边栏 | `GlassSidebar` |
| 弹窗 | `GlassModal` |
| 抽屉 | `GlassDrawer` |

---

## 25. 简化版页面示例

```html
<div class="app-background">
  <aside class="glass sidebar">
    <div class="logo">Product</div>
    <nav>
      <a class="nav-item active">工作台</a>
      <a class="nav-item">任务</a>
      <a class="nav-item">设置</a>
    </nav>
  </aside>

  <main class="main-content">
    <section class="glass hero-panel">
      <h1>欢迎回来</h1>
      <p>这里是你的今日工作概览。</p>
      <button class="button-primary">开始处理</button>
    </section>

    <section class="card-grid">
      <div class="glass-card metric-card">
        <span>今日任务</span>
        <strong>128</strong>
      </div>
      <div class="glass-card metric-card">
        <span>完成率</span>
        <strong>86%</strong>
      </div>
    </section>
  </main>
</div>
```

---

## 26. 最终设计方向总结

Glassmorphism 风格的关键不是简单地把所有元素变透明，而是通过透明、模糊、光影、边框和空间层级建立一种“轻盈、通透、现代”的界面秩序。

落地时应坚持以下原则：

- 背景负责氛围，内容负责清晰。
- 玻璃效果服务层级，不替代信息结构。
- 主操作必须突出，不能被透明效果弱化。
- 表格、表单、长文本优先保证可读性。
- 动效要轻，性能要稳，可访问性不能缺失。

