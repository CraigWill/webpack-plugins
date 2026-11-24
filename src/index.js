"use strict";

const fs = require("fs");
const path = require("path");
const { BannerPlugin, Compilation, DefinePlugin, sources } = require("webpack");
const { createBuildReport, formatReportText } = require("./build-report");
const { deliverReport, printConsoleNotice } = require("./notify");
const { collectGitVersion, verifyGitVersion } = require("./verify-git-commit-version");

const PLUGIN_NAME = "GitCommitVersionPlugin";

const DEFAULT_DEFINES = {
  __GIT_COMMIT_ID__: "commitId",
  __GIT_COMMIT_SHORT__: "shortCommitId",
  __GIT_BRANCH__: "branch",
  __GIT_SOURCE_VERSION__: "sourceVersion",
  "process.env.GIT_COMMIT_ID": "commitId",
  "process.env.GIT_SOURCE_VERSION": "sourceVersion",
};

class GitCommitVersionPlugin {
  constructor(options = {}) {
    this.options = {
      // 产物内的 JSON 报告，便于随前端包一起交付给后端团队
      filename: "frontend-build-report.json",
      // 产物内的可读文本报告，方便复制到群聊
      textFilename: "frontend-build-report.md",
      // 额外写出到磁盘的路径（仓库根目录、共享目录等）
      reportPath: null,
      textReportPath: null,
      // 主动通知：Webhook URL / 配置，或自定义 onNotify
      webhook: null,
      onNotify: null,
      consoleNotify: true,
      // 差异对比基线：相对 master（已发布）。发布在 release 上进行，完成后才合入 master
      compareRef: "master",
      releaseRef: "release",
      developRef: "develop",
      includeDevelopDiff: true,
      includeReleaseDiff: false,
      lastReportPath: null,
      // 可选：发现未提交文件时失败。默认 false，不阻挡报告生成
      failOnDirty: false,
      failOnCommitMismatch: false,
      banner: true,
      defines: true,
      ignore: [],
      ...options,
    };
    this.report = null;
  }

  get version() {
    return this.report;
  }

  apply(compiler) {
    const options = this.options;
    const cwd = options.context || compiler.options.context || process.cwd();
    const logger = compiler.getInfrastructureLogger(PLUGIN_NAME);
    const outputPath = compiler.options.output && compiler.options.output.path;

    const prepareReport = () => {
      if (options.failOnDirty || options.failOnCommitMismatch) {
        verifyGitVersion(cwd, options);
      }
      this.report = createBuildReport(cwd, options);
    };

    compiler.hooks.beforeCompile.tap(PLUGIN_NAME, prepareReport);

    if (options.defines) {
      const mapping = options.defines === true ? DEFAULT_DEFINES : options.defines;
      const definitions = {};
      for (const [identifier, field] of Object.entries(mapping)) {
        definitions[identifier] = DefinePlugin.runtimeValue(
          () => {
            const report = this.report || {};
            const value = report[field];
            return JSON.stringify(value == null ? "" : value);
          },
          {
            version: () => {
              const report = this.report;
              return report ? `${field}:${String(report[field])}` : "unset";
            },
          }
        );
      }
      new DefinePlugin(definitions).apply(compiler);
    }

    if (options.banner) {
      new BannerPlugin({
        banner: () =>
          `frontend-build: ${this.report ? this.report.sourceVersion : "unknown"} @ ${
            this.report ? this.report.buildTime : "unknown"
          }`,
        entryOnly: true,
      }).apply(compiler);
    }

    if (options.filename || options.textFilename) {
      compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: PLUGIN_NAME,
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
          },
          () => {
            if (!this.report) return;
            if (options.filename) {
              compilation.emitAsset(
                options.filename,
                new sources.RawSource(`${JSON.stringify(this.report, null, 2)}\n`)
              );
            }
            if (options.textFilename) {
              compilation.emitAsset(
                options.textFilename,
                new sources.RawSource(formatReportText(this.report))
              );
            }
          }
        );
      });
    }

    compiler.hooks.done.tapPromise(PLUGIN_NAME, async (stats) => {
      if (!this.report || stats.hasErrors()) return;

      const files = [];
      if (options.filename && outputPath) {
        files.push({ path: path.join(outputPath, options.filename), format: "json" });
      }
      if (options.textFilename && outputPath) {
        files.push({ path: path.join(outputPath, options.textFilename), format: "md" });
      }
      if (options.reportPath) {
        files.push({
          path: path.isAbsolute(options.reportPath)
            ? options.reportPath
            : path.join(cwd, options.reportPath),
          format: "json",
        });
      }
      if (options.textReportPath) {
        files.push({
          path: path.isAbsolute(options.textReportPath)
            ? options.textReportPath
            : path.join(cwd, options.textReportPath),
          format: "md",
        });
      }

      // 产物已由 emitAsset 写出；这里只补仓库外路径，并触发 Webhook / 回调
      const externalFiles = files.filter((file) => {
        if (!outputPath) return true;
        const rel = path.relative(outputPath, file.path);
        return rel.startsWith("..") || path.isAbsolute(rel);
      });

      try {
        const delivery = await deliverReport(this.report, {
          files: externalFiles,
          webhook: options.webhook,
          onNotify: options.onNotify,
        });

        const noticeFiles = [
          ...(options.filename && outputPath
            ? [path.join(outputPath, options.filename)]
            : []),
          ...(options.textFilename && outputPath
            ? [path.join(outputPath, options.textFilename)]
            : []),
          ...delivery.files,
        ];

        if (options.consoleNotify !== false) {
          printConsoleNotice(logger, this.report, { files: noticeFiles });
        }

        if (options.webhook) {
          logger.info("已通过 Webhook 主动通知后端团队本次前端构建更新");
        }
        if (typeof options.onNotify === "function") {
          logger.info("已执行自定义 onNotify，完成构建更新告知");
        }

        // 保存本次报告，下次构建可对比「相对上次通知」；避免大家本地都是同一 commit id 时无差异可看
        if (options.lastReportPath) {
          const lastPath = path.isAbsolute(options.lastReportPath)
            ? options.lastReportPath
            : path.join(cwd, options.lastReportPath);
          fs.mkdirSync(path.dirname(lastPath), { recursive: true });
          fs.writeFileSync(lastPath, `${JSON.stringify(this.report, null, 2)}\n`);
        }
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (options.failOnNotify === false) {
          logger.error(`构建更新报告通知失败：${message}`);
          return;
        }
        throw error;
      }
    });
  }
}

GitCommitVersionPlugin.collectGitVersion = collectGitVersion;
GitCommitVersionPlugin.createBuildReport = createBuildReport;
GitCommitVersionPlugin.formatReportText = formatReportText;
GitCommitVersionPlugin.verifyGitVersion = verifyGitVersion;

module.exports = GitCommitVersionPlugin;
