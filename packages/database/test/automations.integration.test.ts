import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import {
  AutomationClaimError,
  AutomationRepository,
  AutomationVersionConflictError,
} from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const mcpDatabaseUrl = process.env.MCP_DATABASE_URL;
const describeMcpDatabase = databaseUrl && mcpDatabaseUrl ? describe : describe.skip;

describeDatabase("persisted automation lifecycle", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const automations = new AutomationRepository(pool);
  const skillIds: string[] = [];

  afterAll(async () => {
    for (const skillId of skillIds) {
      await pool.query("DELETE FROM automation_runs WHERE skill_version_id IN (SELECT id FROM automation_skill_versions WHERE skill_id=$1)", [skillId]);
      await pool.query("DELETE FROM cron_schedules WHERE skill_version_id IN (SELECT id FROM automation_skill_versions WHERE skill_id=$1)", [skillId]);
      await pool.query("ALTER TABLE automation_skills DISABLE TRIGGER ALL");
      await pool.query("DELETE FROM automation_skills WHERE id=$1", [skillId]);
      await pool.query("ALTER TABLE automation_skills ENABLE TRIGGER ALL");
      await pool.query("DELETE FROM automation_skill_versions WHERE skill_id=$1", [skillId]);
    }
    await pool.end();
  });

  test("versions a skill, materializes a due run, and binds completion to the claimant", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const skill = await automations.createSkill({
      name: `Review context ${suffix}`,
      instructions_markdown: "Read the current project page and persist a short review.",
      commit_message: "Create review skill",
    }, { kind: "dashboard", subject: "integration-test-owner" });
    skillIds.push(skill.id);

    const schedule = await automations.createSchedule({
      name: `Morning review ${suffix}`,
      skill_version_id: skill.current_version_id,
      cron_expression: "0 9 * * *",
      timezone: "UTC",
      input: { project: "context-use" },
      enabled: true,
    });
    await pool.query("UPDATE cron_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1", [schedule.id]);

    const claimed = await automations.claimDueRun("agent-one");
    expect(claimed).toMatchObject({
      schedule_name: `Morning review ${suffix}`,
      skill_name: `Review context ${suffix}`,
      skill_version_number: 1,
      instructions_markdown: "Read the current project page and persist a short review.",
      input: { project: "context-use" },
      attempt_count: 1,
    });
    expect(await automations.claimDueRun("agent-two")).toBeNull();
    await expect(automations.completeRun(claimed.run_id, claimed.claim_token, "agent-two", "spoofed"))
      .rejects.toBeInstanceOf(AutomationClaimError);
    expect(await automations.completeRun(claimed.run_id, claimed.claim_token, "agent-one", "Review saved"))
      .toMatchObject({ status: "succeeded", result_summary: "Review saved" });

    const updated = await automations.updateSkill(skill.id, {
      instructions_markdown: "Read the project page, review it, and persist decisions.",
      commit_message: "Persist review decisions",
      expected_version_number: 1,
    }, { kind: "dashboard", subject: "integration-test-owner" });
    expect(updated.version_number).toBe(2);
    const schedules = await automations.listSchedules();
    expect(schedules.find((item) => item.id === schedule.id)?.skill_version_number).toBe(2);
    await pool.query("UPDATE cron_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1", [schedule.id]);
    const secondClaim = await automations.claimDueRun("agent-two");
    expect(secondClaim).toMatchObject({ skill_version_number: 2, attempt_count: 1 });
    expect(await automations.failRun(secondClaim.run_id, secondClaim.claim_token, "agent-two", "Required tool unavailable"))
      .toMatchObject({ status: "failed", error_message: "Required tool unavailable" });
    expect((await automations.listRuns()).find((run) => run.id === secondClaim.run_id))
      .toMatchObject({ status: "failed", error_message: "Required tool unavailable" });
    await expect(automations.updateSkill(skill.id, {
      instructions_markdown: "Stale edit",
      commit_message: "Attempt stale edit",
      expected_version_number: 1,
    }, { kind: "dashboard", subject: "integration-test-owner" })).rejects.toBeInstanceOf(AutomationVersionConflictError);
  });
});

describeMcpDatabase("MCP automation authoring role", () => {
  const adminPool = new Pool({ connectionString: databaseUrl });
  const mcpPool = new Pool({ connectionString: mcpDatabaseUrl });
  const automations = new AutomationRepository(mcpPool);
  let skillId: string | undefined;

  afterAll(async () => {
    if (skillId) {
      await adminPool.query("DELETE FROM automation_runs WHERE skill_version_id IN (SELECT id FROM automation_skill_versions WHERE skill_id=$1)", [skillId]);
      await adminPool.query("DELETE FROM cron_schedules WHERE skill_version_id IN (SELECT id FROM automation_skill_versions WHERE skill_id=$1)", [skillId]);
      await adminPool.query("ALTER TABLE automation_skills DISABLE TRIGGER ALL");
      await adminPool.query("DELETE FROM automation_skills WHERE id=$1", [skillId]);
      await adminPool.query("ALTER TABLE automation_skills ENABLE TRIGGER ALL");
      await adminPool.query("DELETE FROM automation_skill_versions WHERE skill_id=$1", [skillId]);
    }
    await mcpPool.end();
    await adminPool.end();
  });

  test("creates a skill and cron schedule without definition update privileges", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const skill = await automations.createSkill({
      name: `MCP review ${suffix}`,
      instructions_markdown: "Review the current project and record decisions.",
      commit_message: "Create MCP review skill",
    }, { kind: "mcp", subject: "integration-test-client" });
    skillId = skill.id;

    const schedule = await automations.createSchedule({
      name: `MCP schedule ${suffix}`,
      skill_version_id: skill.current_version_id,
      cron_expression: "0 9 * * 1-5",
      timezone: "Europe/London",
      input: { project: "context-use" },
      enabled: true,
    });

    expect(schedule).toMatchObject({
      skill_version_id: skill.current_version_id,
      cron_expression: "0 9 * * 1-5",
      timezone: "Europe/London",
    });
    await expect(automations.updateSkill(skill.id, {
      instructions_markdown: "Attempt an update.",
      commit_message: "Attempt MCP skill update",
      expected_version_number: 1,
    }, { kind: "mcp", subject: "integration-test-client" })).rejects.toThrow();
  });
});
