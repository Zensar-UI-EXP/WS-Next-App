import { execute, query, queryMany, transaction } from "../db";
import type { OrchestrationRun, OrchestrationRunSummary, OrchestrationStep } from "../models";

/** Orchestration runs and their steps: the visible trace of each run. */
const RUN = "RunId, ClientReportId, Kind, Status, StartedBy, StartedOn, FinishedOn, Summary";

export function startRun(clientReportId: number, kind: string, userId: string, steps: readonly (readonly [string, string, string])[]): Promise<number> {
  return transaction("app", async (run) => {
    const [row] = await run(`INSERT studio.OrchestrationRun (ClientReportId, Kind, Status, StartedBy) VALUES (@Id, @Kind, 'Running', @User);
      SELECT CAST(SCOPE_IDENTITY() AS INT) AS RunId;`, { Id: clientReportId, Kind: kind, User: userId });
    const runId = row.runId as number;
    let no = 0;
    for (const [key, name, stepKind] of steps)
      await run("INSERT studio.OrchestrationStep (RunId, StepNo, StepKey, Name, Kind, Status) VALUES (@RunId, @No, @Key, @Name, @Kind, 'Pending')",
        { RunId: runId, No: ++no, Key: key, Name: name, Kind: stepKind });
    return runId;
  });
}

export const stepStarted = (runId: number, stepNo: number) => execute("app",
  "UPDATE studio.OrchestrationStep SET Status = 'Running', StartedOn = SYSUTCDATETIME() WHERE RunId = @RunId AND StepNo = @StepNo", { RunId: runId, StepNo: stepNo });

export const stepFinished = (runId: number, stepNo: number, status: string, summary: string, output: unknown) => execute("app", `
  UPDATE studio.OrchestrationStep
  SET Status = @Status, Summary = @Summary, OutputJson = @Output, FinishedOn = SYSUTCDATETIME(), StartedOn = ISNULL(StartedOn, SYSUTCDATETIME())
  WHERE RunId = @RunId AND StepNo = @StepNo`,
  { RunId: runId, StepNo: stepNo, Status: status, Summary: summary.slice(0, 1000), Output: output == null ? null : JSON.stringify(output) });

export const finishRun = (runId: number, status: string, summary: string) => execute("app", `
  UPDATE studio.OrchestrationRun SET Status = @Status, Summary = @Summary, FinishedOn = SYSUTCDATETIME() WHERE RunId = @RunId;
  UPDATE studio.OrchestrationStep SET Status = 'Skipped', Summary = N'Not run.' WHERE RunId = @RunId AND Status IN ('Pending', 'Running');`,
  { RunId: runId, Status: status, Summary: summary.slice(0, 1000) });

/** Runs left Running by a stopped server can never finish: mark them Failed on start-up. */
export const failInterrupted = () => execute("app", `
  UPDATE studio.OrchestrationStep SET Status = 'Skipped', Summary = N'Interrupted.' WHERE Status IN ('Pending', 'Running')
    AND RunId IN (SELECT RunId FROM studio.OrchestrationRun WHERE Status = 'Running');
  UPDATE studio.OrchestrationRun SET Status = 'Failed', Summary = N'Interrupted: the server stopped while this run was in progress.', FinishedOn = SYSUTCDATETIME()
  WHERE Status = 'Running';`);

export async function getRun(runId: number): Promise<OrchestrationRun | null> {
  const [runs, steps] = await queryMany("app", `
    SELECT ${RUN} FROM studio.OrchestrationRun WHERE RunId = @RunId;
    SELECT StepNo, StepKey, Name, Kind, Status, StartedOn, FinishedOn, Summary, OutputJson FROM studio.OrchestrationStep WHERE RunId = @RunId ORDER BY StepNo;`,
    { RunId: runId });
  if (!runs[0]) return null;
  return {
    ...(runs[0] as unknown as OrchestrationRunSummary),
    steps: steps.map(({ outputJson, ...s }) => ({ ...(s as unknown as OrchestrationStep), output: outputJson ? JSON.parse(outputJson as string) : null })),
  };
}

export const listRuns = (clientReportId: number) =>
  query<OrchestrationRunSummary>("app", `SELECT ${RUN} FROM studio.OrchestrationRun WHERE ClientReportId = @Id ORDER BY RunId DESC`, { Id: clientReportId });
