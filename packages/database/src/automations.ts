import { randomUUID } from "node:crypto";
import type {
  Actor,
  CreateCronScheduleInput,
  UpdateCronScheduleInput,
} from "@context-use/shared";
import { Cron } from "croner";
import type { Pool, PoolClient } from "pg";
import { extractAssetLinks, normalizeInternalPageLinks } from "./links.ts";
import { prunePageVersions } from "./page-retention.ts";

const RUN_LEASE_HOURS = 1;
export const AUTOMATION_RESULT_SUMMARY_MAX_LENGTH = 500;

export type CompletedAutomationRunCursor = {
  completedAt: Date;
  id: string;
};

export const AUTOMATION_RUN_EXECUTION_CONTEXT = `## Execution context

You are executing this as a **claimed Context Use automation run**. \`claim_due_run\` gave you a \`run_id\`, \`claim_token\`, and this automation's **dedicated knowledge path**. If the automation instructions call for a persistent page, create it with \`create_automation_page\` (or use \`update_automation_page\` when the target page already exists), passing the \`run_id\` and \`claim_token\`. Do not create a page when the automation instructions do not call for one. Generic writes are disabled during the claim. Automation-created pages are private by default and can later be edited or archived through the ordinary page tools; only the owner can publish from the dashboard with a passkey. When calling \`complete_run\`, omit \`result_summary\` if the status and any page output are sufficient; otherwise use one or two sentences only to say what changed and where. Never copy page contents into the summary. Finish with \`complete_run\` (or \`fail_run\`). Read [[about/intro]] first; hold as context.`;

export function hasAutomationExecutionContext(instructions: string): boolean {
  let fence: "`" | "~" | null = null;

  for (const line of instructions.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0] as "`" | "~";
      if (fence === marker) fence = null;
      else if (!fence) fence = marker;
      continue;
    }
    if (!fence && /^##[ \t]+Execution context[ \t]*$/i.test(line)) {
      return true;
    }
  }
  return false;
}

export function automationRunInstructionsMarkdown(instructions: string): string {
  return hasAutomationExecutionContext(instructions)
    ? instructions
    : `${instructions}\n\n${AUTOMATION_RUN_EXECUTION_CONTEXT}`;
}

