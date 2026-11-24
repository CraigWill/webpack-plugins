# webpack-git-commit-version-plugin

每次 webpack 构建生成一份**前端包构建更新报告**，主动告知后端团队。

报告重点不是当前 `commit id`（同一提交拉下来后，本地执行结果都一样，无法做差异对比），而是：

- **相对 `master` 的新增提交 / 变更文件**（已发布基线对照）
- 可选：相对 `develop`、相对 `release`、相对上次通知的差异

分支约定：

- 功能分支派生自 `master`
- 合并到 `develop` 做开发测试
- **发布走 `release`**，完成发布后再合并到 `master`
- `develop` 不与 `master` 互相合并

因此发布构建应在 `release` 上跑前端 CI/CD；报告里的「相对 master」就是本次 release 相对已发布基线的变更。

## 本地看一次带差异的报告

推荐用旁边的独立测试仓库（不和本插件仓库混在一起）：

```bash
cd ../frontend-build-report-demo
npm install
npm run demo
```

报告在 `frontend-build-report-demo/share/frontend-build-report.md`。

本仓库内也可快速演示：

```bash
npm run example
```

两者都会在 **`release` 上构建**，并展示相对 `master` 的提交和文件列表。

## 打包

```bash
npm run pack:release
```

会生成：

`release/webpack-git-commit-version-plugin-1.0.0.tgz`

## 安装

从 npm（若已发布）：

```bash
npm install --save-dev webpack-git-commit-version-plugin
```

从本地压缩包：

```bash
npm install --save-dev /path/to/webpack-git-commit-version-plugin-1.0.0.tgz
```

或在业务仓库里：

```bash
npm install --save-dev ../webpack-plugins/release/webpack-git-commit-version-plugin-1.0.0.tgz
```

## 接入

```js
const GitCommitVersionPlugin = require("webpack-git-commit-version-plugin");

module.exports = {
  plugins: [
    new GitCommitVersionPlugin({
      compareRef: "master",   // 已发布基线
      releaseRef: "release",  // 发布分支；完成后合入 master
      developRef: "develop",  // 开发测试，不与 master 互合
      lastReportPath: "share/last-notified-report.json",
      webhook: process.env.FRONTEND_BUILD_NOTIFY_URL,
    }),
  ],
};
```

构建成功后默认产出：

- `frontend-build-report.json`
- `frontend-build-report.md`

Markdown 中会包含「相对 master 的差异」。请把这一段转给后端，而不是只发一个 hash。

## 怎么交给后端团队

| 方式 | 配置 | 说明 |
| --- | --- | --- |
| 构建产物 | 默认开启 | 报告随前端包一起产出 |
| 控制台 | `consoleNotify: true` | 可直接复制到群聊 |
| Webhook | `webhook` | POST 整份 JSON（含 `diff`） |
| 自定义 | `onNotify(report)` | 钉钉 / 飞书 / 邮件等 |
| 额外文件 | `reportPath` / `textReportPath` | 写到共享目录 |

发布约定：在 `release` 上跑完前端 CI/CD 后，后端应能看到带 **相对 master 差异** 的报告；发布完成后再把 `release` 合入 `master`。若没有报告，说明可能漏跑了前端打包。

## 命令行

```bash
npx verify-git-commit-version
npx verify-git-commit-version --json --out share/frontend-build-report.json
```

## 配置

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `compareRef` | `"master"` | 差异对比基线（已发布，release 完成后合入） |
| `releaseRef` | `"release"` | 发布分支名 |
| `developRef` | `"develop"` | 开发测试分支名 |
| `includeDevelopDiff` | `true` | 是否附带相对 develop 的差异 |
| `includeReleaseDiff` | `false` | 是否附带相对 release 的差异 |
| `lastReportPath` | `null` | 上次通知报告路径 |
| `filename` | `"frontend-build-report.json"` | 产物内 JSON；`false` 关闭 |
| `textFilename` | `"frontend-build-report.md"` | 产物内 Markdown；`false` 关闭 |
| `webhook` | `null` | 通知 URL 或配置对象 |
| `onNotify` | `null` | 自定义通知函数 |
| `consoleNotify` | `true` | 控制台打印报告 |
| `failOnDirty` | `false` | 未提交文件是否失败 |
| `defines` / `banner` | `true` | 注入常量 / 入口注释 |

```js
const version = __GIT_SOURCE_VERSION__;
```
