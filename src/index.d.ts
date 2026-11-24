import type { Compiler } from "webpack";

declare class GitCommitVersionPlugin {
  constructor(options?: GitCommitVersionPlugin.Options);
  apply(compiler: Compiler): void;
  report: GitCommitVersionPlugin.BuildReport | null;
}

declare namespace GitCommitVersionPlugin {
  interface WebhookOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
    /** false 时发送可读文本，默认发送 JSON */
    json?: boolean;
    body?: (report: BuildReport) => string;
  }

  interface CommitSummary {
    commitId: string;
    shortCommitId: string;
    subject: string;
  }

  interface BranchDiff {
    available: boolean;
    compareRef?: string;
    baseRef?: string | null;
    baseCommitId?: string | null;
    baseShortCommitId?: string | null;
    aheadCount?: number;
    behindCount?: number;
    hasDiff?: boolean;
    commits?: CommitSummary[];
    changedFiles?: string[];
    truncatedCommits?: boolean;
    truncatedFiles?: boolean;
    note?: string;
  }

  interface LastNotifyDiff {
    available: boolean;
    lastReportPath?: string;
    lastCommitId?: string;
    lastBuildTime?: string | null;
    unchanged?: boolean;
    aheadCount?: number;
    commits?: CommitSummary[];
    changedFiles?: string[];
    note?: string;
  }

  interface Options {
    /** 产物内 JSON 更新报告。默认 frontend-build-report.json；false 关闭 */
    filename?: string | false;
    /** 产物内可读 Markdown 报告。默认 frontend-build-report.md；false 关闭 */
    textFilename?: string | false;
    /** 额外写出 JSON 报告的绝对/相对路径，方便拷贝给后端团队 */
    reportPath?: string | null;
    /** 额外写出可读报告的路径 */
    textReportPath?: string | null;
    /** POST 更新报告到后端团队 Webhook */
    webhook?: string | WebhookOptions | null;
    /** 自定义主动告知逻辑（钉钉、飞书、邮件等） */
    onNotify?: (report: BuildReport) => unknown | Promise<unknown>;
    /** 构建结束后在控制台打印可转发的报告。默认 true */
    consoleNotify?: boolean;
    /** Webhook/onNotify 失败时是否让构建失败。默认 true */
    failOnNotify?: boolean;
    /** 报告开头的告知文案 */
    message?: string;
    packageName?: string;
    /**
     * 差异对比基线分支。默认 master（已发布基线）。
     * release 完成后才会合入 master；对比它可看出本次发布相对线上的变更。
     */
    compareRef?: string;
    /** 发布分支名。默认 release；完成发布后合入 master */
    releaseRef?: string;
    /** 开发测试分支名。默认 develop；不与 master 互相合并 */
    developRef?: string;
    /** 是否附带相对 develop 的差异。当前就在 develop 上时自动跳过。默认 true */
    includeDevelopDiff?: boolean;
    /** 是否附带相对 release 的差异。当前就在 release 上时自动跳过。默认 false */
    includeReleaseDiff?: boolean;
    /**
     * 上次已通知报告的路径。构建成功后会覆盖写入，下次用于「相对上次通知」对比。
     */
    lastReportPath?: string | null;
    maxCommits?: number;
    maxFiles?: number;
    /**
     * 工作区有未提交文件时是否失败。默认 false：先产出报告并通知。
     * auto：仅 CI 失败；true：一律失败。
     */
    failOnDirty?: boolean | "auto";
    /** 流水线 commit 与 HEAD 不一致时是否失败。默认 false */
    failOnCommitMismatch?: boolean;
    ciCommitEnvVars?: string[];
    context?: string;
    defines?: boolean | Record<string, string>;
    banner?: boolean;
    ignore?: Array<string | RegExp>;
    env?: NodeJS.ProcessEnv;
  }

  interface BuildReport {
    type: "frontend-build-update";
    title: string;
    message: string;
    packageName: string | null;
    commitId: string;
    shortCommitId: string;
    branch: string;
    subject: string | null;
    dirty: boolean;
    uncommittedFiles: string[];
    sourceVersion: string;
    consistent: boolean;
    ci: boolean;
    ciCommitId: string | null;
    buildTime: string;
    workflow: {
      featureFrom: string;
      testBranch: string;
      releaseBranch: string;
      releasedBaseline: string;
      note: string;
    };
    diff: {
      againstMaster: BranchDiff;
      againstDevelop: BranchDiff | null;
      againstRelease: BranchDiff | null;
      sinceLastNotify: LastNotifyDiff | null;
    };
  }

  function createBuildReport(cwd?: string, options?: Options): BuildReport;
  function formatReportText(report: BuildReport): string;
  function verifyGitVersion(cwd?: string, options?: Options): unknown;
  function collectGitVersion(
    cwd?: string,
    options?: Pick<Options, "ignore">
  ): Pick<
    BuildReport,
    | "commitId"
    | "shortCommitId"
    | "branch"
    | "dirty"
    | "uncommittedFiles"
    | "subject"
    | "sourceVersion"
  >;
}

export = GitCommitVersionPlugin;
