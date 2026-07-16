import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Tag, ChevronRight, Users, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface WaterSystem {
  id: number;
  name: string;
  organisationName: string | null;
  countryName: string;
  assetCount: number;
}

interface TagPage {
  items: string[];
  totalCount: number;
  returnedCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

const PAGE_SIZE = 100;

export default function TagsPage() {
  const [waterSystems, setWaterSystems] = useState<WaterSystem[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
  const [tagPage, setTagPage] = useState<TagPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [isLoadingSystems, setIsLoadingSystems] = useState(true);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);

  const [searchValue, setSearchValue] = useState("");
  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    fetch("/api/ewater/entities")
      .then((r) => r.json())
      .then((d: { waterSystems?: WaterSystem[] }) => {
        const systems = (d.waterSystems ?? []).sort((a, b) => a.name.localeCompare(b.name));
        setWaterSystems(systems);
      })
      .catch(() => {})
      .finally(() => setIsLoadingSystems(false));
  }, []);

  useEffect(() => {
    if (selectedSystemId == null) { setTagPage(null); return; }
    setIsLoadingTags(true);
    setTagsError(null);
    fetch(`/api/ewater/tags?waterSystemId=${selectedSystemId}&offset=${offset}&limit=${PAGE_SIZE}`)
      .then((r) => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(e.error ?? "Failed")))
      .then((d: TagPage) => setTagPage(d))
      .catch((e: unknown) => setTagsError(String(e)))
      .finally(() => setIsLoadingTags(false));
  }, [selectedSystemId, offset]);

  const selectedSystem = waterSystems.find((w) => w.id === selectedSystemId);

  const NFC_HEX_RE = /^[0-9A-Fa-f]{8}$/;

  const handleSearch = () => {
    const v = searchInput.trim().toUpperCase();
    if (NFC_HEX_RE.test(v)) setSearchValue(v);
  };

  const handleSystemChange = (id: number | null) => {
    setSelectedSystemId(id);
    setOffset(0);
    setTagPage(null);
  };

  return (
    <Layout title="Tags" showBack backTo="/">
      <div className="space-y-4">
        {/* Search by NFC ID */}
        <Card className="shadow-sm border">
          <CardHeader className="py-3 px-4 border-b border-border/50">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Search className="w-3.5 h-3.5" />
              Search by NFC ID
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 py-3">
            <div className="flex gap-2">
              <Input
                placeholder="e.g. D32268F0"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="font-mono text-sm h-9"
              />
              <Button size="sm" onClick={handleSearch} disabled={!NFC_HEX_RE.test(searchInput.trim())}>
                Look up
              </Button>
            </div>
            {searchValue && (
              <Link
                href={`/tags/${searchValue}`}
                className="mt-2 flex items-center justify-between px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" />
                  <span className="font-mono text-sm font-medium">{searchValue}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Browse by water system */}
        <Card className="shadow-sm border">
          <CardHeader className="py-3 px-4 border-b border-border/50">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              Browse by Water System
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 py-3 space-y-3">
            {isLoadingSystems ? (
              <Skeleton className="h-9 w-full rounded-md" />
            ) : (
              <select
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                value={selectedSystemId ?? ""}
                onChange={(e) => handleSystemChange(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select a water system…</option>
                {waterSystems.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}{ws.organisationName ? ` — ${ws.organisationName}` : ""}
                  </option>
                ))}
              </select>
            )}

            {selectedSystem && (
              <p className="text-[11px] text-muted-foreground">
                {selectedSystem.countryName} · {selectedSystem.assetCount} asset{selectedSystem.assetCount !== 1 ? "s" : ""}
                {tagPage && (
                  <> · <span className="font-medium text-foreground">{tagPage.totalCount.toLocaleString()} registered tags</span></>
                )}
              </p>
            )}

            {isLoadingTags && (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            )}

            {tagsError && (
              <div className="flex items-center gap-2 text-sm text-destructive py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {tagsError}
              </div>
            )}

            {tagPage && !isLoadingTags && tagPage.items.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No registered tags found for this water system
              </p>
            )}

            {tagPage && !isLoadingTags && tagPage.items.length > 0 && (
              <div className="space-y-1">
                {tagPage.items.map((nfcId) => (
                  <Link
                    key={nfcId}
                    href={`/tags/${nfcId}`}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/40"
                  >
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="font-mono text-sm">{nfcId}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                  </Link>
                ))}

                {(tagPage.hasMore || offset > 0) && (
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      variant="outline" size="sm"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {offset + 1}–{offset + tagPage.items.length} of {tagPage.totalCount.toLocaleString()}
                    </span>
                    <Button
                      variant="outline" size="sm"
                      disabled={!tagPage.hasMore}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
