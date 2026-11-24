"use strict";

const { execFileSync } = require("child_process");

const CI_COMMIT_ENV_VARS = [
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "GIT_COMMIT",
  "BUILD_SOURCEVERSION",
  "CIRCLE_SHA1",
  "TRAVIS_COMMIT",
  "BITBUCKET_COMMIT",
  "CI_COMMIT",
];

const CI_FLAGS = [
  "GITLAB_CI",
  "GITHUB_ACTIONS",
  "JENKINS_URL",
  "BUILDKITE",
  "CIRCLECI",
  "TF_BUILD",
  "BITBUCKET_BUILD_NUMBER",
  "TEAMCITY_VERSION",
  "BUILD_ID",
];

function isCI(env) {
  const flag = env.CI;
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return CI_FLAGS.some((name) => Boolean(env[name]));
}

function git(cwd, args) {
  let stdout;
  try {
    stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("未找到 git 命令，无法核对构建源码对应的 commit id。");
    }
    const stderr = error && error.stderr ? String(error.stderr).trim() : "";
    if (/not a git repository/i.test(stderr)) {
      throw new Error(`目录 ${cwd} 不是 Git 仓库，无法把构建版本固定到 commit id。`);
    }
    if (/unknown revision or path not in the working tree/i.test(stderr) && args.includes("HEAD")) {
      throw new Error(`目录 ${cwd} 所在的 Git 仓库还没有任何提交，无法确定构建对应的 commit id。`);
    }
    const detail = stderr || (error && error.message) || "未知错误";
    throw new Error(`执行 git ${args.join(" ")} 失败：${detail}`);
  }
  return stdout.trim();
}

function parsePorcelain(output) {
  if (!output) return [];
  return output.split("\n").filter(Boolean).map((line) => {
    let file = line.slice(3);
    const arrow = file.lastIndexOf(" -> ");
    if (arrow !== -1) file = file.slice(arrow + 4);
    if (file.startsWith('"') && file.endsWith('"')) {
      file = file.slice(1, -1);
    }
    return file;
  });
}

function ignored(file, patterns) {
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(file);
    const normalized = String(pattern).replace(/\/$/, "");
    return file === normalized || file.startsWith(`${normalized}/`);
  });
}

function sameCommit(left, right) {
  const a = String(left).toLowerCase();
  const b = String(right).toLowerCase();
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return /^[0-9a-f]+$/.test(shorter) && shorter.length >= 7 && longer.startsWith(shorter);
}

function readCiCommitId(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) {
      return { name, value: value.trim() };
    }
  }
  return null;
}

function collectGitVersion(cwd, options = {}) {
  const ignore = options.ignore || [];
  const commitId = git(cwd, ["rev-parse", "HEAD"]);
  const shortCommitId = git(cwd, ["rev-parse", "--short=12", "HEAD"]);
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const files = parsePorcelain(
    git(cwd, ["status", "--porcelain=v1", "-uall", "--", "."])
  ).filter(
    (file) => !ignored(file, ignore)
  );
  let subject = null;
  try {
    subject = git(cwd, ["log", "-1", "--format=%s"]);
  } catch {
    subject = null;
  }
  const dirty = files.length > 0;
  return {
    commitId,
    shortCommitId,
    branch,
    dirty,
    uncommittedFiles: files,
    subject,
    sourceVersion: dirty ? `${commitId}-dirty` : commitId,
  };
}

function verifyGitVersion(cwd = process.cwd(), options = {}) {
  const env = options.env || process.env;
  const failOnDirty = options.failOnDirty == null ? "auto" : options.failOnDirty;
  const failOnCommitMismatch = options.failOnCommitMismatch !== false;
  const ciCommitEnvVars = options.ciCommitEnvVars || CI_COMMIT_ENV_VARS;
  const version = collectGitVersion(cwd, options);
  const ciCommit = readCiCommitId(env, ciCommitEnvVars);
  const shouldFailOnDirty = failOnDirty === "auto" ? isCI(env) : Boolean(failOnDirty);
  const problems = [];

  if (shouldFailOnDirty && version.dirty) {
    const preview = version.uncommittedFiles.slice(0, 20).map((file) => `- ${file}`);
    const more =
      version.uncommittedFiles.length > 20
        ? `\n- ...其余 ${version.uncommittedFiles.length - 20} 个文件`
        : "";
    problems.push(
      `工作区相对 HEAD（${version.shortCommitId}）仍有未提交文件。请先提交后再进入 CI/CD 打包，避免发布日漏掉本地改动。\n${preview.join("\n")}${more}`
    );
  }

  if (failOnCommitMismatch && ciCommit && !sameCommit(version.commitId, ciCommit.value)) {
    problems.push(
      `流水线记录的提交 ${ciCommit.name}=${ciCommit.value} 与当前检出的 HEAD ${version.commitId} 不一致。本次要编译的源码不是这次 CI 认定的提交。`
    );
  }

  if (problems.length > 0) {
    const error = new Error(problems.join("\n"));
    error.version = {
      ...version,
      ciCommitId: ciCommit ? ciCommit.value : null,
      consistent: false,
    };
    throw error;
  }

  return {
    ...version,
    ciCommitId: ciCommit ? ciCommit.value : null,
    consistent: version.sourceVersion === version.commitId,
  };
}

module.exports = {
  CI_COMMIT_ENV_VARS,
  collectGitVersion,
  isCI,
  readCiCommitId,
  sameCommit,
  verifyGitVersion,
};
