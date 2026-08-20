export {};

await import("./migrate.ts");

const templateName = process.env.CONTEXT_USE_TEMPLATE_INSTALL;
if (templateName) {
  const developmentTemplateRoot = process.env.CONTEXT_USE_DEVELOPMENT_TEMPLATE_ROOT;
  if (developmentTemplateRoot && process.env.NODE_ENV === "production") {
    throw new Error("Development knowledge templates are unavailable in production");
  }
  const { runTemplateCommand } = await import("./template-command.ts");
  await runTemplateCommand(
    "apply",
    templateName,
    false,
    developmentTemplateRoot,
  );
}
