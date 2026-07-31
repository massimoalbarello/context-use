export {};

await import("./migrate.ts");

const templateName = process.env.CONTEXT_USE_TEMPLATE_INSTALL;
if (templateName) {
  const { runTemplateCommand } = await import("./template-command.ts");
  await runTemplateCommand("apply", templateName);
}
