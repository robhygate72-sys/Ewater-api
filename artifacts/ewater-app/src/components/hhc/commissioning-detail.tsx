// Full commissioning workflow panel — gate stepper, three-gate QC checklist
// with AUTO/MANUAL source badges, expandable evidence, three-communication
// test, RTC drift, Gate 3 sampling, blocker list, approval + override.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHouseholdMeterCommissioning,
  getGetHouseholdMeterCommissioningQueryKey,
  useUpdateHouseholdMeterCommissioning,
  useRecordModemIccid,
  useGetAssetUdpHealth,
  getGetAssetUdpHealthQueryKey,
  type CommissioningDetail,
  type QcResult,
  type UpdateCommissioningBody,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  XCircle,
  CircleDashed,
  ChevronDown,
  ChevronUp,
  Radio,
  Clock,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeAgo, formatDateTime } from "@/lib/date";
import { StatusBadge } from "./shared";
import { getOperator, isAdminRole, operatorHeaders, useOperatorSession } from "./operator";
import { UdpModemHealthPanel } from "@/components/udp-modem-health";

const GATES: { gate: number; stage: string; label: string }[] = [
  { gate: 1, stage: "gate1", label: "Gate 1 · Manufacturer" },
  { gate: 2, stage: "gate2", label: "Gate 2 · Gearbox" },
  { gate: 3, stage: "gate3", label: "Gate 3 · eWATER Kenya" },
];
const STAGE_ORDER = ["gate1", "gate2", "gate3", "approved"];

function ResultIcon({ result }: { result: string }) {
  if (result === "PASS") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (result === "FAIL") return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
  return <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={cn(
        "text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0",
        source === "AUTO"
          ? "text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25"
          : "text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/25",
      )}
    >
      {source}
    </span>
  );
}

