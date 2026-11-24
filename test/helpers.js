"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = path.join(__dirname, "..", ".tmp");

function git(cwd, args) {
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdio: "pipe",
  });
}

function createRepo(name) {
  fs.mkdirSync(tempRoot, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(tempRoot, `${name}-`));
  git(cwd, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(cwd, "index.js"), "module.exports = __GIT_SOURCE_VERSION__;\n");
  git(cwd, ["add", "index.js"]);
  git(cwd, ["-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"]);
  const commitId = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
  return { cwd, commitId };
}

function removeRepo(cwd) {
  fs.rmSync(cwd, { recursive: true, force: true });
}

module.exports = { createRepo, git, removeRepo, tempRoot };
