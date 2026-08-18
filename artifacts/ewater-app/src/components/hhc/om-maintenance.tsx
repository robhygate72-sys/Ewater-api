// ---------------------------------------------------------------------------
// O&M panels: unified alarm list (Pulse faults + Shengda health alarms),
// Pulse maintenance job list with create / reassign / cancel controls, and
// the local action audit trail. Pulse is the source of truth for jobs — all
// writes go through our API, which proxies to Pulse and audits locally.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHhcMeterAlarms,
  getGetHhcMeterAlarmsQueryKey,
  useGetHhcMeterMaintenance,
  getGetHhcMeterMaintenanceQueryKey,
  useGetHhcMeterAudit,
  getGetHhcMeterAuditQueryKey,
  useGetHhcAssignableUsers,
  getGetHhcAssignableUsersQueryKey,
  useGetHhcManualJobTypes,
  getGetHhcManualJobTypesQueryKey,
  useCreateHhcMaintenanceJob,
  useReassignHhcMaintenanceJob,
  useCancelHhcMaintenanceJob,
  useRecordHhcMaintenanceJobEvents,
  type HhcAlarm,
  type PulseJob,
  type PulseJobType,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { BellRing, CheckCircle2, Play, Wrench, Plus, RefreshCw, ScrollText, UserCog, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTimeAgo } from "@/lib/date";
import { SectionCard, StatusBadge } from "./shared";
import { useOperatorSession, operatorHeaders } from "./operator";

const ALARM_POLL_MS = 60_000;
const JOBS_POLL_MS = 60_000;

// ── Shared severity / source styling (colour is a secondary signal only) ────

function severityBadgeClass(sev: string): string {
  if (sev === "critical") return "text-destructive bg-destructive/10 border-destructive/25";
  if (sev === "warning") return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25";
  return "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25";
}

function sourceBadgeClass(source: string): string {
  return source === "Pulse"
    ? "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/25"
    : "text-teal-600 dark:text-teal-400 bg-teal-500/10 border-teal-500/25";
}

