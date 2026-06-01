import { GITHUB_SERVER_URL } from "../api/config";

export type ExecutionDetails = {
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
};

export type ReviewDigestComment = {
  path: string;
  line?: number | null;
  title: string;
};

export type CommentUpdateInput = {
  currentBody: string;
  actionFailed: boolean;
  executionDetails: ExecutionDetails | null;
  jobUrl: string;
  branchLink?: string;
  prLink?: string;
  branchName?: string;
  triggerUsername?: string;
  errorDetails?: string;
  securityReviewRan?: boolean;
  mentionTriggerUser?: boolean;
  // Mechanical review digest: which model ran, and what it flagged (path:line +
  // first line of each finding). Rendered into the completion comment so a
  // multi-model / multi-lane setup can see, per comment, who reviewed and what
  // they said — no LLM, just the validated findings.
  reviewModel?: string;
  reviewComments?: ReviewDigestComment[];
  reviewSummary?: string;
};

// Render "custom:GLM-5.1-ZAI-Coding-0" -> "GLM-5.1-ZAI-Coding" (drop the
// `custom:` prefix and the trailing BYOK catalog index).
export function formatReviewModel(model: string): string {
  return model.replace(/^custom:/, "").replace(/-\d+$/, "");
}

// Build the mechanical model + findings block for the completion comment.
export function buildReviewDigest(input: {
  reviewModel?: string;
  reviewComments?: ReviewDigestComment[];
  reviewSummary?: string;
  actionFailed?: boolean;
}): string {
  const { reviewModel, reviewComments, reviewSummary, actionFailed } = input;
  if (!reviewModel && !reviewComments?.length && !reviewSummary) return "";

  const parts: string[] = [];
  if (reviewModel) parts.push(`**Model:** \`${formatReviewModel(reviewModel)}\``);

  if (reviewComments && reviewComments.length > 0) {
    parts.push(`**Flagged (${reviewComments.length}):**`);
    const list = reviewComments
      .map((c) => {
        const loc = c.line != null ? `${c.path}:${c.line}` : c.path;
        return `- \`${loc}\` — ${c.title}`;
      })
      .join("\n");
    parts.push(list);
  } else if (reviewModel && !actionFailed) {
    parts.push("_No actionable findings._");
  }

  if (reviewSummary) {
    parts.push(`> ${reviewSummary.replace(/\s*\n\s*/g, " ").trim()}`);
  }

  return parts.join("\n\n");
}

export const SECURITY_REVIEW_BADGE =
  "![Security Review](https://img.shields.io/badge/security%20review-ran-blue)";

export function ensureProperlyEncodedUrl(url: string): string | null {
  try {
    // First, try to parse the URL to see if it's already properly encoded
    new URL(url);
    if (url.includes(" ")) {
      const [baseUrl, queryString] = url.split("?");
      if (queryString) {
        // Parse query parameters and re-encode them properly
        const params = new URLSearchParams();
        const pairs = queryString.split("&");
        for (const pair of pairs) {
          const [key, value = ""] = pair.split("=");
          if (key) {
            // Decode first in case it's partially encoded, then encode properly
            params.set(key, decodeURIComponent(value));
          }
        }
        return `${baseUrl}?${params.toString()}`;
      }
      // If no query string, just encode spaces
      return url.replace(/ /g, "%20");
    }
    return url;
  } catch (e) {
    // If URL parsing fails, try basic fixes
    try {
      // Replace spaces with %20
      let fixedUrl = url.replace(/ /g, "%20");

      // Ensure colons in parameter values are encoded (but not in http:// or after domain)
      const urlParts = fixedUrl.split("?");
      if (urlParts.length > 1 && urlParts[1]) {
        const [baseUrl, queryString] = urlParts;
        // Encode colons in the query string that aren't already encoded
        const fixedQuery = queryString.replace(/([^%]|^):(?!%2F%2F)/g, "$1%3A");
        fixedUrl = `${baseUrl}?${fixedQuery}`;
      }

      // Try to validate the fixed URL
      new URL(fixedUrl);
      return fixedUrl;
    } catch {
      // If we still can't create a valid URL, return null
      return null;
    }
  }
}

