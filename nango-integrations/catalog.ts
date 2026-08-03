export const GITHUB_OAUTH_SCOPES = ["repo"] as const;

export const MANAGED_INTEGRATIONS = [
  {
    id: "github",
    provider: "github",
    displayName: "GitHub",
    forwardWebhooks: false,
    oauth: {
      scopes: GITHUB_OAUTH_SCOPES,
    },
  },
  {
    id: "granola",
    provider: "granola-mcp",
    displayName: "Granola",
    forwardWebhooks: false,
    setup: "manual" as const,
  },
  {
    id: "agent-conversations",
    provider: "authenticated-webhook",
    displayName: "Agent Conversations",
    forwardWebhooks: false,
    hidden: true,
  },
] as const;

export const MANAGED_FUNCTIONS = [
  {
    integrationId: "github",
    name: "pull-requests",
    type: "sync" as const,
    models: ["GitHubPullRequest", "GitHubRepositorySyncState"] as const,
    pipelineModels: ["GitHubPullRequest"] as const,
  },
  {
    integrationId: "granola",
    name: "meetings",
    type: "sync" as const,
    models: ["GranolaMeeting"] as const,
    pipelineModels: ["GranolaMeeting"] as const,
  },
  {
    integrationId: "agent-conversations",
    name: "conversations",
    type: "sync" as const,
    models: ["AgentConversation"] as const,
    pipelineModels: ["AgentConversation"] as const,
  },
] as const;
