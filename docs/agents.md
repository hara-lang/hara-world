# Hara Learn agent registration

Hara Learn provides a public registry for agents built with or around Hara. The first version is deliberately human-owned: an authenticated person registers an agent they operate, and the resulting record is reviewed in Git before publication.

```text
Hara Identity
      │ audience-bound handoff
      ▼
Learn human session
      │
      ▼
agent registration form
      │ server supplies operator identity
      ▼
reusable GitHub proposal branch
      │
      ▼
draft pull request
      │ review + merge
      ▼
content/agents/<slug>.md + registry/agents.json
      │
      ├──► /agents/<slug>/
      └──► /agents.json
```

## What registration means

A merged record establishes that a particular Hara Learn account submitted and maintains the public description of an agent. The record carries the operator's stable numeric GitHub subject and current GitHub login from the server-verified Learn session.

Registration does **not**:

- authenticate a running process;
- give the agent a Hara Identity session;
- allow the agent to post to Hara Learn;
- grant package, repository, specification, tool, filesystem, network, or runtime authority;
- endorse the agent's behaviour or output;
- prove that a public endpoint is currently available.

Those are separate capability and verification systems.

## Public record

Each merged Markdown record contains:

- stable `agentId`, derived from operator GitHub ID and immutable public slug;
- server-supplied operator GitHub ID, login, and display name;
- agent name and summary;
- lifecycle status;
- availability and operation mode;
- declared capabilities and interfaces;
- Hara packages or namespaces used by the agent;
- optional runtime description and HTTPS links;
- verification state;
- registration and update dates;
- a constrained Markdown description.

The stable identity has this form:

```text
agent:github:<operator-github-id>:<agent-slug>
```

An operator may register multiple agents. Slugs are globally unique and become immutable after the first merge. Ownership transfer is intentionally not available through the public form; it requires a separately reviewed registry operation.

## Verification levels

### `operator-claimed`

The default. Hara Learn verifies the human operator account and records that person's claim about the agent. This establishes accountability, not machine identity.

### `key-verified`

A reviewer-controlled future-facing state. It requires a public-key fingerprint in the Git record. The registration form cannot set or replace the fingerprint. A later Hestia or Hara Identity flow may issue signed challenge receipts proving that the running agent controls the reviewed key.

## API

```text
GET  /api/agents
POST /api/agents
```

Both operations require an active Learn session. `GET` returns the merged agent records owned by that operator. `POST` additionally requires a same-origin request and:

```text
X-Hara-Request: agent-proposal
```

The browser may propose descriptive fields. It cannot choose:

- `agentId`;
- operator GitHub ID or login;
- operator display identity;
- verification state or key fingerprint;
- reviewed attestations;
- proposal branch;
- publication path;
- pull-request metadata.

## Proposal behaviour

The server reads the reviewed index from the configured base branch, checks slug ownership, and writes both the agent document and reciprocal index update to one stable branch:

```text
agent-registry/github-<operator-id>/<slug>
```

Submitting the same slug again resets that branch to the current base and updates its existing open draft pull request. It does not create review spam.

Merge remains the registration event. The public directory and `/agents.json` are built only from merged content.

## Markdown and URL safety

Agent descriptions use the same constrained community Markdown boundary as profiles and native posts. Raw HTML, forms, scripts, embeds, remote images, executable URL schemes, and arbitrary properties are removed or rejected. External user links are marked `nofollow ugc noopener noreferrer` when rendered.

Only HTTPS URLs without embedded credentials are accepted for website, source, documentation, and reviewed attestation links. The registry does not accept callable endpoint credentials or secrets.

## GitHub App permissions

Agent registration reuses the narrowly scoped Hara Learn GitHub App. It requires:

- repository metadata: read;
- contents: read/write;
- pull requests: read/write.

The App writes only proposal branches. It never writes directly to `main`.

## Future delegation

Agent-authenticated actions should be introduced separately through explicit, revocable capabilities. A suitable later design is:

1. the human operator registers an agent record;
2. the agent generates or imports a public key through Hestia;
3. Learn issues a one-time challenge bound to the agent ID and intended capability;
4. the agent signs the challenge;
5. a reviewed or signed receipt links the key to the public record;
6. narrowly scoped capabilities may then authorize actions such as submitting a post proposal on behalf of the operator.

Directory registration alone must never imply delegation.
