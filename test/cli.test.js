"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { describe, it, afterEach } = require("node:test");
const { createRepo, removeRepo } = require("./helpers");

const cli = path.join(__dirname, "..", "src", "cli.js");

function run(args, cwd, env) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

describe("verify-git-commit-version cli", () => {
  const repos = [];
  afterEach(() => {
    while (repos.length > 0) removeRepo(repos.pop());
  });

  it("打印可读的前端构建更新报告", () => {
    const repo = createRepo("cli-clean");
    repos.push(repo.cwd);
    const result = run([], repo.cwd, { CI: "true", GITHUB_SHA: repo.commitId });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /前端包构建更新报告/);
    assert.match(result.stdout, new RegExp(repo.commitId));
    assert.match(result.stdout, /请后端团队/);
  });

  it("--json 输出结构化报告", () => {
    const repo = createRepo("cli-json");
    repos.push(repo.cwd);
    const result = run(["--json"], repo.cwd, {});
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.type, "frontend-build-update");
    assert.strictEqual(report.commitId, repo.commitId);
    assert.strictEqual(report.sourceVersion, repo.commitId);
  });

  it("默认不因未提交文件失败，但报告会标明 dirty", () => {
    const repo = createRepo("cli-dirty");
    repos.push(repo.cwd);
    fs.writeFileSync(path.join(repo.cwd, "missed.js"), "module.exports = 1;\n");
    const result = run(["--json"], repo.cwd, {});
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.dirty, true);
    assert.strictEqual(report.sourceVersion, `${repo.commitId}-dirty`);
    assert.match(result.stderr, /未提交文件/);
  });

  it("--fail-on-dirty 在有未提交文件时退出 1", () => {
    const repo = createRepo("cli-fail-dirty");
    repos.push(repo.cwd);
    fs.writeFileSync(path.join(repo.cwd, "wip.js"), "module.exports = 1;\n");
    const result = run(["--fail-on-dirty"], repo.cwd, { CI: "true" });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /wip\.js/);
  });

  it("--out 写出报告文件", () => {
    const repo = createRepo("cli-out");
    repos.push(repo.cwd);
    const out = "share/frontend-build-report.json";
    const result = run(["--json", "--out", out], repo.cwd, {});
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(repo.cwd, out), "utf8"));
    assert.strictEqual(report.commitId, repo.commitId);
  });
});
