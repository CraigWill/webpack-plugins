"use strict";

const fs = require("fs");
const path = require("path");
const { collectBranchDiff, collectLastReportDiff } = require("./branch-diff");
const { collectGitVersion, isCI, readCiCommitId, CI_COMMIT_ENV_VARS } = require("./verify-git-commit-version");

function readPackageName(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

function createBuildReport(cwd = process.cwd(), options = {}) {
  const env = options.env || process.env;
  const version = collectGitVersion(cwd, options);
  const ciCommit = readCiCommitId(env, options.ciCommitEnvVars || CI_COMMIT_ENV_VARS);
  const packageName = options.packageName || readPackageName(cwd);
  const buildTime = new Date().toISOString();
  const consistent = version.sourceVersion === version.commitId;
  const compareRef = options.compareRef || "master";
  const developRef = options.developRef || "develop";
  const releaseRef = options.releaseRef || "release";
  const vsMaster = collectBranchDiff(cwd, {
    compareRef,
    maxCommits: options.maxCommits,
    maxFiles: options.maxFiles,
  });

  let vsDevelop = null;
  if (options.includeDevelopDiff !== false && version.branch !== developRef) {
    vsDevelop = collectBranchDiff(cwd, {
      compareRef: developRef,
      maxCommits: options.maxCommits,
      maxFiles: options.maxFiles,
    });
  }

  let vsRelease = null;
  if (options.includeReleaseDiff && version.branch !== releaseRef) {
    vsRelease = collectBranchDiff(cwd, {
      compareRef: releaseRef,
      maxCommits: options.maxCommits,
      maxFiles: options.maxFiles,
    });
  }

  const sinceLastNotify = collectLastReportDiff(cwd, version.commitId, {
    lastReportPath: options.lastReportPath || null,
  });

  return {
    type: "frontend-build-update",
    title: "前端包构建更新报告",
    message:
      options.message ||
      "前端包已完成构建。请后端团队根据相对 master（已发布基线）的提交/文件差异核对本次 release 更新，并确认发布流程已跑过对应的前端 CI/CD。",
    packageName,
    commitId: version.commitId,
    shortCommitId: version.shortCommitId,
    branch: version.branch,
    subject: version.subject,
    dirty: version.dirty,
    uncommittedFiles: version.uncommittedFiles,
    sourceVersion: version.sourceVersion,
    consistent,
    ci: isCI(env),
    ciCommitId: ciCommit ? ciCommit.value : null,
    buildTime,
    workflow: {
      featureFrom: "master",
      testBranch: developRef,
      releaseBranch: releaseRef,
      releasedBaseline: compareRef,
      note:
        "功能分支派生自 master；合并到 develop 做开发测试；发布走 release，完成发布后再合并到 master。develop 不与 master 互相合并。",
    },
    diff: {
      againstMaster: vsMaster,
      againstDevelop: vsDevelop,
      againstRelease: vsRelease,
      sinceLastNotify,
    },
  };
}

function formatCommitList(commits, truncated) {
  const lines = [];
  for (const item of commits) {
    lines.push(`- ${item.shortCommitId} ${item.subject}`);
  }
  if (truncated) {
    lines.push("- ...更多提交已截断");
  }
  return lines;
}

function formatDiffSection(title, diff) {
  if (!diff) return [];
  if (!diff.available) {
    return ["", `## ${title}`, "", diff.note || "暂无对比结果。", ""];
  }

  const lines = [
    "",
    `## ${title}`,
    "",
    diff.note,
    "",
    `- 基线：${diff.baseRef || diff.compareRef} (${diff.baseShortCommitId || diff.lastCommitId || "unknown"})`,
  ];

  if (typeof diff.aheadCount === "number") {
    lines.push(`- 领先提交数：${diff.aheadCount}`);
  }
  if (typeof diff.behindCount === "number") {
    lines.push(`- 落后提交数：${diff.behindCount}`);
  }
  if (diff.unchanged) {
    lines.push("- 相对上次通知：commit 未变");
  }

  if (diff.commits && diff.commits.length > 0) {
    lines.push("", "### 新增提交", "");
    lines.push(...formatCommitList(diff.commits, diff.truncatedCommits));
  }

  if (diff.changedFiles && diff.changedFiles.length > 0) {
    lines.push("", "### 变更文件", "");
    for (const file of diff.changedFiles) {
      lines.push(`- ${file}`);
    }
    if (diff.truncatedFiles) {
      lines.push("- ...更多文件已截断");
    }
  }

  lines.push("");
  return lines;
}

function formatReportText(report) {
  const lines = [
    `# ${report.title}`,
    "",
    report.message,
    "",
    `- 包名：${report.packageName || "(未命名)"}`,
    `- 源码版本：${report.sourceVersion}`,
    `- Commit：${report.commitId}`,
    `- 短 Commit：${report.shortCommitId}`,
    `- 分支：${report.branch}`,
    `- 最近提交：${report.subject || "(无)"}`,
    `- 构建时间：${report.buildTime}`,
    `- 工作区干净：${report.consistent ? "是" : "否"}`,
    `- CI 构建：${report.ci ? "是" : "否"}`,
  ];
  if (report.ciCommitId) {
    lines.push(`- 流水线 Commit：${report.ciCommitId}`);
  }
  if (report.workflow) {
    lines.push("", "## 分支约定", "", report.workflow.note, "");
  }
  if (report.dirty && report.uncommittedFiles.length > 0) {
    lines.push("## 未提交文件", "");
    for (const file of report.uncommittedFiles.slice(0, 50)) {
      lines.push(`- ${file}`);
    }
    if (report.uncommittedFiles.length > 50) {
      lines.push(`- ...其余 ${report.uncommittedFiles.length - 50} 个文件`);
    }
    lines.push("");
  }

  const diff = report.diff || {};
  lines.push(
    ...formatDiffSection(
      `相对 ${diff.againstMaster ? diff.againstMaster.compareRef : "master"} 的差异（已发布基线对照）`,
      diff.againstMaster
    )
  );
  if (diff.againstRelease) {
    lines.push(
      ...formatDiffSection(
        `相对 ${diff.againstRelease.compareRef} 的差异（当前发布分支对照）`,
        diff.againstRelease
      )
    );
  }
  if (diff.againstDevelop) {
    lines.push(
      ...formatDiffSection(
        `相对 ${diff.againstDevelop.compareRef} 的差异（测试分支对照）`,
        diff.againstDevelop
      )
    );
  }
  if (diff.sinceLastNotify) {
    lines.push(...formatDiffSection("相对上次通知的差异", diff.sinceLastNotify));
  }

  if (!lines[lines.length - 1]) {
    // already ends with blank
  } else {
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "\n")}`;
}

module.exports = {
  createBuildReport,
  formatReportText,
  readPackageName,
};
