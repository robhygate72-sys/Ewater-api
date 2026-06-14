import { useFavourites } from "@/contexts/FavouritesContext";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Star, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FavouriteButton } from "@/components/FavouriteButton";

export default function Watchlist() {
  const { favourites, isLoading } = useFavourites();

  return (
    <Layout title="Watchlist">
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))
        ) : favourites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Star className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No favourites yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Tap the ★ on any asset to add it here for monitoring.
              </p>
            </div>
            <Link href="/assets" className="text-sm text-primary underline underline-offset-2">
              Browse assets
            </Link>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground pl-0.5">
              {favourites.length} monitored asset{favourites.length !== 1 ? "s" : ""}
            </p>
            {favourites.map((fav) => (
              <Card key={fav.assetId} className="overflow-hidden">
                <div className="flex items-center">
                  <Link href={`/assets/${fav.assetId}`} className="flex-1">
                    <CardContent className="px-4 py-3.5 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{fav.assetName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Asset #{fav.assetId}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                    </CardContent>
                  </Link>
                  <div className="pr-3">
                    <FavouriteButton assetId={fav.assetId} assetName={fav.assetName} />
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </Layout>
  );
}