export function updateCommentBody(input: CommentUpdateInput): string {
  const originalBody = input.currentBody;
  const {
    executionDetails,
    jobUrl,
    branchLink,
    prLink,
    actionFailed,
    branchName,
    triggerUsername,
    errorDetails,
    securityReviewRan,
    mentionTriggerUser = true,
    reviewModel,
    reviewComments,
    reviewSummary,
  } = input;

  // Extract content from the original comment body
  // First, remove the "Droid is working…" message (and support legacy wording)
  const workingPattern = /Droid is working[…\.]{1,3}(?:\s*<img[^>]*>)?/i;
  let bodyContent = originalBody.replace(workingPattern, "").trim();

  // Remove initial placeholder follow-up text when present
  bodyContent = bodyContent.replace(
    /^(?:I['’]ll|I will) analyze this and get back to you\.?(?:\s*\n)?/im,
    "",
  );

  // Strip any previous completion headers (success or error) to avoid duplication
  bodyContent = bodyContent.replace(
    /^\*\*(?:Droid finished [^\n]*|Droid encountered an error[^\n]*)\*\*.*$/gim,
    "",
  );
  bodyContent = bodyContent.trim();

  // Check if there's a PR link in the content
  let prLinkFromContent = "";

  // Match the entire markdown link structure
  const prLinkPattern = /\[Create .* PR\]\((.*)\)$/m;
  const prLinkMatch = bodyContent.match(prLinkPattern);

  if (prLinkMatch && prLinkMatch[1]) {
    const encodedUrl = ensureProperlyEncodedUrl(prLinkMatch[1]);
    if (encodedUrl) {
      prLinkFromContent = encodedUrl;
      // Remove the PR link from the content
      bodyContent = bodyContent.replace(prLinkMatch[0], "").trim();
    }
  }

  // Calculate duration string if available
  let durationStr = "";
  if (executionDetails?.duration_ms !== undefined) {
    const totalSeconds = Math.round(executionDetails.duration_ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  // Build the header
  let header = "";

  if (actionFailed) {
    header = "**Droid encountered an error";
    if (durationStr) {
      header += ` after ${durationStr}`;
    }
    header += "**";
  } else {
    if (mentionTriggerUser) {
      // Get the username from triggerUsername or extract from content
      const username =
        triggerUsername || bodyContent.match(/@([a-zA-Z0-9-]+)/)?.[1] || "user";

      header = `**Droid finished @${username}'s task`;
    } else {
      header = "**Droid finished the task";
    }

    if (durationStr) {
      header += ` in ${durationStr}`;
    }
    header += "**";
  }

  // Add links section
  let links = ` —— [View job](${jobUrl})`;

  // Add branch name with link
  if (branchName || branchLink) {
    let finalBranchName = branchName;
    let branchUrl = "";

    if (branchLink) {
      // Extract the branch URL from the link
      const urlMatch = branchLink.match(/\((https:\/\/.*)\)/);
      if (urlMatch && urlMatch[1]) {
        branchUrl = urlMatch[1];
      }

      // Extract branch name from link if not provided
      if (!finalBranchName) {
        const branchNameMatch = branchLink.match(/tree\/([^"'\)]+)/);
        if (branchNameMatch) {
          finalBranchName = branchNameMatch[1];
        }
      }
    }

    // If we don't have a URL yet but have a branch name, construct it
    if (!branchUrl && finalBranchName) {
      // Extract owner/repo from jobUrl
      const repoMatch = jobUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\//);
      if (repoMatch) {
        branchUrl = `${GITHUB_SERVER_URL}/${repoMatch[1]}/${repoMatch[2]}/tree/${finalBranchName}`;
      }
    }

    if (finalBranchName && branchUrl) {
      links += ` • [\`${finalBranchName}\`](${branchUrl})`;
    } else if (finalBranchName) {
      links += ` • \`${finalBranchName}\``;
    }
  }

  // Add PR link (either from content or provided)
  const prUrl =
    prLinkFromContent || (prLink ? prLink.match(/\(([^)]+)\)/)?.[1] : "");
  if (prUrl) {
    links += ` • [Create PR ➔](${prUrl})`;
  }

  // Build the new body with blank line between header and separator
  let newBody = `${header}${links}`;

  // Add error details if available
  if (actionFailed && errorDetails) {
    newBody += `\n\n\`\`\`\n${errorDetails}\n\`\`\``;
  }

  // Mechanical per-model review digest (which model, what it flagged, why).
  const reviewDigest = buildReviewDigest({
    reviewModel,
    reviewComments,
    reviewSummary,
    actionFailed,
  });
  if (reviewDigest) {
    newBody += `\n\n${reviewDigest}`;
  }

  newBody += `\n\n---\n`;

  // Clean up the body content
  // Remove any existing View job run, branch links from the bottom
  bodyContent = bodyContent.replace(/\n?\[View job run\]\([^\)]+\)/g, "");
  bodyContent = bodyContent.replace(/\n?\[View branch\]\([^\)]+\)/g, "");

  // Remove any existing duration info at the bottom
  bodyContent = bodyContent.replace(/\n*---\n*Duration: [0-9]+m? [0-9]+s/g, "");

  if (securityReviewRan && !bodyContent.includes("security%20review-ran")) {
    bodyContent = `${SECURITY_REVIEW_BADGE}\n\n${bodyContent}`.trim();
  }

  // Add the cleaned body content
  newBody += bodyContent;

  return newBody.trim();
}