function withAutomationRunInstructions<T extends {
  instructions_markdown: string;
}>(run: T) {
  return {
    ...run,
    instructions_markdown: automationRunInstructionsMarkdown(run.instructions_markdown),
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
    super(`Automation changed; current version is ${currentVersion}`);
    this.name = "AutomationVersionConflictError";
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

async function insertInstructionAssetLinks(
  client: PoolClient,
  versionId: string,
  markdown: string,
): Promise<void> {
  for (const targetId of extractAssetLinks(markdown)) {
    await client.query(
      `INSERT INTO knowledge_asset_links(source_version_id,target_asset_id)
       SELECT $1,id FROM assets WHERE id=$2 AND deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [versionId, targetId],
    );
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
    current_version_id: string;
    cron_expression: string;
    timezone: string;
    input: Record<string, unknown>;
    next_run_at: Date;
  }>(
    `SELECT id,current_version_id,cron_expression,timezone,input,next_run_at
     FROM cron_schedules
     WHERE enabled=true AND deleted_at IS NULL AND next_run_at <= $1
     ORDER BY next_run_at
     FOR UPDATE`,
    [now],
  );

  for (const schedule of due.rows) {
    await client.query(
      `INSERT INTO automation_runs(id,schedule_id,automation_version_id,scheduled_for,input)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (schedule_id,scheduled_for) DO NOTHING`,
      [randomUUID(), schedule.id, schedule.current_version_id, schedule.next_run_at, schedule.input],
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

export class AutomationRepository {
  constructor(private readonly pool: Pool) {}

  async listSchedules() {
    const result = await this.pool.query(
      `SELECT schedule.id,schedule.name,schedule.current_version_id AS automation_version_id,
        schedule.cron_expression,schedule.timezone,
        schedule.automation_key,schedule.input,schedule.enabled,schedule.next_run_at,schedule.knowledge_path,schedule.created_at,schedule.updated_at,
        version.version_number AS automation_version_number,
        version.commit_message,version.created_at AS version_created_at,
        instructions_page.id AS instructions_page_id,
        instructions_page.current_path AS instructions_path,
        instructions_page.current_version_id AS instructions_version_id,
        instructions.version_number AS instructions_version_number,
        instructions.body_markdown AS instructions_markdown,
        count(run.id) FILTER (WHERE run.status='ready')::integer AS ready_count,
        count(run.id) FILTER (WHERE run.status='claimed')::integer AS claimed_count,
        max(run.completed_at) FILTER (WHERE run.status IN ('succeeded','failed')) AS last_completed_at,
        (SELECT count(*)::integer FROM knowledge_pages page
         WHERE page.automation_id=schedule.id AND page.archived_at IS NULL
           AND page.id<>schedule.instructions_page_id) AS generated_page_count
       FROM cron_schedules schedule
       JOIN automation_versions version ON version.id=schedule.current_version_id AND version.automation_id=schedule.id
       JOIN knowledge_pages instructions_page ON instructions_page.id=schedule.instructions_page_id
       JOIN knowledge_page_versions instructions
         ON instructions.id=instructions_page.current_version_id
        AND instructions.page_id=instructions_page.id
       LEFT JOIN automation_runs run ON run.schedule_id=schedule.id
       WHERE schedule.deleted_at IS NULL
       GROUP BY schedule.id,version.id,instructions_page.id,instructions.id
       ORDER BY lower(schedule.name)`,
    );
    return result.rows;
  }

  async createSchedule(input: CreateCronScheduleInput, actor: Actor) {
    const nextRunAt = nextCronOccurrence(input.cron_expression, input.timezone);
    return transaction(this.pool, async (client) => {
      const existingKey = await client.query(
        "SELECT 1 FROM cron_schedules WHERE automation_key=$1",
        [input.automation_key],
      );
      if (existingKey.rowCount) throw new AutomationValidationError("Automation key is already in use");
      const scheduleId = randomUUID();
      const versionId = randomUUID();
      const instructionsPageId = randomUUID();
      const instructionsVersionId = randomUUID();
      const instructionsPath = `automations/${input.automation_key}/instructions`;
      const instructionsMarkdown = normalizeInternalPageLinks(input.instructions_markdown);
      const instructionsSummary = `Instructions that define the ${input.name} automation.`;
      const directorySummary = `Private instructions and durable outputs for the ${input.name} automation.`;
      await client.query(
        `INSERT INTO knowledge_directories(
           id,current_path,title,summary,intro_markdown,search_vector
         ) VALUES ($1,$2,$3,$4,'',directory_search_vector($2,$3,$4,''))`,
        [randomUUID(), `automations/${input.automation_key}`, input.name, directorySummary],
      );
      await client.query(
        `INSERT INTO cron_schedules(
           id,name,automation_key,current_version_id,instructions_page_id,
           cron_expression,timezone,input,enabled,next_run_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [scheduleId, input.name, input.automation_key, versionId, instructionsPageId, input.cron_expression, input.timezone, input.input, input.enabled, nextRunAt],
      );
      await client.query(
        `INSERT INTO automation_versions(
           id,automation_id,version_number,instructions_markdown,commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,$4,$5,$6)`,
        [versionId, scheduleId, instructionsMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await client.query(
        `INSERT INTO knowledge_pages(
           id,current_path,current_version_id,automation_id,search_vector
         ) VALUES ($1,$2,$3,$4,page_search_vector($2,$5,$6,$7))`,
        [instructionsPageId, instructionsPath, instructionsVersionId, scheduleId, `${input.name} instructions`, instructionsSummary, instructionsMarkdown],
      );
      await client.query(
        `INSERT INTO knowledge_page_versions(
           id,page_id,version_number,path,title,summary,body_markdown,
           commit_message,actor_kind,actor_subject
         ) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)`,
        [instructionsVersionId, instructionsPageId, instructionsPath, `${input.name} instructions`, instructionsSummary, instructionsMarkdown, input.commit_message, actor.kind, actor.subject],
      );
      await insertInstructionAssetLinks(client, instructionsVersionId, instructionsMarkdown);
      const result = await client.query(
        `SELECT schedule.*,schedule.current_version_id AS automation_version_id,
           version.version_number AS automation_version_number,
           version.commit_message,version.created_at AS version_created_at,
           instructions_page.current_path AS instructions_path,
           instructions_page.current_version_id AS instructions_version_id,
           instructions.version_number AS instructions_version_number,
           instructions.body_markdown AS instructions_markdown
         FROM cron_schedules schedule
         JOIN automation_versions version ON version.id=schedule.current_version_id
         JOIN knowledge_pages instructions_page ON instructions_page.id=schedule.instructions_page_id
         JOIN knowledge_page_versions instructions ON instructions.id=instructions_page.current_version_id
         WHERE schedule.id=$1`,
        [scheduleId],
      );
      return result.rows[0];
    });
  }

  async updateSchedule(scheduleId: string, input: UpdateCronScheduleInput, actor: Actor) {
    const nextRunAt = nextCronOccurrence(input.cron_expression, input.timezone);
    return transaction(this.pool, async (client) => {
      const current = await client.query<{
        current_version_id: string;
        automation_key: string;
        version_number: number;
        next_version_number: number;
        instructions_page_id: string;
        instructions_path: string;
        instructions_title: string;
        instructions_markdown: string;
        instructions_version_number: number;
      }>(
        `SELECT schedule.current_version_id,schedule.automation_key,version.version_number,
           (SELECT max(candidate.version_number)+1 FROM automation_versions candidate
            WHERE candidate.automation_id=schedule.id)::integer AS next_version_number,
           instructions_page.id AS instructions_page_id,
           instructions_page.current_path AS instructions_path,
           instructions.title AS instructions_title,
           instructions.body_markdown AS instructions_markdown,
           instructions.version_number AS instructions_version_number
         FROM cron_schedules schedule
         JOIN automation_versions version ON version.id=schedule.current_version_id
         JOIN knowledge_pages instructions_page ON instructions_page.id=schedule.instructions_page_id
         JOIN knowledge_page_versions instructions ON instructions.id=instructions_page.current_version_id
         WHERE schedule.id=$1 AND schedule.deleted_at IS NULL
         FOR UPDATE OF schedule,instructions_page`,
        [scheduleId],
      );
      if (!current.rowCount) return null;
      const row = current.rows[0]!;
      if (row.version_number !== input.expected_version_number) {
        throw new AutomationVersionConflictError(row.version_number);
      }
      const instructionsMarkdown = normalizeInternalPageLinks(input.instructions_markdown);
      const instructionsTitle = `${input.name} instructions`;
      const instructionsSummary = `Instructions that define the ${input.name} automation.`;
      await client.query(
        `UPDATE knowledge_directories
         SET title=$2,summary=$3,version_number=version_number+1,
             search_vector=directory_search_vector(current_path,$2,$3,intro_markdown),updated_at=now()
         WHERE current_path=$1 AND (title IS DISTINCT FROM $2 OR summary IS DISTINCT FROM $3)`,
        [`automations/${row.automation_key}`, input.name, `Private instructions and durable outputs for the ${input.name} automation.`],
      );
      if (row.instructions_markdown !== instructionsMarkdown || row.instructions_title !== instructionsTitle) {
        const instructionsVersionId = randomUUID();
        await client.query(
          `INSERT INTO knowledge_page_versions(
             id,page_id,version_number,path,title,summary,body_markdown,
             commit_message,actor_kind,actor_subject
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [instructionsVersionId, row.instructions_page_id, row.instructions_version_number + 1, row.instructions_path, instructionsTitle, instructionsSummary, instructionsMarkdown, input.commit_message, actor.kind, actor.subject],
        );
        await client.query(
          `UPDATE knowledge_pages
           SET current_version_id=$2,
               search_vector=page_search_vector(current_path,$3,$4,$5),updated_at=now()
           WHERE id=$1`,
          [row.instructions_page_id, instructionsVersionId, instructionsTitle, instructionsSummary, instructionsMarkdown],
        );
        await insertInstructionAssetLinks(client, instructionsVersionId, instructionsMarkdown);
        await prunePageVersions(client, row.instructions_page_id);
      }
      let versionId = row.current_version_id;
      if (row.instructions_markdown !== instructionsMarkdown) {
        versionId = randomUUID();
        await client.query(
          `INSERT INTO automation_versions(
             id,automation_id,version_number,instructions_markdown,commit_message,actor_kind,actor_subject
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [versionId, scheduleId, row.next_version_number, instructionsMarkdown, input.commit_message, actor.kind, actor.subject],
        );
      }
      await client.query(
        `UPDATE cron_schedules SET
           name=$2,current_version_id=$3,cron_expression=$4,timezone=$5,input=$6,enabled=$7,
           next_run_at=$8,updated_at=now()
         WHERE id=$1`,
        [scheduleId, input.name, versionId, input.cron_expression, input.timezone, input.input, input.enabled, nextRunAt],
      );
      const result = await client.query(
        `SELECT schedule.*,schedule.current_version_id AS automation_version_id,
           version.version_number AS automation_version_number,
           version.commit_message,version.created_at AS version_created_at,
           instructions_page.current_path AS instructions_path,
           instructions_page.current_version_id AS instructions_version_id,
           instructions.version_number AS instructions_version_number,
           instructions.body_markdown AS instructions_markdown
         FROM cron_schedules schedule
         JOIN automation_versions version ON version.id=schedule.current_version_id
         JOIN knowledge_pages instructions_page ON instructions_page.id=schedule.instructions_page_id
         JOIN knowledge_page_versions instructions ON instructions.id=instructions_page.current_version_id
         WHERE schedule.id=$1`,
        [scheduleId],
      );
      return result.rows[0];
    });
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
        `SELECT run.id,run.schedule_id,run.automation_version_id,run.scheduled_for,run.input,run.status,
          run.attempt_count,run.claimed_by,run.claimed_at,run.lease_expires_at,run.completed_at,
          (run.status='claimed' AND run.lease_expires_at <= now()) AS claim_expired,
          run.result_summary,run.error_message,run.created_at,
          schedule.name AS schedule_name,version.version_number AS automation_version_number
         FROM automation_runs run
         JOIN cron_schedules schedule ON schedule.id=run.schedule_id
         JOIN automation_versions version ON version.id=run.automation_version_id AND version.automation_id=run.schedule_id
         WHERE schedule.deleted_at IS NULL
         ORDER BY run.scheduled_for DESC
         LIMIT $1`,
        [limit],
      );
      return result.rows;
    });
  }

  async listActiveRuns() {
    return transaction(this.pool, async (client) => {
      await materializeDueRuns(client, new Date());
      const result = await client.query(
        `SELECT run.id,run.schedule_id,run.automation_version_id,run.scheduled_for,run.input,run.status,
          run.attempt_count,run.claimed_by,run.claimed_at,run.lease_expires_at,run.completed_at,
          (run.status='claimed' AND run.lease_expires_at <= now()) AS claim_expired,
          run.result_summary,run.error_message,run.created_at,
          schedule.name AS schedule_name,version.version_number AS automation_version_number
         FROM automation_runs run
         JOIN cron_schedules schedule ON schedule.id=run.schedule_id
         JOIN automation_versions version ON version.id=run.automation_version_id AND version.automation_id=run.schedule_id
         WHERE schedule.deleted_at IS NULL AND run.status IN ('ready','claimed')
         ORDER BY run.scheduled_for DESC,run.id DESC`,
      );
      return result.rows;
    });
  }

  async listCompletedRuns(limit = 10, cursor?: CompletedAutomationRunCursor) {
    const pageParameters: unknown[] = [limit + 1];
    const cursorPredicate = cursor
      ? "AND (run.completed_at,run.id) < ($2::timestamptz,$3::uuid)"
      : "";
    if (cursor) pageParameters.push(cursor.completedAt, cursor.id);

    const [page, totals] = await Promise.all([
      this.pool.query(
        `SELECT run.id,run.schedule_id,run.automation_version_id,run.scheduled_for,run.input,run.status,
          run.attempt_count,run.claimed_by,run.claimed_at,run.lease_expires_at,run.completed_at,
          false AS claim_expired,run.result_summary,run.error_message,run.created_at,
          schedule.name AS schedule_name,version.version_number AS automation_version_number
         FROM automation_runs run
         JOIN cron_schedules schedule ON schedule.id=run.schedule_id
         JOIN automation_versions version ON version.id=run.automation_version_id AND version.automation_id=run.schedule_id
         WHERE run.status IN ('succeeded','failed')
         ${cursorPredicate}
         ORDER BY run.completed_at DESC,run.id DESC
         LIMIT $1`,
        pageParameters,
      ),
      this.pool.query<{ succeeded: number; failed: number }>(
        `SELECT
          count(*) FILTER (WHERE run.status='succeeded')::integer AS succeeded,
          count(*) FILTER (WHERE run.status='failed')::integer AS failed
         FROM automation_runs run
         WHERE run.status IN ('succeeded','failed')`,
      ),
    ]);

    const hasMore = page.rows.length > limit;
    const items = hasMore ? page.rows.slice(0, limit) : page.rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? { completedAt: new Date(last.completed_at), id: String(last.id) }
        : null,
      totals: totals.rows[0] ?? { succeeded: 0, failed: 0 },
    };
  }

  async claimDueRun(clientId: string) {
    return transaction(this.pool, async (client) => {
      const now = new Date();
      await materializeDueRuns(client, now);
      const candidate = await client.query<{ id: string }>(
        `SELECT run.id FROM automation_runs run
         JOIN cron_schedules schedule ON schedule.id=run.schedule_id
         JOIN automation_versions version ON version.id=run.automation_version_id AND version.automation_id=run.schedule_id
         WHERE schedule.deleted_at IS NULL
           AND (run.status='ready' OR (run.status='claimed' AND run.lease_expires_at <= $1))
         ORDER BY scheduled_for
         FOR UPDATE OF run SKIP LOCKED
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
         FROM cron_schedules schedule,automation_versions version,
           knowledge_pages instructions_page,knowledge_page_versions instructions
         WHERE run.id=$1 AND schedule.id=run.schedule_id AND schedule.deleted_at IS NULL
           AND version.id=run.automation_version_id AND version.automation_id=schedule.id
           AND instructions_page.id=schedule.instructions_page_id
           AND instructions.id=instructions_page.current_version_id
           AND instructions.page_id=instructions_page.id
         RETURNING run.id AS run_id,run.schedule_id,run.scheduled_for,run.input,run.attempt_count,
           run.claim_token,run.lease_expires_at,schedule.name AS schedule_name,
           schedule.knowledge_path,
           version.id AS automation_version_id,
           version.version_number AS automation_version_number,
           instructions_page.id AS instructions_page_id,
           instructions_page.current_path AS instructions_path,
           instructions.id AS instructions_version_id,
           instructions.version_number AS instructions_version_number,
           instructions.body_markdown AS instructions_markdown`,
        [candidate.rows[0]!.id, clientId, claimToken, now, RUN_LEASE_HOURS],
      );
      return claimed.rows[0] ? withAutomationRunInstructions(claimed.rows[0]) : null;
    });
  }

  async completeRun(runId: string, claimToken: string, clientId: string, resultSummary?: string) {
    if (resultSummary && resultSummary.length > AUTOMATION_RESULT_SUMMARY_MAX_LENGTH) {
      throw new AutomationValidationError(
        `Automation run summaries cannot exceed ${AUTOMATION_RESULT_SUMMARY_MAX_LENGTH} characters`,
      );
    }
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
