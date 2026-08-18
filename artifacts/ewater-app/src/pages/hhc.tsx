import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { cn } from "@/lib/utils";
import { FleetTab } from "@/components/hhc/fleet-tab";
import { OperationsTab } from "@/components/hhc/operations-tab";
import { CommissioningTab } from "@/components/hhc/commissioning-tab";

type HhcTab = "overview" | "commissioning" | "operations";

const TABS: { id: HhcTab; label: string }[] = [
  { id: "overview", label: "Fleet Overview" },
  { id: "commissioning", label: "Commissioning" },
  { id: "operations", label: "Operations & Maintenance" },
];

export default function HhcPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  const rawTab = params.get("tab");
  const tab: HhcTab =
    rawTab === "commissioning" || rawTab === "operations" ? rawTab : "overview";
  const assetId = params.get("assetId");

  const navigate = useCallback(
    (nextTab: HhcTab, nextAssetId?: string | null) => {
      const p = new URLSearchParams();
      p.set("tab", nextTab);
      const id = nextAssetId === undefined ? assetId : nextAssetId;
      if (id) p.set("assetId", id);
      setLocation(`/hhc?${p.toString()}`);
    },
    [assetId, setLocation],
  );

  const selectMeter = useCallback(
    (id: string) => navigate("operations", id),
    [navigate],
  );

  return (
    <Layout title="HHC Dashboard" wide>
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-border -mx-1 px-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-testid={`tab-hhc-${t.id}`}
              onClick={() => navigate(t.id)}
              className={cn(
                "px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <FleetTab onSelectMeter={selectMeter} />}
        {tab === "commissioning" && <CommissioningTab onSelectMeter={selectMeter} />}
        {tab === "operations" && (
          <OperationsTab assetId={assetId} onSelectMeter={selectMeter} />
        )}
      </div>
    </Layout>
  );
}
