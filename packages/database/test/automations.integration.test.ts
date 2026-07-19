import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  AutomationContentAccessError,
  AutomationClaimError,
  AutomationRepository,
  AutomationValidationError,
  AutomationVersionConflictError,
  PageRepository,
} from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const mcpDatabaseUrl = process.env.MCP_DATABASE_URL;
const describeMcpDatabase = databaseUrl && mcpDatabaseUrl ? describe : describe.skip;

describeDatabase("persisted automation lifecycle", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const automations = new AutomationRepository(pool);
  const pages = new PageRepository(pool);
  const skillIds: string[] = [];
  const scheduleIds: string[] = [];
  const pageIds: string[] = [];

  afterAll(async () => {
    for (const pageId of pageIds) {
      await pool.query("ALTER TABLE knowledge_pages DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_pages WHERE id=$1", [pageId]);
      await pool.query("ALTER TABLE knowledge_pages ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM knowledge_page_versions WHERE page_id=$1", [pageId]);
    }
    for (const scheduleId of scheduleIds) {
      await pool.query("DELETE FROM automation_runs WHERE schedule_id=$1", [scheduleId]);
      await pool.query("ALTER TABLE cron_schedules DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM cron_schedules WHERE id=$1", [scheduleId]);
      await pool.query("ALTER TABLE cron_schedules ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM automation_versions WHERE automation_id=$1", [scheduleId]);
    }
    for (const skillId of skillIds) {
      await pool.query("ALTER TABLE agent_skills DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM agent_skills WHERE id=$1", [skillId]);
      await pool.query("ALTER TABLE agent_skills ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM agent_skill_versions WHERE skill_id=$1", [skillId]);
    }
    await pool.end();
  });

  test("versions automation-owned instructions, materializes a due run, and binds completion to the claimant", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const skill = await automations.createSkill({
      name: `review-context-${suffix}`,
      description: "Reviews current project context. Use for a scheduled project health check.",
      instructions_markdown: "Read the current project page and persist a short review.",
      commit_message: "Create review skill",
    }, { kind: "dashboard", subject: "integration-test-owner" });
    skillIds.push(skill.id);
    expect(skill.instructions_markdown).toBe("Read the current project page and persist a short review.");
    expect(skill.skill_markdown).not.toContain("## Execution context");

    const schedule = await automations.createSchedule({
      name: `Morning review ${suffix}`,
      automation_key: `morning-review-${suffix}`,
      instructions_markdown: "Read the current project page and persist a short review.",
      commit_message: "Create morning review automation",
      cron_expression: "0 9 * * *",
      timezone: "UTC",
      input: { project: "context-use" },
      enabled: true,
    }, { kind: "dashboard", subject: "integration-test-owner" });
    scheduleIds.push(schedule.id);
    expect(schedule).toMatchObject({
      automation_key: `morning-review-${suffix}`,
      knowledge_path: `automations/morning-review-${suffix}`,
      automation_version_number: 1,
      instructions_markdown: "Read the current project page and persist a short review.",
    });
    await expect(automations.createSchedule({
      name: `Duplicate key ${suffix}`,
      automation_key: `morning-review-${suffix}`,
      instructions_markdown: "Duplicate review.",
      commit_message: "Create duplicate automation",
      cron_expression: "0 10 * * *",
      timezone: "UTC",
      input: {},
      enabled: true,
    }, { kind: "dashboard", subject: "integration-test-owner" })).rejects.toBeInstanceOf(AutomationValidationError);
    await expect(pool.query(
      "UPDATE cron_schedules SET automation_key=$2 WHERE id=$1",
      [schedule.id, `changed-review-${suffix}`],
    )).rejects.toThrow();
    await pool.query("UPDATE cron_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1", [schedule.id]);

    const claimed = await automations.claimDueRun("agent-one");
    expect(claimed).toMatchObject({
      schedule_name: `Morning review ${suffix}`,
      knowledge_path: `automations/morning-review-${suffix}`,
      automation_version_number: 1,
      input: { project: "context-use" },
      attempt_count: 1,
    });
    expect(claimed.instructions_markdown).toStartWith("Read the current project page and persist a short review.");
    expect(claimed.instructions_markdown.match(/## Execution context/g)).toHaveLength(1);
    expect(claimed.instructions_markdown).toContain("`claim_due_run`");
    expect(claimed.instructions_markdown).toContain("[[me/intro]]");
    expect(claimed).not.toHaveProperty("skill_markdown");
    expect(await automations.claimDueRun("agent-two")).toBeNull();

    const generated = await pages.createForAutomation({
      run_id: claimed.run_id,
      claim_token: claimed.claim_token,
      relative_path: "reviews/latest",
      title: "Latest project review",
      body_markdown: "Related to [[projects/context-use]].",
      commit_message: "Create generated review",
    }, { kind: "mcp", subject: "agent-one" });
    pageIds.push(generated.id);
    expect(generated).toMatchObject({
      automation_id: schedule.id,
      current_path: `automations/morning-review-${suffix}/reviews/latest`,
    });
    await expect(pages.create({
      path: "notes/outside-automation-folder",
      title: "Outside automation folder",
      body_markdown: "Must fail while the client holds a run claim.",
      commit_message: "Attempt generic run output",
    }, { kind: "mcp", subject: "agent-one" })).rejects.toBeInstanceOf(AutomationContentAccessError);
    await expect(pages.update(generated.id, {
      path: generated.current_path,
      title: generated.title,
      body_markdown: "Attempt a generic update.",
      commit_message: "Attempt generic update",
      expected_version_number: generated.version_number,
    }, { kind: "mcp", subject: "agent-one" })).rejects.toBeInstanceOf(AutomationContentAccessError);
    await expect(pool.query(
      `INSERT INTO publication_intents(
        id,action,target_kind,target_id,version_id,public_path,owner_user_id,
        session_id,challenge,payload_hash,expires_at
       ) VALUES ($1,'publish','page',$2,$3,$6,'owner','session',$4,$5,now()+interval '5 minutes')`,
      [crypto.randomUUID(), generated.id, generated.current_version_id, `challenge-${crypto.randomUUID()}`, "a".repeat(64), generated.current_path],
    )).rejects.toThrow();

    await expect(automations.completeRun(claimed.run_id, claimed.claim_token, "agent-two", "spoofed"))
      .rejects.toBeInstanceOf(AutomationClaimError);
    expect(await automations.completeRun(claimed.run_id, claimed.claim_token, "agent-one", "Review saved"))
      .toMatchObject({ status: "succeeded", result_summary: "Review saved" });
    expect(await pages.update(generated.id, {
      path: generated.current_path,
      title: generated.title,
      body_markdown: "Attempt a generic update after completion.",
      commit_message: "Attempt generic update",
      expected_version_number: generated.version_number,
    }, { kind: "mcp", subject: "agent-one" })).toBeNull();
    await expect(pages.create({
      path: `automations/morning-review-${suffix}/unowned`,
      title: "Unowned generated page",
      body_markdown: "Must fail.",
      commit_message: "Attempt reserved path",
    }, { kind: "mcp", subject: "agent-one" })).rejects.toThrow();
    await expect(pages.updateForAutomation({
      run_id: claimed.run_id,
      claim_token: claimed.claim_token,
      page_id: generated.id,
      relative_path: "reviews/latest",
      title: "Expired update",
      body_markdown: "Must fail after completion.",
      commit_message: "Attempt expired update",
      expected_version_number: generated.version_number,
    }, { kind: "mcp", subject: "agent-one" })).rejects.toBeInstanceOf(AutomationContentAccessError);

    const updated = await automations.updateSkill(skill.id, {
      description: "Reviews project context and records decisions. Use for a scheduled project health check.",
      instructions_markdown: "Read the project page, review it, and persist decisions.",
      commit_message: "Persist review decisions",
      expected_version_number: 1,
    }, { kind: "dashboard", subject: "integration-test-owner" });
    expect(updated.version_number).toBe(2);
    expect((await automations.listSchedules()).find((item) => item.id === schedule.id))
      .toMatchObject({ automation_version_number: 1, instructions_markdown: "Read the current project page and persist a short review." });

    const updatedAutomation = await automations.updateSchedule(schedule.id, {
      name: `Morning review ${suffix}`,
      instructions_markdown: "Read the project page, review it, and persist decisions.",
      commit_message: "Persist review decisions",
      cron_expression: "0 9 * * *",
      timezone: "UTC",
      input: { project: "context-use" },
      enabled: true,
      expected_version_number: 1,
    }, { kind: "dashboard", subject: "integration-test-owner" });
    expect(updatedAutomation).toMatchObject({
      automation_version_number: 2,
      instructions_markdown: "Read the project page, review it, and persist decisions.",
    });
    await pool.query("UPDATE cron_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1", [schedule.id]);
    const secondClaim = await automations.claimDueRun("agent-two");
    expect(secondClaim).toMatchObject({ automation_version_number: 2, attempt_count: 1 });
    expect(secondClaim.instructions_markdown).toStartWith("Read the project page, review it, and persist decisions.");
    expect(await automations.failRun(secondClaim.run_id, secondClaim.claim_token, "agent-two", "Required tool unavailable"))
      .toMatchObject({ status: "failed", error_message: "Required tool unavailable" });
    expect((await automations.listRuns()).find((run) => run.id === secondClaim.run_id))
      .toMatchObject({ status: "failed", error_message: "Required tool unavailable" });
    await expect(automations.updateSkill(skill.id, {
      description: "Attempts a stale update. Use only in this test.",
      instructions_markdown: "Stale edit",
      commit_message: "Attempt stale edit",
      expected_version_number: 1,
    }, { kind: "dashboard", subject: "integration-test-owner" })).rejects.toBeInstanceOf(AutomationVersionConflictError);
    await expect(automations.updateSchedule(schedule.id, {
      name: `Stale morning review ${suffix}`,
      instructions_markdown: "Stale automation instructions.",
      commit_message: "Attempt stale automation edit",
      cron_expression: "0 10 * * *",
      timezone: "UTC",
      input: {},
      enabled: true,
      expected_version_number: 1,
    }, { kind: "dashboard", subject: "integration-test-owner" })).rejects.toBeInstanceOf(AutomationVersionConflictError);

    expect(await automations.deleteSkill(skill.id)).toMatchObject({ id: skill.id });
    expect((await automations.listSkills()).some((item) => item.id === skill.id)).toBe(false);
    expect(await automations.deleteSchedule(schedule.id)).toMatchObject({ id: schedule.id });
    expect((await automations.listSchedules()).some((item) => item.id === schedule.id)).toBe(false);
    expect((await automations.listRuns()).some((run) => run.schedule_id === schedule.id)).toBe(false);
    expect((await pool.query("SELECT enabled,deleted_at FROM cron_schedules WHERE id=$1", [schedule.id])).rows[0])
      .toMatchObject({ enabled: false, deleted_at: expect.any(Date) });

    expect((await pool.query("SELECT count(*)::integer AS count FROM agent_skill_versions WHERE skill_id=$1", [skill.id])).rows[0]?.count)
      .toBe(2);
    expect((await pool.query("SELECT count(*)::integer AS count FROM automation_versions WHERE automation_id=$1", [schedule.id])).rows[0]?.count)
      .toBe(2);
  });
});

