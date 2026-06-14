import { createContext, useContext, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface FavouriteAsset {
  assetId: string;
  assetName: string;
}

interface FavouritesContextValue {
  favourites: FavouriteAsset[];
  isFavourite: (assetId: string) => boolean;
  toggleFavourite: (assetId: string, assetName: string) => void;
  isLoading: boolean;
}

export const FavouritesContext = createContext<FavouritesContextValue>({
  favourites: [],
  isFavourite: () => false,
  toggleFavourite: () => {},
  isLoading: false,
});

export function useFavourites() {
  return useContext(FavouritesContext);
}

async function fetchFavourites(): Promise<FavouriteAsset[]> {
  const res = await fetch("/api/ewater/favourites");
  if (!res.ok) throw new Error("Failed to load favourites");
  return res.json();
}

async function addFavourite(assetId: string, assetName: string): Promise<void> {
  const res = await fetch("/api/ewater/favourites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, assetName }),
  });
  if (!res.ok) throw new Error("Failed to add favourite");
}

async function removeFavourite(assetId: string): Promise<void> {
  const res = await fetch(`/api/ewater/favourites/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove favourite");
}

export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  const { data: favourites = [], isLoading } = useQuery({
    queryKey: ["favourites"],
    queryFn: fetchFavourites,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: ({ assetId, assetName }: { assetId: string; assetName: string }) =>
      addFavourite(assetId, assetName),
    onMutate: async ({ assetId, assetName }) => {
      await qc.cancelQueries({ queryKey: ["favourites"] });
      const prev = qc.getQueryData<FavouriteAsset[]>(["favourites"]) ?? [];
      qc.setQueryData<FavouriteAsset[]>(["favourites"], [...prev, { assetId, assetName }]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favourites"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favourites"] }),
  });

  const removeMutation = useMutation({
    mutationFn: (assetId: string) => removeFavourite(assetId),
    onMutate: async (assetId) => {
      await qc.cancelQueries({ queryKey: ["favourites"] });
      const prev = qc.getQueryData<FavouriteAsset[]>(["favourites"]) ?? [];
      qc.setQueryData<FavouriteAsset[]>(["favourites"], prev.filter((f) => f.assetId !== assetId));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["favourites"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["favourites"] }),
  });

  const isFavourite = useCallback(
    (assetId: string) => favourites.some((f) => f.assetId === assetId),
    [favourites]
  );

  const toggleFavourite = useCallback(
    (assetId: string, assetName: string) => {
      if (isFavourite(assetId)) {
        removeMutation.mutate(assetId);
      } else {
        addMutation.mutate({ assetId, assetName });
      }
    },
    [isFavourite, addMutation, removeMutation]
  );

  return (
    <FavouritesContext.Provider value={{ favourites, isFavourite, toggleFavourite, isLoading }}>
      {children}
    </FavouritesContext.Provider>
  );
}
