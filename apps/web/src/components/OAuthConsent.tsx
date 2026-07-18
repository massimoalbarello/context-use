import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { authClient } from "../auth-client.ts";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "kb:read": "Read private knowledge pages and their history",
  "kb:write": "Create, update, and archive private pages",
  "assets:read": "Read private asset metadata and download assets",
  "assets:write": "Create private assets and upload checksum-bound content",
  "skills:read": "Discover skill names and descriptions, then load relevant instructions",
  "skills:write": "Create versioned Agent Skills",
  "automations:write": "Create scheduled automations",
  "automations:claim": "Claim due automation runs and receive their persisted skill",
  "automations:execute": "Write within a claimed automation's folder and record its outcome",
  offline_access: "Remain connected when you are away",
  openid: "Identify your owner account",
};

export function OAuthConsent() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requested = (params.get("scope") ?? "kb:read").split(/\s+/).filter(Boolean);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [client, setClient] = useState<{ client_id: string; name: string | null; uri: string | null; software_id: string | null; software_version: string | null } | null>(null);
  useEffect(() => {
    const id = params.get("client_id");
    if (id) api<typeof client>(`/api/dashboard/oauth-client-preview?client_id=${encodeURIComponent(id)}`).then(setClient).catch((cause: Error) => setError(cause.message));
  }, [params]);

  const decide = async (accept: boolean) => {
    setWorking(true);
    setError("");
    const result = await authClient.oauth2.consent({
      accept,
      scope: requested.join(" "),
      oauth_query: window.location.search.slice(1),
    });
    setWorking(false);
    if (result.error) return setError(result.error.message ?? "Consent failed");
    if (result.data?.url) window.location.assign(result.data.url);
  };

  return <main className="center-card wide">
    <span className="eyebrow">Agent connection</span>
    <h1>Allow this agent to access context-use?</h1>
    <div className="security-callout"><strong>{client?.name ?? "Unidentified MCP client"}</strong><span>Client ID: {client?.client_id ?? params.get("client_id") ?? "missing"}{client?.software_version ? ` · version ${client.software_version}` : ""}</span>{client?.uri && <span>{client.uri}</span>}</div>
    <p>The agent receives an OAuth token, never your passkey or dashboard cookie.</p>
    <ul className="scope-list">{requested.map((scope) => <li key={scope}>
      <strong>{scope}</strong><span>{SCOPE_DESCRIPTIONS[scope] ?? "Additional OAuth permission"}</span>
    </li>)}</ul>
    <div className="security-callout"><strong>Publication is impossible through OAuth.</strong><span>No requested scope can publish pages or assets.</span></div>
    {error && <p className="error">{error}</p>}
    <div className="button-row"><button disabled={working} onClick={() => decide(false)}>Deny</button><button className="primary" disabled={working} onClick={() => decide(true)}>Allow agent</button></div>
  </main>;
}
