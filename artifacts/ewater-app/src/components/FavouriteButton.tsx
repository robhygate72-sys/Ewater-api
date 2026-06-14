import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFavourites } from "@/contexts/FavouritesContext";

interface FavouriteButtonProps {
  assetId: string;
  assetName: string;
  className?: string;
}

export function FavouriteButton({ assetId, assetName, className }: FavouriteButtonProps) {
  const { isFavourite, toggleFavourite } = useFavourites();
  const fav = isFavourite(assetId);

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavourite(assetId, assetName);
      }}
      className={cn(
        "p-2 rounded-full transition-colors",
        fav
          ? "text-amber-400 hover:bg-amber-500/10"
          : "text-muted-foreground hover:bg-muted",
        className
      )}
      title={fav ? "Remove from watchlist" : "Add to watchlist"}
    >
      <Star className={cn("w-4 h-4", fav && "fill-amber-400")} />
    </button>
  );
}
