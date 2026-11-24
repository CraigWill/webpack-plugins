"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { describe, it, afterEach } = require("node:test");
const { createBuildReport, formatReportText } = require("../src/build-report");
const { createRepo, git, removeRepo } = require("./helpers");

describe("branch diff in build report", () => {
  const repos = [];
  afterEach(() => {
    while (repos.length > 0) removeRepo(repos.pop());
  });

  it("相对 master 列出 develop 上的新增提交和文件", () => {
    const repo = createRepo("diff-master");
    repos.push(repo.cwd);

    // helpers 默认在 main；改成 master 基线命名
    git(repo.cwd, ["branch", "-m", "master"]);
    git(repo.cwd, ["checkout", "-b", "develop"]);
    fs.writeFileSync(path.join(repo.cwd, "feature.js"), "module.exports = 1;\n");
    git(repo.cwd, ["add", "feature.js"]);
    git(repo.cwd, [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "feat: develop change",
    ]);

    const report = createBuildReport(repo.cwd, {
      compareRef: "master",
      includeDevelopDiff: false,
      env: {},
    });

    assert.strictEqual(report.branch, "develop");
    assert.strictEqual(report.diff.againstMaster.available, true);
    assert.strictEqual(report.diff.againstMaster.hasDiff, true);
    assert.ok(report.diff.againstMaster.aheadCount >= 1);
    assert.ok(report.diff.againstMaster.changedFiles.includes("feature.js"));
    assert.ok(
      report.diff.againstMaster.commits.some((item) => item.subject.includes("develop change"))
    );

    const text = formatReportText(report);
    assert.match(text, /相对 master/);
    assert.match(text, /feature\.js/);
    assert.match(text, /develop change/);
  });
});