export function AlarmRow({ a }: { a: HhcAlarm }) {
  return (
    <li className="rounded-lg border border-border/60 bg-card px-3 py-2 space-y-1" data-testid={`alarm-${a.source.toLowerCase()}-${a.code}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusBadge label={a.source} className={sourceBadgeClass(a.source)} />
        <StatusBadge label={a.severity} className={severityBadgeClass(a.severity)} />
        <span className="text-xs font-semibold">{a.label}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{a.status}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        <p><span className="text-muted-foreground">Observed:</span> {a.observedValue ?? "Not reported"}</p>
        <p><span className="text-muted-foreground">Expected:</span> {a.expectedValue ?? "Not specified"}</p>
        <p>
          <span className="text-muted-foreground">First seen:</span>{" "}
          {a.firstSeenAt ? <span title={formatDateTime(a.firstSeenAt)}>{formatTimeAgo(a.firstSeenAt)}</span> : "Unknown"}
        </p>
        <p>
          <span className="text-muted-foreground">Last seen:</span>{" "}
          {a.lastSeenAt ? <span title={formatDateTime(a.lastSeenAt)}>{formatTimeAgo(a.lastSeenAt)}</span> : "Unknown"}
        </p>
      </div>
      {a.description && a.description !== a.observedValue && (
        <p className="text-[10px] text-muted-foreground">{a.description}</p>
      )}
      <p className="text-[9px] text-muted-foreground/70">{a.severityRaw}{a.faultInstanceId ? ` · fault ${a.faultInstanceId}` : ""}</p>
    </li>
  );
}

// ── Per-meter alarm panel ────────────────────────────────────────────────────

export function AlarmsPanel({ assetId }: { assetId: string }) {
  const query = useGetHhcMeterAlarms(assetId, {
    query: { queryKey: getGetHhcMeterAlarmsQueryKey(assetId), refetchInterval: ALARM_POLL_MS },
  });
  const d = query.data;
  return (
    <SectionCard title="Alarms">
      {query.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : query.isError ? (
        <p className="text-[11px] text-destructive">Failed to load alarms</p>
      ) : !d || d.alarms.length === 0 ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5" data-testid="text-om-no-alarms">
          <BellRing className="w-3.5 h-3.5" /> No active alarms from Pulse or Shengda
        </p>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground mb-2" data-testid="text-om-alarm-counts">
            {d.pulseCount} Pulse fault{d.pulseCount !== 1 ? "s" : ""} · {d.shengdaCount} Shengda alert{d.shengdaCount !== 1 ? "s" : ""}
          </p>
          <ul className="space-y-2" data-testid="list-om-alarms">
            {d.alarms.map((a, i) => <AlarmRow key={`${a.source}-${a.code}-${i}`} a={a} />)}
          </ul>
        </>
      )}
      {d?.pulseError && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">
          Pulse fault source unavailable — only Shengda alarms shown ({d.pulseError})
        </p>
      )}
    </SectionCard>
  );
}

// ── Create-job modal ─────────────────────────────────────────────────────────

function CreateJobDialog({ assetId, open, onOpenChange, onCreated }: {
  assetId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [jobTypeId, setJobTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [observation, setObservation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const typesQuery = useGetHhcManualJobTypes({
    query: { queryKey: getGetHhcManualJobTypesQueryKey(), staleTime: 5 * 60_000, enabled: open },
  });
  const usersQuery = useGetHhcAssignableUsers({
    query: { queryKey: getGetHhcAssignableUsersQueryKey(), staleTime: 5 * 60_000, enabled: open },
  });
  const jobTypes: PulseJobType[] = typesQuery.data?.jobTypes ?? [];
  const selectedType = jobTypes.find((t) => t.jobTypeId === jobTypeId);

  const create = useCreateHhcMaintenanceJob({
    mutation: {
      onSuccess: () => {
        onOpenChange(false);
        setJobTypeId(""); setDescription(""); setAssignee(""); setDueDate(""); setObservation("");
        setError(null);
        onCreated();
      },
      onError: (err) => setError(err instanceof Error ? err.message : "Failed to create job"),
    },
    request: { headers: operatorHeaders() },
  });

  const canSubmit =
    !!jobTypeId &&
    !create.isPending &&
    (!selectedType?.isFaultLinked || selectedType.observations.length === 0 || !!observation);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Create maintenance job (Pulse)</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Job type</span>
            <Select value={jobTypeId} onValueChange={(v) => { setJobTypeId(v); setObservation(""); }}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-job-type">
                <SelectValue placeholder={typesQuery.isLoading ? "Loading job types…" : "Select a job type"} />
              </SelectTrigger>
              <SelectContent>
                {jobTypes.map((t) => (
                  <SelectItem key={t.jobTypeId} value={t.jobTypeId} className="text-xs">
                    {t.name}{t.isFaultLinked ? " (fault-linked)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedType?.isFaultLinked && selectedType.observations.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Fault observation (required by Pulse for this job type)</span>
              <Select value={observation} onValueChange={setObservation}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-fault-observation">
                  <SelectValue placeholder="Select an observation" />
                </SelectTrigger>
                <SelectContent>
                  {selectedType.observations.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.display}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Description (optional)</span>
            <Textarea
              data-testid="input-job-description"
              className="text-xs min-h-16"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs doing and why"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Assign to (optional)</span>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-job-assignee">
                  <SelectValue placeholder={usersQuery.isLoading ? "Loading…" : "Unassigned"} />
                </SelectTrigger>
                <SelectContent>
                  {(usersQuery.data?.users ?? []).map((u) => (
                    <SelectItem key={u.userId} value={u.userId} className="text-xs">{u.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Due date (optional)</span>
              <Input
                data-testid="input-job-due"
                type="date"
                className="h-8 text-xs"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            className="text-xs"
            disabled={!canSubmit}
            data-testid="button-job-create-submit"
            onClick={() =>
              create.mutate({
                assetId,
                data: {
                  jobTypeId,
                  ...(description.trim() ? { description: description.trim() } : {}),
                  ...(assignee ? { assigneeUserId: assignee } : {}),
                  ...(dueDate ? { dueDt: new Date(`${dueDate}T12:00:00`).toISOString() } : {}),
                  ...(observation ? { faultObservation: observation } : {}),
                },
              })
            }
          >
            {create.isPending ? "Creating…" : "Create job in Pulse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Job row with reassign / cancel controls ──────────────────────────────────

function JobRow({ assetId, job, onChanged }: { assetId: string; job: PulseJob; onChanged: () => void }) {
  const [reassigning, setReassigning] = useState(false);
  const [newAssignee, setNewAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const usersQuery = useGetHhcAssignableUsers({
    query: { queryKey: getGetHhcAssignableUsersQueryKey(), staleTime: 5 * 60_000, enabled: reassigning },
  });

  const reassign = useReassignHhcMaintenanceJob({
    mutation: {
      onSuccess: () => { setReassigning(false); setNewAssignee(""); setError(null); onChanged(); },
      onError: (err) => setError(err instanceof Error ? err.message : "Reassign failed"),
    },
    request: { headers: operatorHeaders() },
  });
  const cancel = useCancelHhcMaintenanceJob({
    mutation: {
      onSuccess: () => { setError(null); onChanged(); },
      onError: (err) => setError(err instanceof Error ? err.message : "Cancel failed"),
    },
    request: { headers: operatorHeaders() },
  });
  const recordEvents = useRecordHhcMaintenanceJobEvents({
    mutation: {
      onSuccess: () => { setError(null); onChanged(); },
      onError: (err) => setError(err instanceof Error ? err.message : "Failed to record job event"),
    },
    request: { headers: operatorHeaders() },
  });

  const hasWorkStarted = job.records.some((r) => r.recordType === "WorkStarted");
  const isOpen = job.jobLifecycleState !== "Closed" && job.jobLifecycleState !== "Cancelled" && !job.closedDt;
  const signedIn = !!useOperatorSession();

  return (
    <li className="rounded-lg border border-border/60 bg-card px-3 py-2 space-y-1.5" data-testid={`job-${job.jobInstanceId}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusBadge
          label={job.jobLifecycleState ?? "Unknown"}
          className={isOpen
            ? "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25"
            : "text-muted-foreground bg-muted/40 border-border"}
        />
        <span className="text-xs font-semibold">{job.title ?? job.jobTypeName ?? "Maintenance job"}</span>
        <span className="text-[9px] text-muted-foreground font-mono ml-auto">P{job.priority}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        <p><span className="text-muted-foreground">Category:</span> {job.jobTypeName ?? job.jobTypeId}</p>
        <p><span className="text-muted-foreground">Assignee:</span> {job.assigneeName ?? (job.assigneeUserId ? job.assigneeUserId : "Unassigned")}</p>
        <p><span className="text-muted-foreground">Created:</span> <span title={formatDateTime(job.createdDt)}>{formatTimeAgo(job.createdDt)}</span>{job.createdSource ? ` (${job.createdSource})` : ""}</p>
        <p><span className="text-muted-foreground">Due:</span> {job.dueDt ? formatDateTime(job.dueDt) : "No due date"}</p>
      </div>
      {job.description && <p className="text-[10px] text-muted-foreground">{job.description}</p>}
      {job.records.length > 0 && (
        <p className="text-[9px] text-muted-foreground/80">
          {job.records.length} event{job.records.length !== 1 ? "s" : ""} · latest: {job.records[job.records.length - 1]?.recordType}
        </p>
      )}
      {isOpen && signedIn && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {reassigning ? (
            <>
              <Select value={newAssignee} onValueChange={setNewAssignee}>
                <SelectTrigger className="h-7 text-[11px] w-44" data-testid={`select-reassign-${job.jobInstanceId}`}>
                  <SelectValue placeholder={usersQuery.isLoading ? "Loading…" : "Choose technician"} />
                </SelectTrigger>
                <SelectContent>
                  {(usersQuery.data?.users ?? []).map((u) => (
                    <SelectItem key={u.userId} value={u.userId} className="text-xs">{u.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm" className="h-7 text-[11px]"
                disabled={!newAssignee || reassign.isPending}
                data-testid={`button-reassign-confirm-${job.jobInstanceId}`}
                onClick={() => reassign.mutate({ assetId, jobId: job.jobInstanceId, data: { assigneeUserId: newAssignee } })}
              >
                {reassign.isPending ? "Saving…" : "Confirm"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setReassigning(false)}>Back</Button>
            </>
          ) : (
            <>
              {!hasWorkStarted && (
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px]"
                  disabled={recordEvents.isPending}
                  data-testid={`button-start-work-${job.jobInstanceId}`}
                  onClick={() =>
                    recordEvents.mutate({
                      assetId, jobId: job.jobInstanceId,
                      data: { events: [{ recordType: "WorkStarted", data: null }] },
                    })
                  }
                >
                  <Play className="w-3 h-3 mr-1" /> {recordEvents.isPending ? "Saving…" : "Start work"}
                </Button>
              )}
              <Button
                size="sm" variant="outline" className="h-7 text-[11px]"
                disabled={recordEvents.isPending}
                data-testid={`button-complete-${job.jobInstanceId}`}
                onClick={() => {
                  const notes = window.prompt("Completion notes (recorded in Pulse):", "");
                  if (notes === null) return; // cancelled
                  recordEvents.mutate({
                    assetId, jobId: job.jobInstanceId,
                    data: { events: [{ recordType: "Completion", data: JSON.stringify({ notes }) }] },
                  });
                }}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" /> Complete
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" data-testid={`button-reassign-${job.jobInstanceId}`} onClick={() => setReassigning(true)}>
                <UserCog className="w-3 h-3 mr-1" /> Reassign
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 text-[11px] text-destructive"
                disabled={cancel.isPending}
                data-testid={`button-cancel-${job.jobInstanceId}`}
                onClick={() => {
                  if (window.confirm("Cancel this Pulse job? This cannot be undone from here.")) {
                    cancel.mutate({ assetId, jobId: job.jobInstanceId });
                  }
                }}
              >
                <XCircle className="w-3 h-3 mr-1" /> {cancel.isPending ? "Cancelling…" : "Cancel job"}
              </Button>
            </>
          )}
        </div>
      )}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </li>
  );
}

// ── Maintenance jobs panel ───────────────────────────────────────────────────

export function MaintenancePanel({ assetId }: { assetId: string }) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const jobsKey = getGetHhcMeterMaintenanceQueryKey(assetId);
  const query = useGetHhcMeterMaintenance(assetId, {
    query: { queryKey: jobsKey, refetchInterval: JOBS_POLL_MS },
  });
  const auditKey = useMemo(() => getGetHhcMeterAuditQueryKey(assetId), [assetId]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: jobsKey });
    void queryClient.invalidateQueries({ queryKey: auditKey });
  };
  const signedIn = !!useOperatorSession();
  const jobs = query.data?.jobs ?? [];

  return (
    <SectionCard title="Maintenance jobs (Pulse)">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] text-muted-foreground">
          Jobs live in the Pulse maintenance system — this list is fetched live, never stored locally.
        </p>
        <div className="flex items-center gap-1">
          <button
            data-testid="button-jobs-refresh"
            onClick={refresh}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            title="Refresh jobs"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", query.isFetching && "animate-spin")} />
          </button>
          <Button
            size="sm" className="h-7 text-[11px]"
            disabled={!signedIn}
            data-testid="button-job-create"
            onClick={() => setCreateOpen(true)}
            title={signedIn ? undefined : "Sign in with an operator access key first"}
          >
            <Plus className="w-3 h-3 mr-1" /> New job
          </Button>
        </div>
      </div>
      {!signedIn && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-2">
          Operator sign-in required to create, reassign or cancel jobs.
        </p>
      )}
      {query.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : query.isError ? (
        <p className="text-[11px] text-destructive">Failed to load Pulse jobs for this asset</p>
      ) : jobs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5" data-testid="text-om-no-jobs">
          <Wrench className="w-3.5 h-3.5" /> No Pulse jobs found in any technician's work queue for this asset
        </p>
      ) : (
        <ul className="space-y-2" data-testid="list-om-jobs">
          {jobs.map((j) => <JobRow key={j.jobInstanceId} assetId={assetId} job={j} onChanged={refresh} />)}
        </ul>
      )}
      <CreateJobDialog assetId={assetId} open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />
    </SectionCard>
  );
}

