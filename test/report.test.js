"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { describe, it, afterEach } = require("node:test");
const { createBuildReport, formatReportText } = require("../src/build-report");
const { createRepo, removeRepo } = require("./helpers");

describe("build-report", () => {
  const repos = [];
  afterEach(() => {
    while (repos.length > 0) removeRepo(repos.pop());
  });

  it("报告包含主动告知后端团队所需的字段", () => {
    const repo = createRepo("report-clean");
    repos.push(repo.cwd);
    fs.writeFileSync(
      path.join(repo.cwd, "package.json"),
      JSON.stringify({ name: "shop-web" }, null, 2)
    );
    const report = createBuildReport(repo.cwd, { env: { CI: "true" } });
    assert.strictEqual(report.type, "frontend-build-update");
    assert.strictEqual(report.packageName, "shop-web");
    assert.strictEqual(report.commitId, repo.commitId);
    assert.strictEqual(report.ci, true);
    assert.match(report.message, /后端团队/);
    assert.match(formatReportText(report), /shop-web/);
  });
});
