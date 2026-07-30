export type DashboardServiceMetadata = {
  id: "nango";
  kind: "data-integration";
  name: "Nango";
  url: string | null;
  environment: "development" | "test" | "production";
  image_reference: string | null;
  status: "configured" | "not_configured";
};

type ServiceConfig = {
  NODE_ENV: DashboardServiceMetadata["environment"];
  NANGO_PUBLIC_URL: string;
  NANGO_IMAGE_REFERENCE: string;
};

export function dashboardServices(config: ServiceConfig): DashboardServiceMetadata[] {
  const configured = Boolean(config.NANGO_PUBLIC_URL && config.NANGO_IMAGE_REFERENCE);
  return [{
    id: "nango",
    kind: "data-integration",
    name: "Nango",
    url: config.NANGO_PUBLIC_URL || null,
    environment: config.NODE_ENV,
    image_reference: config.NANGO_IMAGE_REFERENCE || null,
    status: configured ? "configured" : "not_configured",
  }];
}
