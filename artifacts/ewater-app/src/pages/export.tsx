import { useState, useMemo } from "react";
import { Layout } from "@/components/layout";
import { useGetEntityHierarchy } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Globe, Droplet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Scope = "waterSystem" | "country" | "all";

export default function ExportPage() {
  const { data: hierarchy, isLoading } = useGetEntityHierarchy();

  const [scope, setScope] = useState<Scope>("waterSystem");
  const [selectedCountry, setSelectedCountry] = useState<number | "">("");
  const [selectedWaterSystem, setSelectedWaterSystem] = useState<number | "">("");
  const [isDownloading, setIsDownloading] = useState(false);

  const countries = hierarchy?.countries ?? [];

  const waterSystemsForCountry = useMemo(() => {
    if (scope === "waterSystem" && selectedCountry !== "") {
      return countries.find((c) => c.id === Number(selectedCountry))?.waterSystems ?? [];
    }
    return [];
  }, [countries, selectedCountry, scope]);

  const allWaterSystems = useMemo(
    () => countries.flatMap((c) => c.waterSystems),
    [countries],
  );

  const estimatedAssets = useMemo(() => {
    if (scope === "all") return 1868;
    if (scope === "country" && selectedCountry !== "") {
      const c = countries.find((x) => x.id === Number(selectedCountry));
      if (!c) return null;
      return c.waterSystems.reduce((sum, w) => sum + (w.assetCount ?? 0), 0);
    }
    if (scope === "waterSystem" && selectedWaterSystem !== "") {
      const ws = allWaterSystems.find((w) => w.id === Number(selectedWaterSystem));
      return ws?.assetCount ?? null;
    }
    return null;
  }, [scope, selectedCountry, selectedWaterSystem, countries, allWaterSystems]);

  const isReady = useMemo(() => {
    if (scope === "all") return true;
    if (scope === "country") return selectedCountry !== "";
    if (scope === "waterSystem") return selectedWaterSystem !== "";
    return false;
  }, [scope, selectedCountry, selectedWaterSystem]);

  const estimatedMinutes = estimatedAssets != null
    ? Math.ceil(estimatedAssets / 10 * 0.4 / 60)
    : null;

  function buildExportUrl(): string {
    const base = `${import.meta.env.BASE_URL}api/ewater/export/fcf-csv`;
    const params = new URLSearchParams();
    if (scope === "country" && selectedCountry !== "") {
      params.set("countryId", String(selectedCountry));
    }
    if (scope === "waterSystem" && selectedWaterSystem !== "") {
      params.set("waterSystemId", String(selectedWaterSystem));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const url = buildExportUrl();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `ewater-fcf-lcf-fx-${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsDownloading(false);
    }
  }

  const scopeOptions: { value: Scope; label: string; icon: typeof Globe }[] = [
    { value: "waterSystem", label: "Water system", icon: Droplet },
    { value: "country", label: "Country", icon: Globe },
    { value: "all", label: "All assets", icon: Download },
  ];

  return (
    <Layout title="Export" showBack backTo="/assets">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Download a CSV of Asset ID, Name, FCF, LCF, and FX for any scope of
          assets.
        </p>

        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Scope
              </p>
              <div className="flex gap-2">
                {scopeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setScope(opt.value);
                      setSelectedCountry("");
                      setSelectedWaterSystem("");
                    }}
                    className={cn(
                      "flex-1 py-2 px-2 text-xs font-semibold rounded-lg border transition-colors flex flex-col items-center gap-1",
                      scope === opt.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:bg-muted",
                    )}
                  >
                    <opt.icon className="w-4 h-4" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {scope === "waterSystem" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                    Country
                  </label>
                  <select
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
                    value={selectedCountry}
                    onChange={(e) => {
                      setSelectedCountry(e.target.value === "" ? "" : Number(e.target.value));
                      setSelectedWaterSystem("");
                    }}
                    disabled={isLoading}
                  >
                    <option value="">Select country…</option>
                    {countries.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCountry !== "" && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Water system
                    </label>
                    <select
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
                      value={selectedWaterSystem}
                      onChange={(e) =>
                        setSelectedWaterSystem(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                    >
                      <option value="">Select water system…</option>
                      {waterSystemsForCountry.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                          {w.assetCount != null ? ` (${w.assetCount})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {scope === "country" && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                  Country
                </label>
                <select
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card"
                  value={selectedCountry}
                  onChange={(e) =>
                    setSelectedCountry(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  disabled={isLoading}
                >
                  <option value="">Select country…</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {scope === "all" && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800">
                  Exporting all ~1868 assets requires ~1868 API calls and may take
                  several minutes.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {isReady && estimatedAssets != null && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">
                    {estimatedAssets} asset{estimatedAssets !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Columns: Asset ID, Asset Name, Water System, Country, FCF, LCF, FX
                  </p>
                  {estimatedMinutes != null && estimatedMinutes > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Estimated time: ~{estimatedMinutes} min
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <button
          onClick={handleDownload}
          disabled={!isReady || isDownloading}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm transition-colors",
            isReady && !isDownloading
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {isDownloading ? (
            <>
              <Download className="w-4 h-4 animate-bounce" />
              Generating CSV…
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Download CSV
            </>
          )}
        </button>

        {isDownloading && (
          <p className="text-xs text-center text-muted-foreground">
            Fetching calibration settings for each asset — this may take a
            moment…
          </p>
        )}
      </div>
    </Layout>
  );
}
