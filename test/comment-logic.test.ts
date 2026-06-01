import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  updateCommentBody,
  type CommentUpdateInput,
} from "../src/github/operations/comment-logic";

describe("updateCommentBody", () => {
  const baseInput = {
    currentBody: "Initial comment body",
    actionFailed: false,
    executionDetails: null,
    jobUrl: "https://github.com/owner/repo/actions/runs/123",
    branchName: undefined,
    triggerUsername: undefined,
  };

  describe("working message replacement", () => {
    it("includes success message header with duration", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working…",
        executionDetails: { duration_ms: 74000 }, // 1m 14s
        triggerUsername: "trigger-user",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "**Droid finished @trigger-user's task in 1m 14s**",
      );
      expect(result).not.toContain("Droid is working");
    });

    it("explicit true mentions the trigger user", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working...",
        triggerUsername: "trigger-user",
        mentionTriggerUser: true,
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished @trigger-user's task**");
    });

    it("false uses a neutral success header", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working...",
        triggerUsername: "trigger-user",
        mentionTriggerUser: false,
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished the task**");
      expect(result).not.toContain("@trigger-user");
    });

    it("false uses a neutral success header with duration", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working...",
        executionDetails: { duration_ms: 74000 },
        triggerUsername: "trigger-user",
        mentionTriggerUser: false,
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished the task in 1m 14s**");
      expect(result).not.toContain("@trigger-user");
    });

    it("includes error message header with duration", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working...",
        actionFailed: true,
        executionDetails: { duration_ms: 45000 }, // 45s
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid encountered an error after 45s**");
    });

    it("includes error details when provided", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working...",
        actionFailed: true,
        executionDetails: { duration_ms: 45000 },
        errorDetails: "Failed to fetch issue data",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid encountered an error after 45s**");
      expect(result).toContain("[View job]");
      expect(result).toContain("```\nFailed to fetch issue data\n```");
      // Ensure error details come after the header/links
      const errorIndex = result.indexOf("```");
      const headerIndex = result.indexOf("**Droid encountered an error");
      expect(errorIndex).toBeGreaterThan(headerIndex);
    });

    it("handles username extraction from content when not provided", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Droid is working… <img src='spinner.gif' />\n\nI'll work on this task @testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished @testuser's task**");
    });

    it("false does not extract a username from body content into the header", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working…\n\nI'll work on this task @body-user",
        mentionTriggerUser: false,
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished the task**");
      expect(result).not.toContain("Droid finished @body-user");
    });

    it("false preserves mentions already present in body content", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working…\n\nI left a note for @body-user.",
        mentionTriggerUser: false,
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished the task**");
      expect(result).toContain("I left a note for @body-user.");
    });

    it("false does not change failure headers", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working...",
        actionFailed: true,
        executionDetails: { duration_ms: 45000 },
        triggerUsername: "trigger-user",
        mentionTriggerUser: false,
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid encountered an error after 45s**");
      expect(result).not.toContain("Droid finished the task");
    });
  });

  describe("job link", () => {
    it("includes job link in header", () => {
      const input = {
        ...baseInput,
        currentBody: "Some comment",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`—— [View job](${baseInput.jobUrl})`);
    });

    it("always includes job link in header, even if present in body", () => {
      const input = {
        ...baseInput,
        currentBody: `Some comment with [View job run](${baseInput.jobUrl})`,
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      // Check it's in the header with the new format
      expect(result).toContain(`—— [View job](${baseInput.jobUrl})`);
      // The old link in body is removed
      expect(result).not.toContain("View job run");
    });
  });

  describe("branch link", () => {
    it("adds branch name with link to header when provided", () => {
      const input = {
        ...baseInput,
        branchName: "droid/issue-123-20240101-1200",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [`droid/issue-123-20240101-1200`](https://github.com/owner/repo/tree/droid/issue-123-20240101-1200)",
      );
    });

    it("extracts branch name from branchLink if branchName not provided", () => {
      const input = {
        ...baseInput,
        branchLink:
          "\n[View branch](https://github.com/owner/repo/tree/branch-name)",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [`branch-name`](https://github.com/owner/repo/tree/branch-name)",
      );
    });

    it("removes old branch links from body", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Some comment with [View branch](https://github.com/owner/repo/tree/branch-name)",
        branchName: "new-branch-name",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [`new-branch-name`](https://github.com/owner/repo/tree/new-branch-name)",
      );
      expect(result).not.toContain("View branch");
    });
  });

  describe("PR link", () => {
    it("adds PR link to header when provided", () => {
      const input = {
        ...baseInput,
        prLink: "\n[Create a PR](https://github.com/owner/repo/pr-url)",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url)",
      );
    });

    it("moves PR link from body to header", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Some comment with [Create a PR](https://github.com/owner/repo/pr-url)",
      };

      const result = updateCommentBody(input);
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url)",
      );
      // Original Create a PR link is removed from body
      expect(result).not.toContain("[Create a PR]");
    });

    it("handles both body and provided PR links", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Some comment with [Create a PR](https://github.com/owner/repo/pr-url-from-body)",
        prLink:
          "\n[Create a PR](https://github.com/owner/repo/pr-url-provided)",
      };

      const result = updateCommentBody(input);
      // Prefers the link found in content over the provided one
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url-from-body)",
      );
    });

    it("handles complex PR URLs with encoded characters", () => {
      const complexUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A%20important%20bug%20fix&body=Fixes%20%23123%0A%0A%23%23%20Description%0AThis%20PR%20fixes%20an%20important%20bug%20that%20was%20causing%20issues%20with%20the%20application.%0A%0AGenerated%20with%20%5BDroid%20Exec%5D(https%3A%2F%2Fapp.factory.ai)";
      const input = {
        ...baseInput,
        currentBody: `Some comment with [Create a PR](${complexUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${complexUrl})`);
      // Original link should be removed from body
      expect(result).not.toContain("[Create a PR]");
    });

    it("handles PR links with encoded URLs containing parentheses", () => {
      const complexUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A%20bug%20fix&body=Generated%20with%20%5BDroid%20Exec%5D(https%3A%2F%2Fapp.factory.ai)";
      const input = {
        ...baseInput,
        currentBody: `This PR was created.\n\n[Create a PR](${complexUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${complexUrl})`);
      // Original link should be removed from body completely
      expect(result).not.toContain("[Create a PR]");
      // Body content shouldn't have stray closing parens
      expect(result).toContain("This PR was created.");
      // Body part should be clean with no stray parens
      const bodyAfterSeparator = result.split("---")[1]?.trim();
      expect(bodyAfterSeparator).toBe("This PR was created.");
    });

    it("handles PR links with unencoded spaces and special characters", () => {
      const unEncodedUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix: update welcome message&body=Generated with [Droid Exec](https://app.factory.ai)";
      const expectedEncodedUrl =
        "https://github.com/owner/repo/compare/main...feature-branch?quick_pull=1&title=fix%3A+update+welcome+message&body=Generated+with+%5BDroid+Exec%5D%28https%3A%2F%2Fapp.factory.ai%29";
      const input = {
        ...baseInput,
        currentBody: `This PR was created.\n\n[Create a PR](${unEncodedUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${expectedEncodedUrl})`);
      // Original link should be removed from body completely
      expect(result).not.toContain("[Create a PR]");
      // Body content should be preserved
      expect(result).toContain("This PR was created.");
    });

    it("falls back to prLink parameter when PR link in content cannot be encoded", () => {
      const invalidUrl = "not-a-valid-url-at-all";
      const fallbackPrUrl = "https://github.com/owner/repo/pull/123";
      const input = {
        ...baseInput,
        currentBody: `This PR was created.\n\n[Create a PR](${invalidUrl})`,
        prLink: `\n[Create a PR](${fallbackPrUrl})`,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(`• [Create PR ➔](${fallbackPrUrl})`);
      // Original link with invalid URL should still be in body since encoding failed
      expect(result).toContain("[Create a PR](not-a-valid-url-at-all)");
      expect(result).toContain("This PR was created.");
    });
  });

  describe("execution details", () => {
    it("includes duration in header for success", () => {
      const input = {
        ...baseInput,
        executionDetails: {
          cost_usd: 0.13382595,
          duration_ms: 31033,
          duration_api_ms: 31034,
        },
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished @testuser's task in 31s**");
    });

    it("formats duration in minutes and seconds in header", () => {
      const input = {
        ...baseInput,
        executionDetails: {
          duration_ms: 75000, // 1 minute 15 seconds
        },
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished @testuser's task in 1m 15s**");
    });

    it("includes duration in error header", () => {
      const input = {
        ...baseInput,
        actionFailed: true,
        executionDetails: {
          duration_ms: 45000, // 45 seconds
        },
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid encountered an error after 45s**");
    });

    it("handles missing duration gracefully", () => {
      const input = {
        ...baseInput,
        executionDetails: {
          cost_usd: 0.25,
        },
        triggerUsername: "testuser",
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished @testuser's task**");
      expect(result).not.toContain(" in ");
    });
  });

  describe("combined updates", () => {
    it("combines all updates in correct order", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Droid is working…\n\n### Todo List:\n- [x] Read README.md\n- [x] Add disclaimer",
        actionFailed: false,
        branchName: "droid-branch-123",
        prLink: "\n[Create a PR](https://github.com/owner/repo/pr-url)",
        executionDetails: {
          cost_usd: 0.01,
          duration_ms: 65000, // 1 minute 5 seconds
        },
        triggerUsername: "trigger-user",
      };

      const result = updateCommentBody(input);

      // Check the header structure
      expect(result).toContain(
        "**Droid finished @trigger-user's task in 1m 5s**",
      );
      expect(result).toContain("—— [View job]");
      expect(result).toContain(
        "• [`droid-branch-123`](https://github.com/owner/repo/tree/droid-branch-123)",
      );
      expect(result).toContain("• [Create PR ➔]");

      // Check order - header comes before separator with blank line
      const headerIndex = result.indexOf("**Droid finished");
      const blankLineAndSeparatorPattern = /\n\n---\n/;
      expect(result).toMatch(blankLineAndSeparatorPattern);

      const separatorIndex = result.indexOf("---");
      const todoIndex = result.indexOf("### Todo List:");

      expect(headerIndex).toBeLessThan(separatorIndex);
      expect(separatorIndex).toBeLessThan(todoIndex);

      // Check content is preserved
      expect(result).toContain("### Todo List:");
      expect(result).toContain("- [x] Read README.md");
      expect(result).toContain("- [x] Add disclaimer");
    });

    it("handles PR link extraction from content", () => {
      const input = {
        ...baseInput,
        currentBody:
          "Droid is working…\n\nI've made changes.\n[Create a PR](https://github.com/owner/repo/pr-url-in-content)\n\n@john-doe",
        branchName: "feature-branch",
        triggerUsername: "john-doe",
      };

      const result = updateCommentBody(input);

      // PR link should be moved to header
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/pr-url-in-content)",
      );
      // Original link should be removed from body
      expect(result).not.toContain("[Create a PR]");
      // Username should come from argument, not extraction
      expect(result).toContain("**Droid finished @john-doe's task**");
      // Content should be preserved
      expect(result).toContain("I've made changes.");
    });

    it("includes PR link for new branches (issues and closed PRs)", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working… <img src='spinner.gif' />",
        branchName: "droid/pr-456-20240101-1200",
        prLink:
          "\n[Create a PR](https://github.com/owner/repo/compare/main...droid/pr-456-20240101-1200)",
        triggerUsername: "jane-doe",
      };

      const result = updateCommentBody(input);

      // Should include the PR link in the formatted style
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/compare/main...droid/pr-456-20240101-1200)",
      );
      expect(result).toContain("**Droid finished @jane-doe's task**");
    });

    it("includes both branch link and PR link for new branches", () => {
      const input = {
        ...baseInput,
        currentBody: "Droid is working…",
        branchName: "droid/issue-123-20240101-1200",
        branchLink:
          "\n[View branch](https://github.com/owner/repo/tree/droid/issue-123-20240101-1200)",
        prLink:
          "\n[Create a PR](https://github.com/owner/repo/compare/main...droid/issue-123-20240101-1200)",
      };

      const result = updateCommentBody(input);

      // Should include both links in formatted style
      expect(result).toContain(
        "• [`droid/issue-123-20240101-1200`](https://github.com/owner/repo/tree/droid/issue-123-20240101-1200)",
      );
      expect(result).toContain(
        "• [Create PR ➔](https://github.com/owner/repo/compare/main...droid/issue-123-20240101-1200)",
      );
    });

    it("should not show branch name when branch doesn't exist remotely", () => {
      const input: CommentUpdateInput = {
        currentBody: "@droid can you help with this?",
        actionFailed: false,
        executionDetails: { duration_ms: 90000 },
        jobUrl: "https://github.com/owner/repo/actions/runs/123",
        branchLink: "", // Empty branch link means branch doesn't exist remotely
        branchName: undefined, // Should be undefined when branchLink is empty
        triggerUsername: "droid",
        prLink: "",
      };

      const result = updateCommentBody(input);

      expect(result).toContain("Droid finished @droid's task in 1m 30s");
      expect(result).toContain(
        "[View job](https://github.com/owner/repo/actions/runs/123)",
      );
      expect(result).not.toContain("droid/issue-123");
      expect(result).not.toContain("tree/droid/issue-123");
    });
  });

  describe("security review badge", () => {
    const SHIELD_URL_FRAGMENT = "security%20review-ran";

    it("prepends the security badge when securityReviewRan is true", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Droid is reviewing code and running a security check…",
        executionDetails: { duration_ms: 60000 },
        securityReviewRan: true,
      };

      const result = updateCommentBody(input);
      expect(result).toContain(SHIELD_URL_FRAGMENT);
      expect(result).toContain(
        "![Security Review](https://img.shields.io/badge/security%20review-ran-blue)",
      );
    });

    it("does not add the badge when securityReviewRan is false", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Droid is working…",
        executionDetails: { duration_ms: 60000 },
        securityReviewRan: false,
      };

      const result = updateCommentBody(input);
      expect(result).not.toContain(SHIELD_URL_FRAGMENT);
    });

    it("does not add the badge when securityReviewRan is undefined", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Droid is working…",
        executionDetails: { duration_ms: 60000 },
      };

      const result = updateCommentBody(input);
      expect(result).not.toContain(SHIELD_URL_FRAGMENT);
    });

    it("does not double-prepend when the badge is already present", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody:
          "Droid is reviewing code and running a security check…\n\n" +
          "![Security Review](https://img.shields.io/badge/security%20review-ran-blue)\n\n" +
          "Validator approved 2 findings.",
        executionDetails: { duration_ms: 60000 },
        securityReviewRan: true,
      };

      const result = updateCommentBody(input);
      const occurrences = result.split(SHIELD_URL_FRAGMENT).length - 1;
      expect(occurrences).toBe(1);
    });

    it("keeps security badge behavior in neutral header mode", () => {
      const input: CommentUpdateInput = {
        ...baseInput,
        currentBody: "Droid is reviewing code and running a security check…",
        executionDetails: { duration_ms: 60000 },
        securityReviewRan: true,
        mentionTriggerUser: false,
      };

      const result = updateCommentBody(input);
      expect(result).toContain("**Droid finished the task in 1m 0s**");
      expect(result).toContain(SHIELD_URL_FRAGMENT);
    });
  });
});

