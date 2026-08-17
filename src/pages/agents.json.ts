import { getCollection } from "astro:content";

export const prerender = true;

export async function GET() {
  const agents = (await getCollection("agents", ({ data }) => data.published))
    .sort((left, right) => left.data.name.localeCompare(right.data.name))
    .map((agent) => ({
      id: agent.data.agentId,
      slug: agent.id,
      name: agent.data.name,
      summary: agent.data.summary,
      status: agent.data.status,
      availability: agent.data.availability,
      operationMode: agent.data.operationMode,
      capabilities: agent.data.capabilities,
      interfaces: agent.data.interfaces,
      haraPackages: agent.data.haraPackages,
      runtime: agent.data.runtime ?? null,
      operator: {
        githubId: agent.data.operatorGithubId,
        githubLogin: agent.data.operatorGithubLogin,
        displayName: agent.data.operatorDisplayName,
      },
      verification: {
        type: agent.data.verification,
        keyFingerprint: agent.data.keyFingerprint ?? null,
      },
      links: {
        registry: `/agents/${agent.id}/`,
        website: agent.data.website ?? null,
        source: agent.data.source ?? null,
        documentation: agent.data.documentation ?? null,
      },
      registeredAt: agent.data.registeredAt.toISOString(),
      updatedAt: agent.data.updatedAt.toISOString(),
    }));

  return new Response(`${JSON.stringify({ version: 1, agents }, null, 2)}\n`, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