// ── Action audit trail ───────────────────────────────────────────────────────

const AUDIT_STATE_CLASS: Record<string, string> = {
  requested: "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25",
  confirmed: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  failed: "text-destructive bg-destructive/10 border-destructive/25",
};

export function AuditPanel({ assetId }: { assetId: string }) {
  const signedIn = !!useOperatorSession();
  const params = { limit: 50 };
  const query = useGetHhcMeterAudit(assetId, params, {
    query: { queryKey: getGetHhcMeterAuditQueryKey(assetId, params), enabled: signedIn },
    request: { headers: operatorHeaders() },
  });
  const entries = query.data?.entries ?? [];
  return (
    <SectionCard title="Action audit trail">
      <p className="text-[10px] text-muted-foreground mb-2">
        Every write this application performed against this asset (local record — Pulse holds the job data itself).
      </p>
      {!signedIn ? (
        <p className="text-[11px] text-muted-foreground" data-testid="text-om-audit-signin">
          Sign in with an operator access key to view the audit trail.
        </p>
      ) : query.isLoading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : query.isError ? (
        <p className="text-[11px] text-destructive">Failed to load audit history</p>
      ) : entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5" data-testid="text-om-no-audit">
          <ScrollText className="w-3.5 h-3.5" /> No recorded actions for this asset yet
        </p>
      ) : (
        <ul className="space-y-1" data-testid="list-om-audit">
          {entries.map((e) => {
            const detail = (e.detail ?? {}) as Record<string, unknown>;
            const state = typeof detail["commandState"] === "string" ? (detail["commandState"] as string) : null;
            const endpoint = typeof detail["endpoint"] === "string" ? (detail["endpoint"] as string) : null;
            const err = typeof detail["error"] === "string" ? (detail["error"] as string) : null;
            return (
              <li key={e.id} className="flex items-start gap-2 text-[11px] border-b border-border/40 last:border-0 pb-1">
                <span className="text-[9px] text-muted-foreground shrink-0 w-24" title={formatDateTime(e.createdAt)}>
                  {formatTimeAgo(e.createdAt)}
                </span>
                <span className="font-mono text-[10px]">{e.action}</span>
                {state && <StatusBadge label={state} className={AUDIT_STATE_CLASS[state] ?? "text-muted-foreground bg-muted/40 border-border"} />}
                <span className="text-muted-foreground truncate flex-1">
                  by {e.operator}{endpoint ? ` → ${endpoint}` : ""}{err ? ` — ${err}` : ""}{e.reason ? ` (${e.reason})` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
