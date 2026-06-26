---
name: upload-aliyun-oss-zh
description: 当任务涉及发布组件包、打包发布后的上传、上传发布、上传当前项目 dist 到阿里云 OSS、调用 OSS presign、保存 H5 组件定义或校验组件线上地址时使用。输出和说明使用中文。
---

# 阿里云 OSS 文件上传 Skill

这个 Skill 用于把当前项目目录下的 `dist/` 所有文件上传到阿里云 OSS，并在上传成功后调用“新增组件”接口保存组件定义。

## 固定接口

### 1. App 测试登录

- 请求：`POST https://prism-stone-pre.byering.com/api/web/auth/login`
- 请求头：`Content-Type: application/json`、`Accept: application/json`
- 入参：

```json
{
  "phone": "登录手机号，必填",
  "password": "登录密码，必填"
}
```

- 登录账号：由用户提供，不能使用默认账号
- 登录密码：由用户提供，不能使用默认密码
- Token 位置：`entity.accessToken`
- 后续请求头：`Authorization: Bearer {accessToken}`

### 2. 新版固定前缀 OSS presign

- 请求：`GET https://prism-stone-pre.byering.com/api/bean/storage/oss/presign`
- 请求头：`Authorization: Bearer {accessToken}`、`Accept: application/json`
- 查询参数：

```json
{
  "fileName": "文件名，必填，例如 index.html、assets/app.js",
  "prefix": "固定 OSS 目录前缀，例如 h5/components/confirm-dialog/1.0.0",
  "expiresInSeconds": 600,
  "contentType": "文件 MIME，可选，例如 text/html"
}
```

- 返回字段使用 `entity.accessId`、`entity.policy`、`entity.signature`、`entity.host`、`entity.dir`、`entity.objectKey`、`entity.publicUrl`、`entity.contentType`。

### 3. 新增组件

- 请求：`POST https://prism-stone-pre.byering.com/api/admin/deliverable-h5-components/create`
- 请求头：`Authorization: Bearer {accessToken}`、`Content-Type: application/json`、`Accept: application/json`
- 请求体来自当前项目根目录下的 `src/manifest.json`
- 必填字段：`name`、`description`、`version`、`props`
- `name` 字段必须使用 `<中文场景或模板>_<中文组件名>_<english_component_code>`，例如 `会议总结_一句话看懂_meeting_minutes_summary`，不能只使用纯英文机器名。
- `source` 字段必须使用 OSS 上传成功后的入口文件公网地址，不能使用带签名参数的临时 URL。
- `props` 字段来自 `src/manifest.json`；如果某个 prop 的 `default` 是数组或对象，提交平台前必须转换为 JSON 字符串，避免平台保存为空字符串。
- 每个发布到平台的 prop 都必须显式提供 `default` 字段。缺失 `default` 时不要发布，因为平台可能保存为 `null`，导致远程渲染时组件收到 `null` 后报错。
- 平台发布用 `props` 只描述业务可配置输入，不应包含 React 运行控制或样式扩展字段，例如 `className`、`open`、`collapsed`、`onOpenChange`、`onCollapsedChange`、任意函数类型 `onXxx`。

## 适用场景

当用户要求：

- 上传阿里云 OSS 文件
- 上传当前项目的 `dist/`
- 调用 presign 后直传 OSS
- 发布静态构建产物到 OSS
- 发布组件包
- 打包发布后的上传
- 上传发布
- 上传成功后新增 H5 组件定义

## 执行规则

1. 默认只处理当前项目根目录的 `dist/`。
2. 必须遍历并上传 `dist/` 下所有普通文件，保持相对目录结构。
3. 每个文件都要单独调用 presign，`fileName` 使用该文件相对 `dist/` 的路径，例如 `index.html`、`assets/app.js`。
4. `prefix` 默认动态生成，格式固定为：`h5/components/{package.json 的 name}/{package.json 的 version}`。
5. 使用 presign 返回的 `host` 和表单字段执行阿里云 OSS POST 上传，并设置对象 ACL 为公网可读。
6. POST 表单必须包含 `key`、`OSSAccessKeyId`、`policy`、`Signature`、`success_action_status=200`、`Content-Type`、`x-oss-object-acl=public-read` 和文件内容。
7. 上传完成后取入口文件公网地址：优先 `index.html`，否则取第一个上传文件；如果 presign 返回的是带签名临时 URL，必须去掉 query/hash，只保存不带签名的公网地址。
8. 调用 `POST /admin/deliverable-h5-components/create` 新增组件，参数来自 `src/manifest.json`，其中 `source` 必须覆盖为第 7 步得到的 OSS 地址；发布前必须校验每个 prop 都有 `default`；`props[*].default` 如为数组或对象，必须在请求体中转换为 JSON 字符串，例如 `"default": "[{\"fitDimension\":\"AI 应用\"}]"`。
9. 全部完成后输出文件数量、总大小、入口文件地址、所有文件的 objectKey/publicUrl 和新增组件记录。