function EvidenceBlock({ check }: { check: QcResult }) {
  const ev = check.evidence;
  if (!ev) return <p className="text-[10px] text-muted-foreground italic">No evidence recorded</p>;
  const rows: [string, unknown][] = Object.entries(ev).filter(([, v]) => v !== undefined);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono bg-muted/40 rounded-md p-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function CheckRow({
  assetId,
  check,
  onRecord,
  busy,
}: {
  assetId: string;
  check: QcResult;
  onRecord: (checkCode: string, result: "PASS" | "FAIL", notes: string | null) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  return (
    <li className="rounded-lg border border-border bg-card" data-testid={`qc-${assetId}-${check.checkCode}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <ResultIcon result={check.result} />
        <SourceBadge source={check.source} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium truncate">
            {check.label}
            {check.mandatory && <span className="text-destructive ml-0.5" title="Mandatory">*</span>}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">{check.detail}</p>
        </div>
        {check.recordedAt && (
          <span className="text-[9px] text-muted-foreground shrink-0" title={formatDateTime(check.recordedAt)}>
            {formatTimeAgo(check.recordedAt)}
          </span>
        )}
        <button
          data-testid={`button-qc-expand-${assetId}-${check.checkCode}`}
          onClick={() => setExpanded((e) => !e)}
          className="p-1 rounded-md hover:bg-muted transition-colors shrink-0"
          title="Evidence"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
      </div>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-border pt-2">
          <EvidenceBlock check={check} />
          {check.notes && <p className="text-[10px]"><span className="text-muted-foreground">Notes:</span> {check.notes}</p>}
          {check.operator && <p className="text-[10px] text-muted-foreground">Recorded by {check.operator}</p>}
          {check.source === "MANUAL" && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Input
                data-testid={`input-qc-notes-${assetId}-${check.checkCode}`}
                className="h-7 text-[11px] flex-1 min-w-[140px]"
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] text-emerald-600"
                disabled={busy}
                data-testid={`button-qc-pass-${assetId}-${check.checkCode}`}
                onClick={() => onRecord(check.checkCode, "PASS", notes || null)}
              >
                Pass
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] text-destructive"
                disabled={busy}
                data-testid={`button-qc-fail-${assetId}-${check.checkCode}`}
                onClick={() => onRecord(check.checkCode, "FAIL", notes || null)}
              >
                Fail
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function GateStepper({ stage, onSetStage, busy }: { stage: string; onSetStage: (s: string) => void; busy: boolean }) {
  const currentIdx = STAGE_ORDER.indexOf(stage);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {GATES.map((g, i) => {
        const idx = STAGE_ORDER.indexOf(g.stage);
        const done = currentIdx > idx;
        const active = stage === g.stage;
        return (
          <div key={g.stage} className="flex items-center gap-1">
            {i > 0 && <div className="w-4 h-px bg-border" />}
            <button
              data-testid={`button-stage-${g.stage}`}
              disabled={busy || stage === "approved"}
              onClick={() => onSetStage(g.stage)}
              className={cn(
                "text-[10px] px-2 py-1 rounded-md border transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : done
                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                    : "bg-card text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {done ? "✓ " : ""}{g.label}
            </button>
          </div>
        );
      })}
      <div className="w-4 h-px bg-border" />
      <span
        data-testid="badge-stage-approved"
        className={cn(
          "text-[10px] px-2 py-1 rounded-md border",
          stage === "approved"
            ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25 font-semibold"
            : "text-muted-foreground border-border",
        )}
      >
        {stage === "approved" ? "✓ Approved" : "Approved"}
      </span>
    </div>
  );
}

function CommsTestPanel({ d, onStart, busy }: { d: CommissioningDetail; onStart: () => void; busy: boolean }) {
  const t = d.commsTest;
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5" /> Three-communication test
        </p>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} data-testid={`button-start-comms-${d.assetId}`} onClick={onStart}>
          {t.startedAt ? "Restart test" : "Start test"}
        </Button>
      </div>
      {t.startedAt ? (
        <>
          <p className="text-[10px] text-muted-foreground">
            Started {formatDateTime(t.startedAt)} · <span className="font-semibold text-foreground">{t.validCount} / {t.requiredCount}</span> valid reports (corrupt packets do not count)
          </p>
          {t.deliveries.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">No packets received since test start</p>
          ) : (
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-medium pb-1">Received</th>
                  <th className="font-medium pb-1">Device time</th>
                  <th className="font-medium pb-1">CRC</th>
                  <th className="font-medium pb-1">Counted</th>
                </tr>
              </thead>
              <tbody>
                {t.deliveries.map((del) => (
                  <tr key={del.packetId} className="border-t border-border/60" data-testid={`comms-delivery-${del.packetId}`}>
                    <td className="py-1" title={formatDateTime(del.receivedAt)}>{formatDateTime(del.receivedAt)}</td>
                    <td className="py-1">{del.deviceTime ? formatDateTime(del.deviceTime) : "—"}</td>
                    <td className={cn("py-1 font-semibold", del.crcValid ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                      {del.crcValid ? "valid" : "corrupt"}
                    </td>
                    <td className="py-1">{del.counted ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="text-[10px] text-muted-foreground italic">Not started — only valid reports received after the start count</p>
      )}
    </div>
  );
}

function RtcDriftPanel({ d }: { d: CommissioningDetail }) {
  const r = d.rtcDrift;
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1">
      <p className="text-[11px] font-semibold flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> RTC drift
      </p>
      {r.driftSeconds == null ? (
        <p className="text-[10px] text-muted-foreground italic">No device time (/3/0 field 13) observed yet</p>
      ) : (
        <>
          <p className="text-[10px]">
            Measured drift <span className="font-semibold">{r.driftSeconds}s</span>
            {r.toleranceSeconds != null ? (
              <span className={cn("ml-1 font-semibold", r.driftSeconds <= r.toleranceSeconds ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                (tolerance {r.toleranceSeconds}s)
              </span>
            ) : (
              <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">— no tolerance configured</span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Device {r.deviceTime ? formatDateTime(r.deviceTime) : "—"} vs server receive {r.serverReceivedAt ? formatDateTime(r.serverReceivedAt) : "—"}
          </p>
        </>
      )}
    </div>
  );
}

function SamplingPanel({ d, onSetBatch, busy }: { d: CommissioningDetail; onSetBatch: (n: number) => void; busy: boolean }) {
  const [batch, setBatch] = useState(d.sampling.batchSize?.toString() ?? "");
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <p className="text-[11px] font-semibold">Gate 3 sampling</p>
      <div className="flex items-center gap-1.5">
        <Input
          data-testid={`input-batch-size-${d.assetId}`}
          className="h-7 text-[11px] w-24"
          type="number"
          min={1}
          placeholder="Batch size"
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={busy || !batch || Number(batch) < 1}
          data-testid={`button-set-batch-${d.assetId}`}
          onClick={() => onSetBatch(Number(batch))}
        >
          Set
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Sample {d.sampling.samplePct}% of batch
        {d.sampling.requiredSampleSize != null
          ? ` → required sample size ${d.sampling.requiredSampleSize} of ${d.sampling.batchSize}`
          : " — set the batch size to compute the required sample"}
      </p>
      <p className="text-[10px] text-muted-foreground italic">
        Informational guidance — batch tracking and sample-completion enforcement arrive with the O&M phase
      </p>
    </div>
  );
}

function ModemIccidPanel({ assetId }: { assetId: string }) {
  const [iccid, setIccid] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useRecordModemIccid({
    mutation: {
      onSuccess: (res) => setMessage(`ICCID recorded in Pulse (status ${res.pulseStatus})`),
      onError: (err) => setMessage(err instanceof Error ? err.message : "Failed to record ICCID"),
    },
    request: { headers: operatorHeaders() },
  });
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <p className="text-[11px] font-semibold">Modem ICCID → Pulse parts</p>
      <div className="flex items-center gap-1.5">
        <Input
          data-testid={`input-iccid-${assetId}`}
          className="h-7 text-[11px] font-mono flex-1"
          placeholder="ICCID (e.g. 8925402...)"
          value={iccid}
          onChange={(e) => { setIccid(e.target.value.trim()); setMessage(null); }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={mutation.isPending || iccid.length < 10}
          data-testid={`button-record-iccid-${assetId}`}
          onClick={() => mutation.mutate({ assetId, data: { iccid } })}
        >
          Record
        </Button>
      </div>
      {message && <p className={cn("text-[10px]", mutation.isError ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{message}</p>}
      <p className="text-[10px] text-muted-foreground">Recording syncs the Pulse parts inventory via UpdateModemIccid</p>
    </div>
  );
}

export function CommissioningPanel({ assetId }: { assetId: string }) {
  useOperatorSession(); // re-render on sign-in/sign-out so operator/admin gating stays current
  const queryClient = useQueryClient();
  const queryKey = getGetHouseholdMeterCommissioningQueryKey(assetId);
  const query = useGetHouseholdMeterCommissioning(assetId, {
    query: { queryKey, staleTime: 15_000, refetchInterval: 60_000 },
  });
  const udpQuery = useGetAssetUdpHealth(assetId, {
    query: {
      queryKey: getGetAssetUdpHealthQueryKey(assetId),
      staleTime: 60_000,
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const mutation = useUpdateHouseholdMeterCommissioning({
    mutation: {
      onSuccess: (data) => {
        setError(null);
        setOverrideOpen(false);
        setOverrideReason("");
        queryClient.setQueryData(queryKey, data);
      },
      onError: (err) => setError(err instanceof Error ? err.message : "Update failed"),
    },
    request: { headers: operatorHeaders() },
  });

  const act = (data: UpdateCommissioningBody) => {
    if (!getOperator()) {
      setError("Sign in as an operator (top of the Commissioning tab) before recording actions");
      return;
    }
    mutation.mutate({ assetId, data });
  };

  if (query.isLoading) {
    return (
      <div className="space-y-1.5 p-3">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <p className="text-[11px] text-destructive p-3">Failed to load commissioning detail</p>;
  }
  const d = query.data;
  const busy = mutation.isPending;
  const gateOf = (n: number) => d.checks.filter((c) => c.gate === n);

  return (
    <div className="p-3 space-y-3 bg-muted/20" data-testid={`commissioning-panel-${assetId}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <GateStepper stage={d.session.stage} onSetStage={(s) => act({ action: "setStage", stage: s as "gate1" | "gate2" | "gate3" })} busy={busy} />
        <span className="text-[10px] text-muted-foreground">Evaluated {formatTimeAgo(d.evaluatedAt)}</span>
      </div>

      {error && (
        <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/25 rounded-md px-2.5 py-1.5" data-testid={`text-commissioning-error-${assetId}`}>
          {error}
        </p>
      )}

      <UdpModemHealthPanel data={udpQuery.data} loading={udpQuery.isLoading} compact />

      {d.session.stage === "approved" && (
        <div className="flex items-start gap-2 text-[11px] bg-emerald-500/10 border border-emerald-500/25 rounded-md px-2.5 py-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-600 dark:text-emerald-400">
              Approved by {d.session.approvedBy} {d.session.approvedAt ? `on ${formatDateTime(d.session.approvedAt)}` : ""}
            </p>
            {d.session.overrideReason && (
              <p className="text-[10px] text-muted-foreground">Authorised override: {d.session.overrideReason}</p>
            )}
          </div>
        </div>
      )}

      {/* Blockers */}
      {d.blockers.length > 0 && d.session.stage !== "approved" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1" data-testid={`blockers-${assetId}`}>
          <p className="text-[11px] font-semibold flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" /> {d.blockers.length} approval blocker{d.blockers.length !== 1 ? "s" : ""}
          </p>
          <ul className="space-y-0.5">
            {d.blockers.map((b) => (
              <li key={b.checkCode} className="text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground">{b.label}</span> — {b.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gates */}
      {GATES.map((g) => (
        <div key={g.gate} className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
          <ul className="space-y-1.5">
            {gateOf(g.gate).map((c) => (
              <CheckRow
                key={c.checkCode}
                assetId={assetId}
                check={c}
                busy={busy}
                onRecord={(checkCode, result, notes) => act({ action: "recordManualCheck", checkCode, result, notes })}
              />
            ))}
          </ul>
        </div>
      ))}

      <div className="grid gap-2 sm:grid-cols-2">
        <CommsTestPanel d={d} onStart={() => act({ action: "startCommsTest" })} busy={busy} />
        <RtcDriftPanel d={d} />
        <SamplingPanel d={d} onSetBatch={(n) => act({ action: "setBatchSize", batchSize: n })} busy={busy} />
        <ModemIccidPanel assetId={assetId} />
      </div>

      {/* Approval */}
      {d.session.stage !== "approved" && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Button
            size="sm"
            className="h-8 text-[11px]"
            disabled={busy || !d.canApprove}
            data-testid={`button-approve-${assetId}`}
            onClick={() => act({ action: "approve" })}
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Approve commissioning
          </Button>
          {!d.canApprove && isAdminRole() && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[11px] text-amber-600 dark:text-amber-400"
              disabled={busy}
              data-testid={`button-override-open-${assetId}`}
              onClick={() => setOverrideOpen((o) => !o)}
            >
              Authorised override…
            </Button>
          )}
        </div>
      )}
      {overrideOpen && d.session.stage !== "approved" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5" data-testid={`override-modal-${assetId}`}>
          <p className="text-[10px] text-muted-foreground">
            Override approves despite {d.blockers.length} blocker(s). The reason, operator and timestamp are stored in the audit log.
          </p>
          <div className="flex items-center gap-1.5">
            <Input
              data-testid={`input-override-reason-${assetId}`}
              className="h-7 text-[11px] flex-1"
              placeholder="Override reason (required)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-[11px]"
              disabled={busy || !overrideReason.trim()}
              data-testid={`button-override-approve-${assetId}`}
              onClick={() => act({ action: "approve", overrideReason: overrideReason.trim() })}
            >
              Approve with override
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
