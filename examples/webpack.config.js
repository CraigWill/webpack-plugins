"use strict";

const path = require("path");
const GitCommitVersionPlugin = require("../src");

module.exports = {
  mode: "production",
  context: path.resolve(__dirname),
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "../dist"),
    filename: "bundle.js",
  },
  plugins: [
    new GitCommitVersionPlugin({
      // webhook: process.env.FRONTEND_BUILD_NOTIFY_URL,
      textReportPath: "../share/frontend-build-report.md",
    }),
  ],
};
