"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { describe, it, afterEach } = require("node:test");
const webpack = require("webpack");
const GitCommitVersionPlugin = require("../src");
const { createRepo, removeRepo } = require("./helpers");

function compile(cwd, plugin) {
  return new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "none",
      context: cwd,
      entry: "./index.js",
      output: {
        path: path.join(cwd, "dist"),
        filename: "bundle.js",
      },
      infrastructureLogging: { level: "none" },
      plugins: [plugin],
    });
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error) reject(error);
        else if (closeError) reject(closeError);
        else resolve(stats);
      });
    });
  });
}

function startWebhookServer() {
  const payloads = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      payloads.push({
        method: req.method,
        url: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        payloads,
        url: `http://127.0.0.1:${address.port}/frontend-build`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

describe("GitCommitVersionPlugin", () => {
  const repos = [];
  afterEach(() => {
    while (repos.length > 0) removeRepo(repos.pop());
  });

  it("每次构建产出 JSON/Markdown 更新报告", async () => {
    const repo = createRepo("plugin-report");
    repos.push(repo.cwd);
    const stats = await compile(
      repo.cwd,
      new GitCommitVersionPlugin({ consoleNotify: false })
    );
    assert.strictEqual(stats.hasErrors(), false, stats.toJson().errors);

    const report = JSON.parse(
      fs.readFileSync(path.join(repo.cwd, "dist", "frontend-build-report.json"), "utf8")
    );
    const text = fs.readFileSync(
      path.join(repo.cwd, "dist", "frontend-build-report.md"),
      "utf8"
    );
    const bundle = fs.readFileSync(path.join(repo.cwd, "dist", "bundle.js"), "utf8");

    assert.strictEqual(report.type, "frontend-build-update");
    assert.strictEqual(report.commitId, repo.commitId);
    assert.strictEqual(report.sourceVersion, repo.commitId);
    assert.match(report.message, /后端团队/);
    assert.match(text, /前端包构建更新报告/);
    assert.match(text, new RegExp(repo.commitId));
    assert.match(bundle, new RegExp(`frontend-build: ${repo.commitId}`));
  });

  it("通过 Webhook 主动把更新报告发给后端团队", async () => {
    const repo = createRepo("plugin-webhook");
    repos.push(repo.cwd);
    const server = await startWebhookServer();
    try {
      const stats = await compile(
        repo.cwd,
        new GitCommitVersionPlugin({
          webhook: server.url,
          consoleNotify: false,
        })
      );
      assert.strictEqual(stats.hasErrors(), false, stats.toJson().errors);
      assert.strictEqual(server.payloads.length, 1);
      assert.strictEqual(server.payloads[0].method, "POST");
      assert.strictEqual(server.payloads[0].body.type, "frontend-build-update");
      assert.strictEqual(server.payloads[0].body.commitId, repo.commitId);
    } finally {
      await server.close();
    }
  });

  it("onNotify 自定义告知渠道会收到完整报告", async () => {
    const repo = createRepo("plugin-callback");
    repos.push(repo.cwd);
    const received = [];
    await compile(
      repo.cwd,
      new GitCommitVersionPlugin({
        consoleNotify: false,
        onNotify: (report) => {
          received.push(report);
        },
      })
    );
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].commitId, repo.commitId);
  });

  it("开启 failOnDirty 后，未提交文件会让构建失败且不通知", async () => {
    const repo = createRepo("plugin-dirty");
    repos.push(repo.cwd);
    fs.writeFileSync(path.join(repo.cwd, "missed.js"), "module.exports = 1;\n");
    const received = [];
    await assert.rejects(
      () =>
        compile(
          repo.cwd,
          new GitCommitVersionPlugin({
            failOnDirty: true,
            env: { CI: "true" },
            onNotify: (report) => received.push(report),
          })
        ),
      /missed\.js/
    );
    assert.strictEqual(received.length, 0);
    assert.strictEqual(
      fs.existsSync(path.join(repo.cwd, "dist", "frontend-build-report.json")),
      false
    );
  });
});