describe("action metadata mention_trigger_user input", () => {
  const actionFiles: Array<[string, string]> = [
    ["top-level action", "action.yml"],
    ["review action", join("review", "action.yml")],
    ["security action", join("security", "action.yml")],
  ];

  for (const [label, relativePath] of actionFiles) {
    it(`${label} exposes mention_trigger_user`, () => {
      const actionYml = readFileSync(
        join(import.meta.dir, "..", relativePath),
        "utf8",
      );

      expect(actionYml).toContain("mention_trigger_user:");
      expect(actionYml).toMatch(
        /mention_trigger_user:\s*\n(?:\s+.*\n)*?\s+default:\s+"true"/,
      );
      expect(actionYml).toContain(
        "MENTION_TRIGGER_USER: ${{ inputs.mention_trigger_user }}",
      );
    });
  }
});

describe("review model attribution", () => {
  const baseInput: CommentUpdateInput = {
    currentBody: "Droid is working…",
    actionFailed: false,
    executionDetails: null,
    jobUrl: "https://github.com/owner/repo/actions/runs/123",
  };

  it("renders the model, stripping `custom:` prefix and catalog index", () => {
    const result = updateCommentBody({
      ...baseInput,
      reviewModel: "custom:GLM-5.1-ZAI-Coding-0",
    });

    expect(result).toContain("**Model:** `GLM-5.1-ZAI-Coding`");
  });

  it("renders a different model unchanged otherwise", () => {
    const result = updateCommentBody({
      ...baseInput,
      reviewModel: "custom:MiniMax-M3-3",
    });

    expect(result).toContain("**Model:** `MiniMax-M3`");
  });

  it("omits the model line entirely when no model is provided", () => {
    const result = updateCommentBody(baseInput);

    expect(result).not.toContain("**Model:**");
  });
});
