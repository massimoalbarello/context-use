import { useEffect, useState } from "react";
import { api } from "../api.ts";

type DashboardHealth = {
  status: "ok";
  version: string;
  service: "dashboard";
};

export function releaseLabel(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

export function ReleaseBadge({ version }: { version: string | null }) {
  return <div className="running-release" aria-label="Running release">
    <span>Release</span>
    <strong>{version ? releaseLabel(version) : "Unavailable"}</strong>
  </div>;
}

export function RunningRelease() {
  const [version, setVersion] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api<DashboardHealth>("/api/health")
      .then((health) => {
        if (active) setVersion(health.version);
      })
      .catch(() => {
        if (active) setVersion(null);
      });
    return () => { active = false; };
  }, []);

  return version === undefined
    ? <div className="running-release loading" aria-label="Running release" aria-busy="true"><span>Release</span><strong>Loading…</strong></div>
    : <ReleaseBadge version={version} />;
}
