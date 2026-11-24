"use strict";

const { execFileSync } = require("child_process");

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : "";
    const detail = stderr || (error && error.message) || "未知错误";
    const err = new Error(`执行 git ${args.join(" ")} 失败：${detail}`);
    err.stderr = stderr;
    throw err;
  }
}

function resolveRef(cwd, ref) {
  const candidates = [ref, `origin/${ref}`, `refs/heads/${ref}`, `refs/remotes/origin/${ref}`];
  for (const candidate of candidates) {
    try {
      const commitId = git(cwd, ["rev-parse", "--verify", `${candidate}^{commit}`]);
      return {
        ref: candidate,
        requestedRef: ref,
        commitId,
        shortCommitId: git(cwd, ["rev-parse", "--short=12", commitId]),
      };
    } catch {
      // try next
    }
  }
  return null;
}

function parseCommitLines(output) {
  if (!output) return [];
  return output.split("\n").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    if (tab === -1) {
      return { commitId: line, shortCommitId: line.slice(0, 12), subject: "" };
    }
    const commitId = line.slice(0, tab);
    return {
      commitId,
      shortCommitId: commitId.slice(0, 12),
      subject: line.slice(tab + 1),
    };
  });
}

/**
 * 相对基线分支（默认 master，已发布）做差异对比。
 * 发布在 release 上进行，完成后才合入 master；develop 不与 master 互相合并。
 */
function collectBranchDiff(cwd, options = {}) {
  const compareRef = options.compareRef || "master";
  const head = options.head || "HEAD";
  const maxCommits = options.maxCommits || 50;
  const maxFiles = options.maxFiles || 100;
  const base = resolveRef(cwd, compareRef);

  if (!base) {
    return {
      available: false,
      compareRef,
      baseRef: null,
      baseCommitId: null,
      baseShortCommitId: null,
      aheadCount: 0,
      behindCount: 0,
      hasDiff: false,
      commits: [],
      changedFiles: [],
      note: `未找到对比基线分支 ${compareRef}。本地分支均派生自 master 时，请先创建或拉取 master。`,
    };
  }

  let aheadCount = 0;
  let behindCount = 0;
  try {
    const counts = git(cwd, ["rev-list", "--left-right", "--count", `${base.commitId}...${head}`]);
    const parts = counts.split(/\s+/);
    behindCount = Number(parts[0] || 0);
    aheadCount = Number(parts[1] || 0);
  } catch {
    aheadCount = 0;
    behindCount = 0;
  }

  const commits = parseCommitLines(
    git(cwd, ["log", `--max-count=${maxCommits}`, "--format=%H%x09%s", `${base.commitId}..${head}`])
  );

  let changedFiles = [];
  try {
    const output = git(cwd, ["diff", "--name-only", `${base.commitId}...${head}`]);
    changedFiles = output ? output.split("\n").filter(Boolean) : [];
  } catch {
    changedFiles = [];
  }

  const truncatedCommits = commits.length >= maxCommits;
  const truncatedFiles = changedFiles.length > maxFiles;
  const files = changedFiles.slice(0, maxFiles);
  const hasDiff = aheadCount > 0 || files.length > 0;

  return {
    available: true,
    compareRef,
    baseRef: base.ref,
    baseCommitId: base.commitId,
    baseShortCommitId: base.shortCommitId,
    aheadCount,
    behindCount,
    hasDiff,
    commits,
    changedFiles: files,
    truncatedCommits,
    truncatedFiles,
    note: hasDiff
      ? `当前构建相对 ${compareRef} 有 ${aheadCount} 个提交、${changedFiles.length} 个文件变化，供后端对照本次前端更新。`
      : `当前构建与 ${compareRef} 无提交差异。若发布仍需前端包，请确认是否已在 CI/CD 中重新打包。`,
  };
}

function collectLastReportDiff(cwd, currentCommitId, options = {}) {
  const lastReportPath = options.lastReportPath;
  if (!lastReportPath) {
    return null;
  }

  const fs = require("fs");
  let last;
  try {
    last = JSON.parse(fs.readFileSync(lastReportPath, "utf8"));
  } catch {
    return {
      available: false,
      lastReportPath,
      note: "尚未找到上次通知报告，本次作为新的对比起点。",
    };
  }

  const lastCommitId = last && last.commitId;
  if (!lastCommitId) {
    return {
      available: false,
      lastReportPath,
      note: "上次报告缺少 commitId，无法做通知前后对比。",
    };
  }

  if (lastCommitId === currentCommitId) {
    return {
      available: true,
      lastReportPath,
      lastCommitId,
      lastBuildTime: last.buildTime || null,
      unchanged: true,
      aheadCount: 0,
      commits: [],
      changedFiles: [],
      note: "当前 commit 与上次通知相同。仅凭 commit id 看不出差异，请结合相对 master 的变更列表判断。",
    };
  }

  let commits = [];
  let changedFiles = [];
  try {
    commits = parseCommitLines(
      git(cwd, ["log", "--max-count=50", "--format=%H%x09%s", `${lastCommitId}..${currentCommitId}`])
    );
    const output = git(cwd, ["diff", "--name-only", `${lastCommitId}...${currentCommitId}`]);
    changedFiles = output ? output.split("\n").filter(Boolean).slice(0, 100) : [];
  } catch (error) {
    return {
      available: false,
      lastReportPath,
      lastCommitId,
      lastBuildTime: last.buildTime || null,
      note: `无法对比上次通知：${error.message}`,
    };
  }

  return {
    available: true,
    lastReportPath,
    lastCommitId,
    lastBuildTime: last.buildTime || null,
    unchanged: false,
    aheadCount: commits.length,
    commits,
    changedFiles,
    note: `相对上次通知新增 ${commits.length} 个提交、${changedFiles.length} 个文件。`,
  };
}

module.exports = {
  collectBranchDiff,
  collectLastReportDiff,
  resolveRef,
};
