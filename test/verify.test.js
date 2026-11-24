"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, afterEach } = require("node:test");
const { collectGitVersion, sameCommit, verifyGitVersion } = require("../src/verify-git-commit-version");
const { createRepo, removeRepo } = require("./helpers");

describe("verify-git-commit-version", () => {
  const repos = [];
  afterEach(() => {
    while (repos.length > 0) removeRepo(repos.pop());
  });

  it("干净仓库的源码版本等于 HEAD", () => {
    const repo = createRepo("clean");
    repos.push(repo.cwd);
    const version = verifyGitVersion(repo.cwd, { env: { CI: "true" }, failOnDirty: "auto" });
    assert.strictEqual(version.commitId, repo.commitId);
    assert.strictEqual(version.sourceVersion, repo.commitId);
    assert.strictEqual(version.consistent, true);
    assert.strictEqual(version.dirty, false);
    assert.strictEqual(version.branch, "main");
    assert.strictEqual(version.ciCommitId, null);
  });

  it("CI 上的未提交文件会让校验失败", () => {
    const repo = createRepo("dirty-ci");
    repos.push(repo.cwd);
    fs.writeFileSync(path.join(repo.cwd, "missed.js"), "module.exports = 1;\n");
    assert.throws(
      () => verifyGitVersion(repo.cwd, { env: { CI: "true" } }),
      /未提交文件/
    );
    const collected = collectGitVersion(repo.cwd);
    assert.strictEqual(collected.sourceVersion, `${repo.commitId}-dirty`);
    assert.deepStrictEqual(collected.uncommittedFiles, ["missed.js"]);
  });

  it("本地默认允许未提交文件，并把版本标成 dirty", () => {
    const repo = createRepo("dirty-local");
    repos.push(repo.cwd);
    fs.writeFileSync(path.join(repo.cwd, "wip.js"), "module.exports = 1;\n");
    const version = verifyGitVersion(repo.cwd, { env: {}, failOnDirty: "auto" });
    assert.strictEqual(version.consistent, false);
    assert.strictEqual(version.sourceVersion, `${repo.commitId}-dirty`);
  });

  it("ignore 可以放过指定目录", () => {
    const repo = createRepo("ignore");
    repos.push(repo.cwd);
    fs.mkdirSync(path.join(repo.cwd, "scratch"));
    fs.writeFileSync(path.join(repo.cwd, "scratch", "note.txt"), "temp\n");
    const version = verifyGitVersion(repo.cwd, {
      env: { CI: "true" },
      ignore: ["scratch"],
    });
    assert.strictEqual(version.consistent, true);
  });

  it("流水线声明的 commit 和 HEAD 不一致时失败", () => {
    const repo = createRepo("mismatch");
    repos.push(repo.cwd);
    assert.throws(
      () =>
        verifyGitVersion(repo.cwd, {
          env: {
            CI: "true",
            GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
          },
        }),
      /GITHUB_SHA/
    );
  });

  it("流水线给出的短 commit 与 HEAD 前缀相同则通过", () => {
    const repo = createRepo("prefix");
    repos.push(repo.cwd);
    const version = verifyGitVersion(repo.cwd, {
      env: { CI: "true", CI_COMMIT_SHA: repo.commitId.slice(0, 12) },
    });
    assert.strictEqual(version.consistent, true);
    assert.strictEqual(version.ciCommitId, repo.commitId.slice(0, 12));
  });

  it("非仓库目录会说明无法固定 commit", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "git-ver-not-repo-"));
    repos.push(cwd);
    assert.throws(() => collectGitVersion(cwd), /不是 Git 仓库/);
  });

  it("sameCommit 只接受足够长的十六进制前缀", () => {
    assert.strictEqual(sameCommit("abc1234ffff", "abc1234"), true);
    assert.strictEqual(sameCommit("abc1234ffff", "abc"), false);
    assert.strictEqual(sameCommit("abc1234ffff", "zzz1234"), false);
  });
});
