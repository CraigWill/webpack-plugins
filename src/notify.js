"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { formatReportText } = require("./build-report");

function writeReportFiles(report, targets) {
  const written = [];
  for (const target of targets) {
    if (!target || !target.path) continue;
    const content =
      target.format === "text" || target.format === "md"
        ? formatReportText(report)
        : `${JSON.stringify(report, null, 2)}\n`;
    fs.mkdirSync(require("path").dirname(target.path), { recursive: true });
    fs.writeFileSync(target.path, content, "utf8");
    written.push(target.path);
  }
  return written;
}

function postWebhook(webhook, report) {
  const config =
    typeof webhook === "string"
      ? { url: webhook }
      : webhook && typeof webhook === "object"
        ? webhook
        : null;
  if (!config || !config.url) {
    return Promise.resolve(null);
  }

  const url = new URL(config.url);
  const body = Buffer.from(
    typeof config.body === "function"
      ? config.body(report)
      : JSON.stringify(config.json === false ? formatReportText(report) : report),
    "utf8"
  );
  const transport = url.protocol === "http:" ? http : https;
  const headers = {
    "content-type":
      config.json === false ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "content-length": body.length,
    ...(config.headers || {}),
  };

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: config.method || "POST",
        headers,
        timeout: config.timeout || 15000,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              statusCode: response.statusCode,
              body: text,
            });
          } else {
            reject(
              new Error(
                `通知 Webhook 失败：HTTP ${response.statusCode}${text ? ` ${text.slice(0, 200)}` : ""}`
              )
            );
          }
        });
      }
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error("通知 Webhook 超时"));
    });
    request.write(body);
    request.end();
  });
}

async function deliverReport(report, options = {}) {
  const result = {
    files: [],
    webhook: null,
    callback: null,
  };

  if (Array.isArray(options.files) && options.files.length > 0) {
    result.files = writeReportFiles(report, options.files);
  }

  if (options.webhook) {
    result.webhook = await postWebhook(options.webhook, report);
  }

  if (typeof options.onNotify === "function") {
    result.callback = await options.onNotify(report);
  }

  return result;
}

function printConsoleNotice(logger, report, extra = {}) {
  const text = formatReportText(report).trimEnd();
  const fileHint =
    extra.files && extra.files.length > 0
      ? `\n报告文件：\n${extra.files.map((file) => `- ${file}`).join("\n")}`
      : "";
  const block = [
    "",
    "======== 前端构建更新报告（请同步后端团队） ========",
    text,
    fileHint,
    "====================================================",
    "",
  ]
    .filter((line, index, arr) => !(line === "" && (index === 0 || index === arr.length - 1) && false))
    .join("\n");

  if (logger && typeof logger.info === "function") {
    logger.info(block);
  } else {
    process.stdout.write(`${block}\n`);
  }
}

module.exports = {
  deliverReport,
  formatReportText,
  postWebhook,
  printConsoleNotice,
  writeReportFiles,
};
