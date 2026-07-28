import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { AutomationContentAccessError, AutomationRepository, PageRepository } from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("automation write scopes", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const automations = new AutomationRepository(pool);
  const pages = new PageRepository(pool);
  const scheduleIds: string[] = [];
  const pagePaths: string[] = [];
  const directoryPaths: string[] = [];

  afterAll(async () => {
    for (const path of pagePaths) {
      const page = await pool.query<{ id: string }>("SELECT id FROM knowledge_pages WHERE current_path=$1", [path]);
      const id = page.rows[0]?.id;
      if (!id) continue;
      await pool.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_pages WHERE id=$1", [id]);
      await pool.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=$1", [id]);
    }
    for (const path of directoryPaths) {
      await pool.query("DELETE FROM knowledge_directories WHERE current_path=$1", [path]);
    }
    for (const scheduleId of scheduleIds) {
      const schedule = await pool.query<{ instructions_page_id: string; automation_key: string }>(
        "SELECT instructions_page_id,automation_key FROM cron_schedules WHERE id=$1",
        [scheduleId],
      );
      const row = schedule.rows[0];
      await pool.query("DELETE FROM automation_runs WHERE schedule_id=$1", [scheduleId]);
      await pool.query("UPDATE cron_schedules SET current_version_id=NULL WHERE id=$1", [scheduleId]).catch(() => {});
      await pool.query("DELETE FROM cron_schedules WHERE id=$1", [scheduleId]).catch(() => {});
      await pool.query("DELETE FROM automation_versions WHERE automation_id=$1", [scheduleId]).catch(() => {});
      if (row?.instructions_page_id) {
        await pool.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
        await pool.query("DELETE FROM knowledge_pages WHERE id=$1", [row.instructions_page_id]);
        await pool.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
        await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=$1", [row.instructions_page_id]);
        await pool.query("DELETE FROM knowledge_directories WHERE current_path=$1", [`automations/${row.automation_key}`]);
      }
    }
    await pool.end();
  });

  async function claimableAutomation(suffix: string, writeScope: string[]) {
    const schedule = await automations.createSchedule({
      name: `Services digest ${suffix}`,
      automation_key: `services-digest-${suffix}`,
      instructions_markdown: "Summarise what happened today across connected services.",
      commit_message: "Create services digest automation",
      cron_expression: "30 22 * * *",
      timezone: "Europe/London",
      input: {},
      enabled: true,
      write_scope: writeScope,
    }, { kind: "dashboard", subject: "integration-test-owner" });
    scheduleIds.push(schedule.id);
    await pool.query("UPDATE cron_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1", [schedule.id]);
    const claimed = await automations.claimDueRun(`agent-${suffix}`);
    if (!claimed) throw new Error("Expected a claimable run");
    return { schedule, claimed };
  }

  test("writes its output into the day it is about, and materialises that day", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { claimed } = await claimableAutomation(suffix, [
      "about/diary/{YYYY}/{MM}/{DD}/services-digest",
      "about/diary/{YYYY}/{MM}/{DD}/log",
    ]);

    // The run is handed concrete paths, not templates to expand itself.
    const digestPath = claimed.write_scope_resolved.find((path: string) => path.endsWith("/services-digest"));
    const logPath = claimed.write_scope_resolved.find((path: string) => path.endsWith("/log"));
    expect(digestPath).toMatch(/^about\/diary\/\d{4}\/\d{2}\/\d{2}\/services-digest$/);
    pagePaths.push(digestPath!, logPath!);

    const digest = await pages.createForAutomation({
      run_id: claimed.run_id,
      claim_token: claimed.claim_token,
      path: digestPath!,
      title: "Services digest",
      summary: "What the connected services showed for the day.",
      body_markdown: "Written by the services-digest automation.",
      commit_message: "Write services digest",
    }, { kind: "mcp", subject: `agent-${suffix}` });
    expect(digest.current_path).toBe(digestPath!);
    expect(digest.automation_id).toBeTruthy();

    const dayPath = digestPath!.slice(0, digestPath!.lastIndexOf("/"));
    directoryPaths.push(dayPath, dayPath.slice(0, dayPath.lastIndexOf("/")));

    // The day, its month and its year exist with titles computed from the date.
    const directories = await pool.query<{ current_path: string; title: string }>(
      "SELECT current_path,title FROM knowledge_directories WHERE current_path=$1",
      [dayPath],
    );
    expect(directories.rows[0]?.title).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{1,2} \w+ \d{4}$/);

    // The day's log is opened by the first write into the day, and belongs to
    // the owner rather than to the automation that triggered it.
    const log = await pool.query<{ automation_id: string | null; body_markdown: string }>(
      `SELECT page.automation_id,version.body_markdown
       FROM knowledge_pages page
       JOIN knowledge_page_versions version ON version.id=page.current_version_id
       WHERE page.current_path=$1`,
      [logPath!],
    );
    expect(log.rowCount).toBe(1);
    expect(log.rows[0]?.automation_id).toBeNull();
    expect(log.rows[0]?.body_markdown).toContain("## Companion pages");
  });

  test("refuses a path outside the granted scope", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { claimed } = await claimableAutomation(suffix, ["about/diary/{YYYY}/{MM}/{DD}/services-digest"]);
    await expect(pages.createForAutomation({
      run_id: claimed.run_id,
      claim_token: claimed.claim_token,
      path: "about/intro",
      title: "Hijacked intro",
      summary: "Should never be written.",
      body_markdown: "No.",
      commit_message: "Attempt an out-of-scope write",
    }, { kind: "mcp", subject: `agent-${suffix}` })).rejects.toThrow(/outside this automation's write scope/);
  });

  test("keeps its own folder without declaring anything, and nothing else", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { claimed } = await claimableAutomation(suffix, []);
    expect(claimed.write_scope_resolved).toEqual([`automations/services-digest-${suffix}/**`]);
    const generated = await pages.createForAutomation({
      run_id: claimed.run_id,
      claim_token: claimed.claim_token,
      path: `automations/services-digest-${suffix}/reports/latest`,
      title: "Latest report",
      summary: "Output an automation can always write, with no grant at all.",
      body_markdown: "Its own folder needs no declaring.",
      commit_message: "Write report",
    }, { kind: "mcp", subject: `agent-${suffix}` });
    expect(generated.current_path).toBe(`automations/services-digest-${suffix}/reports/latest`);
    pagePaths.push(generated.current_path);
    directoryPaths.push(`automations/services-digest-${suffix}/reports`);

    await expect(pages.createForAutomation({
      run_id: claimed.run_id,
      claim_token: claimed.claim_token,
      path: "about/diary/2026/07/27/services-digest",
      title: "Out of scope",
      summary: "An automation with no declared scope keeps only its own folder.",
      body_markdown: "No.",
      commit_message: "Attempt a diary write without a grant",
    }, { kind: "mcp", subject: `agent-${suffix}` })).rejects.toThrow(AutomationContentAccessError);
  });

});
