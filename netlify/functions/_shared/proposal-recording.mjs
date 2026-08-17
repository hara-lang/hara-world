import { recordProposalSubmission } from "./proposals.mjs";

function articlePublicPath(proposalPath) {
  const path = String(proposalPath ?? "");
  const match = path.match(/^content\/articles\/(.+)\.md$/);
  return match ? `/articles/${match[1]}` : null;
}

export function publicPathForProposal(proposalType, { slug, path } = {}) {
  if (proposalType === "profile" && slug) return `/people/${slug}/`;
  if (proposalType === "agent" && slug) return `/agents/${slug}/`;
  if (proposalType === "source") return "/sources";
  if (proposalType === "post") return articlePublicPath(path);
  return null;
}

export async function recordPublishedProposal({
  proposalType,
  identity,
  resourceKey,
  resourceTitle,
  result,
  client,
  publicPath,
  now = Date.now(),
  db,
  proposalStore,
} = {}) {
  if (!result || result.unchanged || !result.number || !result.pullRequestUrl || !result.branch) {
    return { recorded: true, proposal: null };
  }
  const record = proposalStore?.recordSubmission ?? recordProposalSubmission;
  try {
    const proposal = await record({
      proposalType,
      ownerGithubUserId: identity.id,
      resourceKey,
      resourceTitle,
      repository: client.repository,
      branch: result.branch,
      baseBranch: client.baseBranch,
      pullRequestNumber: result.number,
      pullRequestUrl: result.pullRequestUrl,
      publicPath: publicPath ?? null,
      headSha: result.headSha ?? null,
      isDraft: true,
      submittedAt: result.submittedAt ?? now,
    }, {
      db,
      now,
      actorGithubUserId: identity.id,
      actorLogin: identity.login,
      eventType: result.reused ? "proposal.resubmitted" : "proposal.submitted",
    });
    return { recorded: true, proposal };
  } catch (error) {
    console.error("Hara World proposal lifecycle record failed", {
      proposalType,
      name: error?.name,
    });
    return { recorded: false, proposal: null };
  }
}