## 上传前检查

- 如果 `dist/` 不存在或为空，先停止并说明原因。
- 如果 `src/manifest.json` 不存在，先停止并说明原因。
- `src/manifest.json` 必须具备 `name`、`description`、`version`、`props` 字段。
- `src/manifest.json` 的 `name` 必须使用 `<中文场景或模板>_<中文组件名>_<english_component_code>`；`english_component_code` 只能包含小写英文、数字和下划线。
- `props` 必须是非空数组。
- `props` 中每一项必须有非缺失的 `default` 字段。允许 `default` 为 `""`、`false`、`0`、`[]` 或 `{}`，但不允许省略字段；数组或对象默认值提交平台前必须转换成 JSON 字符串。
- `props` 中不允许包含 React 运行控制字段或函数回调字段：`className`、`style`、`open`、`collapsed`、`onOpenChange`、`onCollapsedChange`、任何 `onXxx` 函数类型字段。此类字段可以存在于组件 TypeScript Props 中，但不应进入平台配置 manifest。
- 上传前检查文本文件中是否包含 `file://` 或本机绝对路径；发现后停止上传。
- 如果 HTML/CSS/JS 中出现 `/assets/...` 这类站点根路径，应提示用户它可能无法在子目录访问，但不强制阻止上传。
- 如果用户没有提供 `prefix`，必须读取当前项目根目录下的 `package.json`，并使用 `name`、`version` 生成：`h5/components/{name}/{version}`。
- 如果当前仓库根目录下有多个组件目录，应使用 `--project-root 组件目录` 指定要上传的组件；脚本会读取该目录下的 `package.json` 和 `dist/`。
- 如果 `package.json` 不存在，或缺少 `name` / `version`，先停止并说明原因，不要编造路径。
- `src/manifest.json` 中的 `version` 必须与 `package.json` 中的 `version` 一致。
- `src/manifest.json` 中的 `name` 是组件展示名称，可以与 `package.json` 的机器包名不同；如果 `manifest.json` 显式提供 `packageName`，则 `packageName` 必须与 `package.json` 的 `name` 一致。
- 上传前如果没有可用的 `COMPONENT_AUTH_TOKEN`，先读取本地已保存的登录账号和密码；如果本地没有，再提示用户输入登录账号和密码。
- 用户提供账号密码后，先登录获取 Bearer Token；登录成功后把账号和密码保存到本地，供后续相关操作直接使用。
- 本地凭据保存路径固定为 `~/.wucaishi-component-workflow/auth.json`，文件权限应限制为 `600`。
- 不要在 skill、脚本或命令示例中写入默认账号、默认密码或个人凭据。

## 推荐命令

在项目根目录执行：

```bash
node .agents/skills/component-package-workflow-zh/subskills/upload-aliyun-oss-zh/scripts/upload_dist_to_aliyun_oss.mjs \
  --phone "登录账号" \
  --password "登录密码"
```

如果本地已经保存过账号密码，后续可直接执行：

```bash
node .agents/skills/component-package-workflow-zh/subskills/upload-aliyun-oss-zh/scripts/upload_dist_to_aliyun_oss.mjs
```

在仓库根目录上传某个组件目录：

```bash
node .agents/skills/component-package-workflow-zh/subskills/upload-aliyun-oss-zh/scripts/upload_dist_to_aliyun_oss.mjs \
  --project-root ./confirm-dialog \
  --phone "登录账号" \
  --password "登录密码"
```

如果确实需要手动覆盖 prefix：

```bash
node .agents/skills/component-package-workflow-zh/subskills/upload-aliyun-oss-zh/scripts/upload_dist_to_aliyun_oss.mjs \
  --prefix "h5/components/confirm-dialog/1.0.0" \
  --phone "登录账号" \
  --password "登录密码"
```

## 输出要求

- 全程使用中文说明。
- 上传前说明登录账号、API 域名、dist 路径和 OSS prefix。
- 上传失败时打印 HTTP 状态码和响应体。
- 新增组件接口失败时打印 HTTP 状态码和响应体，不要宣称发布完成。
- 成功后返回 `index.html` 的公网访问地址；如果没有 `index.html`，返回第一个上传文件的公网访问地址，并返回新增组件记录。
