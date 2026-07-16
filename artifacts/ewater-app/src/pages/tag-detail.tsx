import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tag, Home, Droplet, Calendar, Activity, AlertTriangle, ExternalLink } from "lucide-react";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";

interface TagInfo {
  nfcId: string;
  primaryAssetId: number | null;
  primarySystemId: number | null;
  primaryCountryId: number | null;
  householdId: string | null;
  signUpDt: string | null;
  createdDt: string | null;
  lastUsageDt: string | null;
  disbursementCount: number | null;
  topUpCount: number | null;
  credits: number | null;
  isDeleted: boolean;
  isBlacklisted: boolean;
}

interface HouseholdInfo {
  householdId: string;
  name: string | null;
  assetId: number | null;
  systemId: number | null;
  createdDt: string | null;
  lastActiveDt: string | null;
}

interface TagDetailResponse {
  tag: TagInfo;
  household: HouseholdInfo | null;
}

function Row({ label, value, mono = false, dim = false }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-xs text-right break-all", mono && "font-mono", dim && "text-muted-foreground/50")}>
        {value ?? <span className="text-muted-foreground/30">—</span>}
      </span>
    </div>
  );
}

export default function TagDetailPage() {
  const [, params] = useRoute("/tags/:nfcId");
  const nfcId = params?.nfcId?.toUpperCase() ?? "";

  const [data, setData] = useState<TagDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nfcId) return;
    setIsLoading(true);
    setError(null);
    fetch(`/api/ewater/tags/${encodeURIComponent(nfcId)}`)
      .then((r) => {
        if (r.status === 404) throw new Error("Tag not found — check the NFC ID and try again");
        if (!r.ok) return r.json().then((e: { error?: string }) => Promise.reject(e.error ?? "Request failed"));
        return r.json();
      })
      .then((d: TagDetailResponse) => setData(d))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setIsLoading(false));
  }, [nfcId]);

  const tag = data?.tag;
  const household = data?.household;

  return (
    <Layout title={`Tag ${nfcId}`} showBack backTo="/tags">
      <div className="space-y-4">
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        )}

        {error && (
          <Card className="border-destructive/40">
            <CardContent className="px-4 py-6 flex flex-col items-center gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-destructive/60" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        )}

        {tag && (
          <>
            {/* Tag card */}
            <Card className="shadow-sm border">
              <CardHeader className="py-3 px-4 border-b border-border/50">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5" />
                    NFC Tag
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    {tag.isBlacklisted && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Blacklisted</Badge>
                    )}
                    {tag.isDeleted && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Deleted</Badge>
                    )}
                    {!tag.isDeleted && !tag.isBlacklisted && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 hover:bg-emerald-500/10">
                        Active
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 py-1">
                <Row label="NFC ID" value={tag.nfcId} mono />
                <Row
                  label="Signed up"
                  value={tag.signUpDt ? formatDateTime(tag.signUpDt) : null}
                />
                <Row
                  label="Last used"
                  value={tag.lastUsageDt ? formatDateTime(tag.lastUsageDt) : null}
                  dim={!tag.lastUsageDt}
                />
                <Row label="Credits" value={tag.credits != null ? tag.credits.toFixed(3) : null} mono />
                <Row label="Dispensed" value={tag.disbursementCount != null ? `${tag.disbursementCount} times` : null} />
                <Row label="Top-ups" value={tag.topUpCount != null ? `${tag.topUpCount} times` : null} />
                {tag.primaryAssetId && (
                  <Row
                    label="Primary asset"
                    value={
                      <Link href={`/assets/${tag.primaryAssetId}`} className="text-primary hover:underline flex items-center gap-1">
                        {tag.primaryAssetId}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    }
                  />
                )}
                {tag.householdId && (
                  <Row label="Household ID" value={<span className="text-[10px]">{tag.householdId}</span>} mono />
                )}
              </CardContent>
            </Card>

            {/* Household card */}
            {household && (
              <Card className="shadow-sm border">
                <CardHeader className="py-3 px-4 border-b border-border/50">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Home className="w-3.5 h-3.5" />
                    Household
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 py-1">
                  {household.name && (
                    <Row label="Name" value={household.name} />
                  )}
                  <Row
                    label="Created"
                    value={household.createdDt ? formatDateTime(household.createdDt) : null}
                    dim={!household.createdDt}
                  />
                  <Row
                    label="Last active"
                    value={household.lastActiveDt ? formatDateTime(household.lastActiveDt) : null}
                    dim={!household.lastActiveDt}
                  />
                  {household.assetId && (
                    <Row
                      label="Asset"
                      value={
                        <Link href={`/assets/${household.assetId}`} className="text-primary hover:underline flex items-center gap-1">
                          {household.assetId}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      }
                    />
                  )}
                  <Row label="Household ID" value={<span className="text-[10px]">{household.householdId}</span>} mono />
                </CardContent>
              </Card>
            )}

            {!household && tag.householdId && (
              <Card className="shadow-sm border border-muted">
                <CardContent className="px-4 py-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Home className="w-4 h-4 shrink-0 opacity-40" />
                  Household record could not be loaded
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
