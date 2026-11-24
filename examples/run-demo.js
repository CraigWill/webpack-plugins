"use strict";

/**
 * 演示真实分支习惯：
 * - 功能分支派生自 master
 * - 合并到 develop 做开发测试
 * - 发布走 release；完成发布后再合并到 master
 * - develop 不与 master 互相合并
 *
 * 报告重点：在 release 上构建时，相对 master 的提交/文件差异
 *（不要只看本地相同的 commit id）。
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const webpack = require("webpack");
const GitCommitVersionPlugin = require("../src");

const root = path.join(__dirname, "..", ".tmp", "demo-frontend");

function git(args) {
  execFileSync("git", args, {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Demo",
      GIT_AUTHOR_EMAIL: "demo@example.com",
      GIT_COMMITTER_NAME: "Demo",
      GIT_COMMITTER_EMAIL: "demo@example.com",
    },
    stdio: "pipe",
  });
}

function commit(message) {
  git(["add", "."]);
  git([
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Demo",
    "-c",
    "user.email=demo@example.com",
    "commit",
    "-m",
    message,
  ]);
}

function prepareRepo() {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "demo-frontend" }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(root, "src", "index.js"),
    `console.log("base on master", __GIT_SOURCE_VERSION__);\n`
  );

  // 1) master：已发布基线（release 完成后才会合入这里）
  git(["init", "-b", "master"]);
  commit("chore: master baseline");

  // 2) develop：从 master 拉出，仅开发测试，永不和 master 互合
  git(["branch", "develop"]);

  // 3) 功能分支派生自 master
  git(["checkout", "-b", "feature/payment-ui"]);
  fs.writeFileSync(
    path.join(root, "src", "index.js"),
    `console.log("payment ui", __GIT_SOURCE_VERSION__);\n`
  );
  fs.writeFileSync(path.join(root, "src", "payment.js"), `export const pay = () => "ok";\n`);
  commit("feat: add payment ui");

  // 4) 合入 develop 做联调（可带仅测试环境改动）
  git(["checkout", "develop"]);
  git(["merge", "--no-ff", "feature/payment-ui", "-m", "merge: feature/payment-ui into develop"]);
  fs.writeFileSync(
    path.join(root, "src", "debug-banner.js"),
    `export const banner = "develop-only";\n`
  );
  fs.writeFileSync(
    path.join(root, "src", "index.js"),
    `import { banner } from "./debug-banner";\nconsole.log(banner, __GIT_SOURCE_VERSION__);\n`
  );
  commit("test: develop-only debug banner");

  // 5) 发布分支 release：从 master 拉出，只带要上线的功能
  git(["checkout", "master"]);
  git(["checkout", "-b", "release"]);
  git(["merge", "--no-ff", "feature/payment-ui", "-m", "merge: feature/payment-ui into release"]);
  fs.writeFileSync(
    path.join(root, "src", "index.js"),
    `console.log("payment ui on release", __GIT_SOURCE_VERSION__);\n`
  );
  commit("release: prepare payment ui package");
}

function build() {
  return new Promise((resolve, reject) => {
    const shareDir = path.join(root, "share");
    const lastReportPath = path.join(shareDir, "last-notified-report.json");
    const compiler = webpack({
      mode: "production",
      context: root,
      entry: "./src/index.js",
      output: {
        path: path.join(root, "dist"),
        filename: "bundle.js",
        clean: true,
      },
      plugins: [
        new GitCommitVersionPlugin({
          compareRef: "master",
          releaseRef: "release",
          developRef: "develop",
          includeDevelopDiff: false,
          lastReportPath,
          reportPath: path.join(shareDir, "frontend-build-report.json"),
          textReportPath: path.join(shareDir, "frontend-build-report.md"),
          consoleNotify: true,
          message:
            "【演示】在 release 上构建。完成后会合入 master；请后端按相对 master 的差异核对本次前端 CI/CD 产物。",
        }),
      ],
    });

    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error) reject(error);
        else if (closeError) reject(closeError);
        else if (stats.hasErrors()) reject(new Error(stats.toString({ colors: false })));
        else resolve(stats);
      });
    });
  });
}

function printFile(label, filePath) {
  process.stdout.write(`\n---------- ${label} ----------\n`);
  const content = fs.readFileSync(filePath, "utf8");
  process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
  process.stdout.write(`文件位置：${filePath}\n`);
}

async function main() {
  process.stdout.write("1. 准备 master / develop / release 演示仓库...\n");
  prepareRepo();
  process.stdout.write("   当前分支：release（相对 master 应有本次要发布的差异）\n");

  process.stdout.write("2. 在 release 上执行 webpack，生成带差异对比的更新报告...\n\n");
  await build();

  printFile(
    "可读报告（release 相对 master）",
    path.join(root, "share", "frontend-build-report.md")
  );

  process.stdout.write(
    "\n演示完成。发布完成后把 release 合入 master；后端应看「相对 master 的差异」，而不是相同的 commit id。\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
