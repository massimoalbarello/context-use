import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceCard, type DashboardService } from "./Services.tsx";

const configured: DashboardService = {
  id: "nango",
  kind: "data-integration",
  name: "Nango",
  url: "https://nango.context.example.com",
  environment: "production",
  image_reference: "ghcr.io/example/nango@sha256:abc123",
  status: "configured",
};

describe("intrinsic service card", () => {
  test("shows Nango deployment metadata and a safe external dashboard link", () => {
    const html = renderToStaticMarkup(<ServiceCard service={configured} />);
    expect(html).toContain("Nango");
    expect(html).toContain("Configured");
    expect(html).toContain("production");
    expect(html).toContain("ghcr.io/example/nango@sha256:abc123");
    expect(html).toContain('href="https://nango.context.example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("password");
    expect(html).not.toContain("api_key");
  });

  test("does not render an external link before the service is configured", () => {
    const html = renderToStaticMarkup(<ServiceCard service={{
      ...configured,
      url: null,
      image_reference: null,
      status: "not_configured",
    }} />);
    expect(html).toContain("Not configured");
    expect(html).toContain("after deployment");
    expect(html).not.toContain("href=");
  });
});