describeMcpDatabase("MCP automation authoring role", () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const mcpPool = new Pool({ connectionString: mcpDatabaseUrl });
  const automations = new AutomationRepository(mcpPool);
  let skillId: string | undefined;
  let scheduleId: string | undefined;

  afterAll(async () => {
    if (scheduleId) {
      await adminPool.query("DELETE FROM automation_runs WHERE schedule_id=$1", [scheduleId]);
      await adminPool.query("ALTER TABLE cron_schedules DISABLE TRIGGER ALL");
      await adminPool.query("DELETE FROM cron_schedules WHERE id=$1", [scheduleId]);
      await adminPool.query("ALTER TABLE cron_schedules ENABLE TRIGGER ALL");
      await adminPool.query("DELETE FROM automation_versions WHERE automation_id=$1", [scheduleId]);
    }
    if (skillId) {
      await adminPool.query("ALTER TABLE agent_skills DISABLE TRIGGER ALL");
      await adminPool.query("DELETE FROM agent_skills WHERE id=$1", [skillId]);
      await adminPool.query("ALTER TABLE agent_skills ENABLE TRIGGER ALL");
      await adminPool.query("DELETE FROM agent_skill_versions WHERE skill_id=$1", [skillId]);
    }
    await mcpPool.end();
    await adminPool.end();
  });

  test("creates a skill and cron schedule without definition update privileges", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const skill = await automations.createSkill({
      name: `mcp-review-${suffix}`,
      description: "Reviews project context. Use for an MCP-created scheduled review.",
      instructions_markdown: "Review the current project and record decisions.",
      commit_message: "Create MCP review skill",
    }, { kind: "mcp", subject: "integration-test-client" });
    skillId = skill.id;

    const schedule = await automations.createSchedule({
      name: `MCP schedule ${suffix}`,
      automation_key: `mcp-schedule-${suffix}`,
      instructions_markdown: "Review the current project and record decisions.",
      commit_message: "Create MCP review automation",
      cron_expression: "0 9 * * 1-5",
      timezone: "Europe/London",
      input: { project: "context-use" },
      enabled: true,
    }, { kind: "mcp", subject: "integration-test-client" });
    scheduleId = schedule.id;

    expect(schedule).toMatchObject({
      automation_version_number: 1,
      instructions_markdown: "Review the current project and record decisions.",
      cron_expression: "0 9 * * 1-5",
      timezone: "Europe/London",
    });
    await expect(automations.updateSkill(skill.id, {
      description: "Attempts an MCP update. Use only in this test.",
      instructions_markdown: "Attempt an update.",
      commit_message: "Attempt MCP skill update",
      expected_version_number: 1,
    }, { kind: "mcp", subject: "integration-test-client" })).rejects.toThrow();
    await expect(automations.updateSchedule(schedule.id, {
      name: `MCP schedule ${suffix}`,
      instructions_markdown: "Attempt an automation update.",
      commit_message: "Attempt MCP automation update",
      cron_expression: "0 10 * * 1-5",
      timezone: "Europe/London",
      input: {},
      enabled: true,
      expected_version_number: 1,
    }, { kind: "mcp", subject: "integration-test-client" })).rejects.toThrow();
  });
});
