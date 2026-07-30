import { useEffect, useState } from "react";
import { api } from "../api.ts";

export type DashboardService = {
  id: "nango";
  kind: "data-integration";
  name: "Nango";
  url: string | null;
  environment: "development" | "test" | "production";
  image_reference: string | null;
  status: "configured" | "not_configured";
};

export function ServiceCard({ service }: { service: DashboardService }) {
  const configured = service.status === "configured";
  return <article className="service-card">
    <header>
      <div><span className="service-mark" aria-hidden="true">N</span><div><strong>{service.name}</strong><small>Data integration service</small></div></div>
      <span className={`service-status ${configured ? "configured" : ""}`}>{configured ? "Configured" : "Not configured"}</span>
    </header>
    <dl>
      <div><dt>Environment</dt><dd>{service.environment}</dd></div>
      <div><dt>Image</dt><dd><code title={service.image_reference ?? undefined}>{service.image_reference ?? "Not available"}</code></dd></div>
    </dl>
    {configured && service.url
      ? <a className="button service-link" href={service.url} target="_blank" rel="noopener noreferrer">Open Nango <span aria-hidden="true">↗</span></a>
      : <p className="service-unavailable">The service will become available here after deployment.</p>}
  </article>;
}

export function IntrinsicServices() {
  const [services, setServices] = useState<DashboardService[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ services: DashboardService[] }>("/api/dashboard/services")
      .then((result) => {
        if (active) setServices(result.services);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => { active = false; };
  }, []);

  return <section className="services-settings">
    <h2>Services</h2>
    <p>Infrastructure services attached to this Context Use installation. Connections and syncs remain managed in each service&apos;s own dashboard.</p>
    {error
      ? <p className="error" role="alert">{error}</p>
      : services
        ? <div className="service-list">{services.map((service) => <ServiceCard key={service.id} service={service} />)}</div>
        : <p className="service-loading">Loading services…</p>}
  </section>;
}
