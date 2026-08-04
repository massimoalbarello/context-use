import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { agentSyncLogDirectory, launchAgentLabel, launchAgentPath } from "./paths.ts";

type RunCommand = (command: string[]) => Promise<void>;

export function renderLaunchAgent(executable = process.execPath): string {
  const escapedExecutable = xml(executable);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${launchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapedExecutable}</string>
    <string>agent-sync</string>
    <string>sync-now</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(`${agentSyncLogDirectory}/stdout.log`)}</string>
  <key>StandardErrorPath</key><string>${xml(`${agentSyncLogDirectory}/stderr.log`)}</string>
</dict>
</plist>
`;
}

export async function installLaunchAgent(
  executable = process.execPath,
  runCommand: RunCommand = defaultRunCommand,
): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Agent sync currently supports macOS only");
  await mkdir(dirname(launchAgentPath), { recursive: true });
  await mkdir(agentSyncLogDirectory, { recursive: true, mode: 0o700 });
  await Bun.write(launchAgentPath, renderLaunchAgent(executable), { mode: 0o600 });
  await chmod(launchAgentPath, 0o600);
  await runCommand(["launchctl", "bootout", `gui/${process.getuid?.() ?? 0}/${launchAgentLabel}`]).catch(() => {});
  await runCommand(["launchctl", "bootstrap", `gui/${process.getuid?.() ?? 0}`, launchAgentPath]);
}

export async function uninstallLaunchAgent(runCommand: RunCommand = defaultRunCommand): Promise<void> {
  if (process.platform === "darwin") {
    await runCommand(["launchctl", "bootout", `gui/${process.getuid?.() ?? 0}/${launchAgentLabel}`]).catch(() => {});
  }
  await rm(launchAgentPath, { force: true });
}

export async function launchAgentLoaded(runCommand: RunCommand = defaultRunCommand): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await runCommand(["launchctl", "print", `gui/${process.getuid?.() ?? 0}/${launchAgentLabel}`]);
    return true;
  } catch {
    return false;
  }
}

async function defaultRunCommand(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${command[0]} exited with status ${exitCode}`);
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
