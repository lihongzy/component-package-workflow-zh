---
name: html-template-to-react-components-zh
description: 当父 skill `component-package-workflow-zh` 需要从移动端 HTML 预览、HTML 模板、模板说明 Markdown、场景模块表格中拆分独立 React 组件包，或需要把模板说明字段约束转成 Props、schema、manifest 时使用。输出和说明使用中文。
---

# HTML 模板拆 React 组件 Skill

这个子 Skill 用于把“一个包含多个模块的移动端 HTML 视觉预览”和“模板说明 Markdown”拆成多个可复用 React 组件包。它只处理拆分、映射和字段契约，后续组件创建、开发、预览、打包、上传仍服从父 Skill `component-package-workflow-zh`。

## 必须同时使用

- 组件代码实现必须继续使用 `react-component-spec-zh`。
- 如果进入打包或上传，继续使用 `build-version-confirm-zh` 和 `upload-aliyun-oss-zh`。

## 输入要求

默认需要两个文件：

- HTML 文件：包含多个移动端模块，通常以 `<section class="module" id="...">` 表示一个模块。
- 模板说明 Markdown：必须包含“场景模块”表格，且表头包含 `模块名称`、`场景模块名称`、`用户要解决的问题`、`结构规范`。

### 输入文件确认

当用户要求从 HTML 模板、HTML 预览、移动端 HTML、模板说明 Markdown、场景模块表格中拆分 React 组件时，不要直接运行解析脚本，也不要自行猜测文件路径。

执行解析前必须先用中文向用户确认：

- 本次要转换的 HTML 文件是哪一个？
- 本次要作为字段契约来源的 Markdown 模板说明文件是哪一个？

即使当前目录中只有一个明显的 HTML 文件和一个明显的 Markdown 文件，也仍然需要向用户确认文件名后再继续。

如果目录中存在多个 HTML 文件或多个 Markdown 文件，必须列出候选文件路径，让用户明确选择，不能按文件名相似度自行决定。

询问时必须明确说明：

- HTML 文件只作为视觉、布局、交互和示例数据参考。
- Markdown 文件才是字段契约来源，包括组件名称、组件描述、字段、约束、默认值等。
- 如果 HTML 和 Markdown 内容冲突，以 Markdown 为准；但视觉样式以 HTML 为准。

## 核心规则

- 字段契约只以模板说明 Markdown 为准，HTML 只作为视觉、布局、交互和示例数据参考。
- 生成组件的名称必须取模板说明表格中的 `场景模块名称`，不要自行改写。
- 生成组件的描述必须取模板说明表格中的 `用户要解决的问题`，不要自行概括。
- `package.json` 的包名和创建模板用的目录名是机器名，应与组件显示名称分开；可优先使用 HTML `id` 或让用户确认英文 kebab-case 名称。
- HTML 中出现但模板说明未声明的字段，不能自动加入 Props、`schema.ts` 或 `manifest.json`。
- 模板说明中声明的字段，即使 HTML 示例中没有展示，也要进入 Props、`schema.ts` 和 `manifest.json`。
- HTML 示例文案只能作为 demo data，不能替代字段约束。

## 样式还原要求

HTML 转 React 组件时，React 组件的计算样式必须尽量与原 HTML 对应模块一致，不能只根据 DOM 结构重写大概样式。

- 必须读取并分析 HTML 中与目标 section 相关的 CSS，包括 class 选择器、父级布局、CSS 变量、字体、颜色、间距、圆角、阴影、边框、背景、字号、行高、宽高、flex/grid 布局等。
- 必须同时考虑 `<style>` 内联样式块、元素上的 `style=""`、HTML 引用的本地 CSS 文件，以及与目标 section 有关的全局基础样式。
- 生成 React + `styled-components` 时，应把 HTML 的视觉 token 和布局规则迁移到组件样式中。
- 如果原 HTML 依赖全局样式、CSS 变量或 reset，需要把目标组件正常显示所需的最小样式一并迁移。
- 如果 HTML 引用远程 CSS 或缺失的 CSS 文件，应告知用户无法完整还原，并请求提供对应 CSS 文件或确认继续。
- 如果某些样式无法可靠迁移，必须在实现前说明不确定点，不能静默忽略。
- 本地 demo 中渲染出来的组件默认视觉效果应与 HTML 对应模块尽量一致。

## 推荐流程

1. 先确认输入文件，明确本次使用的 HTML 文件和 Markdown 模板说明文件；未确认前不要运行解析脚本。

2. 运行解析脚本生成模块契约：

```bash
node .agents/skills/component-package-workflow-zh/subskills/html-template-to-react-components-zh/scripts/analyze_template_pair.mjs \
  --html 移动端HTML预览.html \
  --template 模板说明.md \
  --out /tmp/template-contract.json
```

3. 先检查契约中的 `modules`，确认每个模块都正确映射：
   - `componentDisplayName` 等于 `场景模块名称`
   - `componentDescription` 等于 `用户要解决的问题`
   - `fields` 来自 `结构规范` 的顶层字段
   - `htmlId` 对应 HTML 中的模块 id

4. 对每个要生成的模块，按父 Skill 流程创建组件包模板；创建前仍需完成组件名称存在性校验。

5. 在模板基础上实现 React 组件：
   - 视觉结构参考对应模块的 `bodyHtml`、`classNames` 和原 HTML 样式。
   - 必须分析目标模块相关 CSS，并把必要的计算样式迁移到 `styled-components`。
   - Props、`schema.ts`、`manifest.json` 以契约中的 `fields` 和 `constraints` 为准。
   - 折叠、勾选、横滑等交互转成 React 状态，不把状态写死在 DOM 属性里。

6. 完成后运行契约校验脚本：

```bash
node .agents/skills/component-package-workflow-zh/subskills/html-template-to-react-components-zh/scripts/validate_component_contract.mjs \
  --contract /tmp/template-contract.json \
  --module 模块htmlId或场景模块名称 \
  --manifest 组件包/src/manifest.json \
  --schema 组件包/src/schema.json
```

如果项目的 `schema.ts` 不是 JSON，先人工对照契约检查，或导出一份等价 JSON 再运行脚本。

7. 生成组件后必须启动本地预览，对比原 HTML 目标模块与 React 本地 demo 的视觉表现；如发现明显差异，应优先修复样式差异，再进入打包或上传。

## 输出约定

向用户说明拆分结果时，使用以下字段：

| 输出项 | 来源 |
| --- | --- |
| 组件名称 | `场景模块名称` |
| 组件描述 | `用户要解决的问题` |
| 字段约束 | `结构规范` |
| 视觉参考 | HTML 对应 section |
| 包名建议 | HTML `id` 或用户确认的英文 kebab-case |

反馈给用户时还必须说明：

- 已使用的 HTML 文件路径
- 已使用的 Markdown 文件路径
- 目标模块对应的 HTML section id
- 本地预览是否已与 HTML 对应模块完成视觉对比

## 常见错误

- 不要把 `模块名称` 当成组件名称；组件名称必须用 `场景模块名称`。
- 不要把 HTML 里的预览摘要、示例表格列或补充文案当成新增字段。
- 不要因为 HTML 视觉一致而省略模板说明中的字段上限、枚举和固定标题。
- 不要让 `manifest.json` 的 `name` 和 `description` 脱离模板说明字段。
- 不要在用户确认 HTML 和 Markdown 文件前自行运行解析脚本。
- 不要忽略 HTML 中真实 CSS，只凭视觉印象重写近似样式。
