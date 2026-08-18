---
name: Pulse O&M integration constraints
description: Durable non-obvious behaviors of the Pulse jobs/faults APIs (verified live) that shape any O&M work
---

- **Pulse has no asset-scoped job listing.** WorkQueue and GetFaults are per-user views (`userId` required). Asset job lookup must fan out across AssignableUsers queues; **unassigned jobs appear in no queue and are invisible** — any UI listing jobs must account for this.
- **RecordJobEvents payload rules (undocumented):** each record needs a client-generated UUID `jobRecordId` even though swagger marks it optional, and `data` must be a JSON string validated per record type — `"{}"` is the minimal accepted payload, `Completion` accepts `{"notes":...}` and closes the job, `Action` requires a specific typed payload beyond just `actionType`.
- **CreateManualJob silently ignores `assigneeUserId`** (returned job has it null) — assign via a follow-up ReassignJob call or the job stays unassigned and invisible in every work queue.
- **CancelJob takes no reason** — operator reasons can only live in our local audit trail. Cancel/reassign of closed jobs → 409 with a meaningful `errorMessage`; pass upstream 4xx statuses and messages through to clients rather than mapping everything to 502.
- Pulse `entityId` is int32 (= Number(eWater assetId)); `entityType:"Asset"` is mandatory on job creation and ManualCreateOptions. Fault-linked job types require a `faultObservation` from their `humanObservations` list. Pulse fault `severity` int: lower = more severe.
