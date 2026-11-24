#!/usr/bin/env node
"use strict";

const path = require("path");
const { createBuildReport, formatReportText } = require("./build-report");
const { deliverReport, printConsoleNotice } = require("./notify");
const { verifyGitVersion } = require("./verify-git-commit-version");

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    failOnDirty: false,
    ignore: [],
    format: "text",
    out: null,
    webhook: null,
    compareRef: "master",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fail-on-dirty") {
      options.failOnDirty = true;
    } else if (arg === "--allow-dirty") {
      options.failOnDirty = false;
    } else if (arg === "--json") {
      options.format = "json";
    } else if (
      arg === "--cwd" ||
      arg === "--ignore" ||
      arg === "--out" ||
      arg === "--webhook" ||
      arg === "--compare-ref"
    ) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} 需要一个参数`);
      }
      if (arg === "--cwd") options.cwd = value;
      else if (arg === "--ignore") options.ignore.push(value);
      else if (arg === "--out") options.out = value;
      else if (arg === "--compare-ref") options.compareRef = value;
      else options.webhook = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`无法识别的参数：${arg}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    `用法：verify-git-commit-version [--cwd <目录>] [--compare-ref master] [--ignore <路径>] [--out <文件>] [--webhook <URL>] [--json] [--fail-on-dirty]

生成前端构建更新报告，重点输出相对 master 的提交/文件差异，供后端对照。
不要只看本地相同的 commit id。
`
  );
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  if (options.help) {
    printHelp();
    return;
  }

  try {
    if (options.failOnDirty) {
      verifyGitVersion(options.cwd, options);
    }
    const report = createBuildReport(options.cwd, options);
    const files = [];
    if (options.out) {
      const outPath = path.isAbsolute(options.out)
        ? options.out
        : path.join(options.cwd, options.out);
      files.push({
        path: outPath,
        format: options.format === "json" ? "json" : "md",
      });
    }

    await deliverReport(report, {
      files,
      webhook: options.webhook,
    });

    if (options.format === "json" && !options.out) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printConsoleNotice(null, report, {
        files: files.map((file) => file.path),
      });
    }

    if (report.dirty) {
      process.stderr.write(
        `提示：工作区有未提交文件，报告中的 sourceVersion 为 ${report.sourceVersion}。\n`
      );
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };
