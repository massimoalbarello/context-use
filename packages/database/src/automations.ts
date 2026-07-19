import { randomUUID } from "node:crypto";
import type {
  Actor,
  CreateAutomationSkillInput,
  CreateCronScheduleInput,
  UpdateAutomationSkillInput,
  UpdateCronScheduleInput,
} from "@context-use/shared";
import { Cron } from "croner";
import type { Pool, PoolClient } from "pg";

const RUN_LEASE_HOURS = 6;

function skillMarkdown(name: string, description: string, instructions: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}`;
}

function withSkillMarkdown<T extends {
  name?: string;
  skill_name?: string;
  description: string;
  instructions_markdown: string;
}>(skill: T) {
  const name = skill.name ?? skill.skill_name;
  if (!name) throw new Error("Skill name is missing");
  return {
    ...skill,
    skill_markdown: skillMarkdown(name, skill.description, skill.instructions_markdown),
  };
}

export class AutomationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationValidationError";
  }
}

export class AutomationVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`Skill changed; current version is ${currentVersion}`);
    this.name = "AutomationVersionConflictError";
  }
}

export class AutomationSkillInUseError extends Error {
  constructor(readonly scheduleCount: number) {
    super(`Delete ${scheduleCount === 1 ? "its automation" : `its ${scheduleCount} automations`} before deleting this skill`);
    this.name = "AutomationSkillInUseError";
  }
}

export class AutomationClaimError extends Error {
  constructor() {
    super("The automation run is no longer claimed by this agent");
    this.name = "AutomationClaimError";
  }
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function nextCronOccurrence(expression: string, timezone: string, after = new Date()): Date {
  if (expression.trim().split(/\s+/).length !== 5) {
    throw new AutomationValidationError("Cron expressions must contain exactly five fields: minute hour day month weekday");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(after);
    const next = new Cron(expression, { timezone, mode: "5-part", paused: true }).nextRun(after);
    if (!next) throw new Error("No future occurrence");
    return next;
  } catch (error) {
    if (error instanceof AutomationValidationError) throw error;
    throw new AutomationValidationError("Cron expression or time zone is invalid");
  }
}

async function materializeDueRuns(client: PoolClient, now: Date): Promise<void> {
  const due = await client.query<{
    id: string;
    skill_version_id: string;
    cron_expression: string;
    timezone: string;
    input: Record<string, unknown>;
    next_run_at: Date;
  }>(
    `SELECT id,skill_version_id,cron_expression,timezone,input,next_run_at
     FROM cron_schedules
     WHERE enabled=true AND deleted_at IS NULL AND next_run_at <= $1
     ORDER BY next_run_at
     FOR UPDATE`,
    [now],
  );

  for (const schedule of due.rows) {
    await client.query(
      `INSERT INTO automation_runs(id,schedule_id,skill_version_id,scheduled_for,input)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (schedule_id,scheduled_for) DO NOTHING`,
      [randomUUID(), schedule.id, schedule.skill_version_id, schedule.next_run_at, schedule.input],
    );
    // The first version records one catch-up run and skips any additional occurrences
    // missed while no agent or dashboard was polling.
    const nextRunAt = nextCronOccurrence(schedule.cron_expression, schedule.timezone, now);
    await client.query(
      `UPDATE cron_schedules SET next_run_at=$2,updated_at=$3 WHERE id=$1`,
      [schedule.id, nextRunAt, now],
    );
  }
}

const SKILL_SELECT = `
  SELECT skill.id,skill.name,skill.current_version_id,skill.created_at,skill.updated_at,
    version.version_number,version.description,version.instructions_markdown,version.commit_message,
    version.created_at AS version_created_at,
    (SELECT count(*)::integer
     FROM cron_schedules schedule
     JOIN automation_skill_versions scheduled_version ON scheduled_version.id=schedule.skill_version_id
     WHERE scheduled_version.skill_id=skill.id AND schedule.deleted_at IS NULL) AS schedule_count
  FROM automation_skills skill
  JOIN automation_skill_versions version ON version.id=skill.current_version_id AND version.skill_id=skill.id
`;

export class AutomationRepository {
  constructor(private readonly pool: Pool) {}

  async listSkills() {
    const result = await this.pool.query(`${SKILL_SELECT} WHERE skill.deleted_at IS NULL ORDER BY lower(skill.name)`);
    return result.rows.map(withSkillMarkdown);
  }

  async getSkill(skillId: string) {
    const result = await this.pool.query(`${SKILL_SELECT} WHERE skill.id=$1 AND skill.deleted_at IS NULL`, [skillId]);
    return result.rows[0] ? withSkillMarkdown(result.rows[0]) : null;
  }

  async createSkill(input: CreateAutomationSkillInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const skillId = randomUUID();
      const versionId = randomUUID();
      await client.query(
        `INSERT INTO automation_skills(id,name,current_version_id) VALUES ($1,$2,$3)`,
        [skillId, input.name, versionId],
      );
      await client.query(
        `INSERT INTO automation_skill_versions(
           id,skill_id,version_number,description,instructions_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,$4,$5,$6,$7)`,
        [versionId, skillId, input.description, input.instructions_markdown, input.commit_message, actor.kind, actor.subject],
      );
      const result = await client.query(`${SKILL_SELECT} WHERE skill.id=$1`, [skillId]);
      return withSkillMarkdown(result.rows[0]);
    });
  }

  async updateSkill(skillId: string, input: UpdateAutomationSkillInput, actor: Actor) {
    return transaction(this.pool, async (client) => {
      const current = await client.query<{ current_version_id: string; version_number: number }>(
        `SELECT skill.current_version_id,version.version_number
         FROM automation_skills skill
         JOIN automation_skill_versions version ON version.id=skill.current_version_id
         WHERE skill.id=$1 AND skill.deleted_at IS NULL FOR UPDATE OF skill`,
        [skillId],
      );
      if (!current.rowCount) return null;
      const row = current.rows[0]!;
      if (row.version_number !== input.expected_version_number) {
        throw new AutomationVersionConflictError(row.version_number);
      }
      const versionId = randomUUID();
      await client.query(
        `INSERT INTO automation_skill_versions(
           id,skill_id,version_number,description,instructions_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [versionId, skillId, row.version_number + 1, input.description, input.instructions_markdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `UPDATE automation_skills SET current_version_id=$2,updated_at=now() WHERE id=$1`,
        [skillId, versionId],
      );
      // Updating a skill advances its schedules, while already-created runs remain pinned.
      await client.query(
        `UPDATE cron_schedules SET skill_version_id=$2,updated_at=now()
         WHERE skill_version_id=$1 AND deleted_at IS NULL`,
        [row.current_version_id, versionId],
      );
      const result = await client.query(`${SKILL_SELECT} WHERE skill.id=$1`, [skillId]);
      return withSkillMarkdown(result.rows[0]);
    });
  }

  async deleteSkill(skillId: string) {
    return transaction(this.pool, async (client) => {
      const skill = await client.query<{ id: string }>(
        `SELECT id FROM automation_skills
         WHERE id=$1 AND deleted_at IS NULL
         FOR UPDATE`,
        [skillId],
      );
      if (!skill.rowCount) return null;
      const schedules = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM cron_schedules schedule
         JOIN automation_skill_versions version ON version.id=schedule.skill_version_id
         WHERE version.skill_id=$1 AND schedule.deleted_at IS NULL`,
        [skillId],
      );
      const scheduleCount = schedules.rows[0]?.count ?? 0;
      if (scheduleCount) throw new AutomationSkillInUseError(scheduleCount);
      const deleted = await client.query(
        `UPDATE automation_skills SET deleted_at=now(),updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL
         RETURNING id,deleted_at`,
        [skillId],
      );
      return deleted.rows[0] ?? null;
    });
  }

  async listSchedules() {
    const result = await this.pool.query(
      `SELECT schedule.id,schedule.name,schedule.skill_version_id,schedule.cron_expression,schedule.timezone,
        schedule.input,schedule.enabled,schedule.next_run_at,schedule.knowledge_path,schedule.created_at,schedule.updated_at,
        skill.id AS skill_id,skill.name AS skill_name,version.version_number AS skill_version_number,
        count(run.id) FILTER (WHERE run.status='ready')::integer AS ready_count,
        count(run.id) FILTER (WHERE run.status='claimed')::integer AS claimed_count,
        max(run.completed_at) FILTER (WHERE run.status IN ('succeeded','failed')) AS last_completed_at,
        (SELECT count(*)::integer FROM knowledge_pages page
         WHERE page.automation_id=schedule.id AND page.archived_at IS NULL) AS generated_page_count
       FROM cron_schedules schedule
       JOIN automation_skill_versions version ON version.id=schedule.skill_version_id
       JOIN automation_skills skill ON skill.id=version.skill_id
       LEFT JOIN automation_runs run ON run.schedule_id=schedule.id
       WHERE schedule.deleted_at IS NULL AND skill.deleted_at IS NULL
       GROUP BY schedule.id,skill.id,skill.name,version.version_number
       ORDER BY lower(schedule.name)`,
    );
    return result.rows;
  }

  async createSchedule(input: CreateCronScheduleInput) {
    const nextRunAt = nextCronOccurrence(input.cron_expression, input.timezone);
    const result = await this.pool.query(
      `INSERT INTO cron_schedules(
         id,name,skill_version_id,cron_expression,timezone,input,enabled,next_run_at
       )
       SELECT $1,$2,version.id,$4,$5,$6,$7,$8
       FROM automation_skill_versions version
       JOIN automation_skills skill ON skill.id=version.skill_id
       WHERE version.id=$3 AND skill.deleted_at IS NULL
       RETURNING *`,
      [randomUUID(), input.name, input.skill_version_id, input.cron_expression, input.timezone, input.input, input.enabled, nextRunAt],
    );
    if (!result.rowCount) throw new AutomationValidationError("Selected skill is not available");
    return result.rows[0];
  }

  async updateSchedule(scheduleId: string, input: UpdateCronScheduleInput) {
    const nextRunAt = nextCronOccurrence(input.cron_expression, input.timezone);
    const skill = await this.pool.query(
      `SELECT 1
       FROM automation_skill_versions version
       JOIN automation_skills skill ON skill.id=version.skill_id
       WHERE version.id=$1 AND skill.deleted_at IS NULL`,
      [input.skill_version_id],
    );
    if (!skill.rowCount) throw new AutomationValidationError("Selected skill is not available");
    const result = await this.pool.query(
      `UPDATE cron_schedules SET
         name=$2,skill_version_id=$3,cron_expression=$4,timezone=$5,input=$6,enabled=$7,
         next_run_at=$8,updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
      [scheduleId, input.name, input.skill_version_id, input.cron_expression, input.timezone, input.input, input.enabled, nextRunAt],
    );
    return result.rows[0] ?? null;
  }

  async deleteSchedule(scheduleId: string) {
    const result = await this.pool.query(
      `UPDATE cron_schedules
       SET enabled=false,deleted_at=now(),updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL
       RETURNING id,knowledge_path,deleted_at`,
      [scheduleId],
    );
    return result.rows[0] ?? null;
  }

  async listRuns(limit = 200) {
    return transaction(this.pool, async (client) => {
      await materializeDueRuns(client, new Date());
      const result = await client.query(
        `SELECT run.id,run.schedule_id,run.skill_version_id,run.scheduled_for,run.input,run.status,
          run.attempt_count,run.claimed_by,run.claimed_at,run.lease_expires_at,run.completed_at,
          run.result_summary,run.error_message,run.created_at,
          schedule.name AS schedule_name,skill.id AS skill_id,skill.name AS skill_name,
          version.version_number AS skill_version_number
         FROM automation_runs run
         JOIN cron_schedules schedule ON schedule.id=run.schedule_id
         JOIN automation_skill_versions version ON version.id=run.skill_version_id
         JOIN automation_skills skill ON skill.id=version.skill_id
         WHERE schedule.deleted_at IS NULL AND skill.deleted_at IS NULL
         ORDER BY run.scheduled_for DESC
         LIMIT $1`,
        [limit],
      );
      return result.rows;
    });
  }

  async claimDueRun(clientId: string) {
    return transaction(this.pool, async (client) => {
      const now = new Date();
      await materializeDueRuns(client, now);
      const candidate = await client.query<{ id: string }>(
        `SELECT run.id FROM automation_runs run
         JOIN cron_schedules schedule ON schedule.id=run.schedule_id
         JOIN automation_skill_versions version ON version.id=run.skill_version_id
         JOIN automation_skills skill ON skill.id=version.skill_id
         WHERE schedule.deleted_at IS NULL AND skill.deleted_at IS NULL
           AND (run.status='ready' OR (run.status='claimed' AND run.lease_expires_at <= $1))
         ORDER BY scheduled_for
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [now],
      );
      if (!candidate.rowCount) return null;
      const claimToken = randomUUID();
      const claimed = await client.query(
        `UPDATE automation_runs run SET
           status='claimed',attempt_count=attempt_count+1,claimed_by=$2,claim_token=$3,
           claimed_at=$4::timestamptz,lease_expires_at=$4::timestamptz + ($5 * interval '1 hour'),completed_at=NULL,
           result_summary=NULL,error_message=NULL
         FROM cron_schedules schedule,automation_skill_versions version,automation_skills skill
         WHERE run.id=$1 AND schedule.id=run.schedule_id AND schedule.deleted_at IS NULL
           AND version.id=run.skill_version_id AND skill.id=version.skill_id AND skill.deleted_at IS NULL
         RETURNING run.id AS run_id,run.schedule_id,run.scheduled_for,run.input,run.attempt_count,
           run.claim_token,run.lease_expires_at,schedule.name AS schedule_name,
           schedule.knowledge_path,
           skill.id AS skill_id,skill.name AS skill_name,version.id AS skill_version_id,
           version.version_number AS skill_version_number,version.description,version.instructions_markdown`,
        [candidate.rows[0]!.id, clientId, claimToken, now, RUN_LEASE_HOURS],
      );
      return claimed.rows[0] ? withSkillMarkdown(claimed.rows[0]) : null;
    });
  }

  async completeRun(runId: string, claimToken: string, clientId: string, resultSummary?: string) {
    const result = await this.pool.query(
      `UPDATE automation_runs SET status='succeeded',completed_at=now(),result_summary=$4,error_message=NULL
       WHERE id=$1 AND claim_token=$2 AND claimed_by=$3 AND status='claimed' AND lease_expires_at > now()
       RETURNING id,status,completed_at,result_summary`,
      [runId, claimToken, clientId, resultSummary ?? null],
    );
    if (!result.rowCount) throw new AutomationClaimError();
    return result.rows[0];
  }

  async failRun(runId: string, claimToken: string, clientId: string, errorMessage: string) {
    const result = await this.pool.query(
      `UPDATE automation_runs SET status='failed',completed_at=now(),error_message=$4,result_summary=NULL
       WHERE id=$1 AND claim_token=$2 AND claimed_by=$3 AND status='claimed' AND lease_expires_at > now()
       RETURNING id,status,completed_at,error_message`,
      [runId, claimToken, clientId, errorMessage],
    );
    if (!result.rowCount) throw new AutomationClaimError();
    return result.rows[0];
  }
}
