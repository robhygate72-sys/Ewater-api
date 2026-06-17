import { createContext, useContext, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface FavouriteAsset {
  assetId: string;
  assetName: string;
}

interface FavouritesContextValue {
  favourites: FavouriteAsset[];
  isFavourite: (assetId: string) => boolean;
  toggleFavourite: (assetId: string, assetName: string) => void;
  bulkAdd: (assets: FavouriteAsset[]) => Promise<void>;
  bulkRemove: (assetIds: string[]) => Promise<void>;
  isLoading: boolean;
}

export const FavouritesContext = createContext<FavouritesContextValue>({
  favourites: [],
  isFavourite: () => false,
  toggleFavourite: () => {},
  bulkAdd: async () => {},
  bulkRemove: async () => {},
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

async function addFavouriteApi(assetId: string, assetName: string): Promise<void> {
  const res = await fetch("/api/ewater/favourites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, assetName }),
  });
  if (!res.ok) throw new Error("Failed to add favourite");
}

async function removeFavouriteApi(assetId: string): Promise<void> {
  const res = await fetch(`/api/ewater/favourites/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove favourite");
}

async function bulkAddApi(assets: FavouriteAsset[]): Promise<void> {
  const res = await fetch("/api/ewater/favourites/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assets }),
  });
  if (!res.ok) throw new Error("Failed to bulk add favourites");
}

async function bulkRemoveApi(assetIds: string[]): Promise<void> {
  const res = await fetch("/api/ewater/favourites/bulk", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetIds }),
  });
  if (!res.ok) throw new Error("Failed to bulk remove favourites");
}

export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  const { data: favourites = [], isLoading } = useQuery({
    queryKey: ["favourites"],
    queryFn: fetchFavourites,
    staleTime: 30_000,
  });

  const isFavourite = useCallback(
    (assetId: string) => favourites.some((f) => f.assetId === assetId),
    [favourites]
  );

  const toggleFavourite = useCallback(
    (assetId: string, assetName: string) => {
      if (isFavourite(assetId)) {
        const prev = qc.getQueryData<FavouriteAsset[]>(["favourites"]) ?? [];
        qc.setQueryData<FavouriteAsset[]>(["favourites"], prev.filter((f) => f.assetId !== assetId));
        removeFavouriteApi(assetId).catch(() => {
          qc.setQueryData(["favourites"], prev);
        }).finally(() => qc.invalidateQueries({ queryKey: ["favourites"] }));
      } else {
        const prev = qc.getQueryData<FavouriteAsset[]>(["favourites"]) ?? [];
        qc.setQueryData<FavouriteAsset[]>(["favourites"], [...prev, { assetId, assetName }]);
        addFavouriteApi(assetId, assetName).catch(() => {
          qc.setQueryData(["favourites"], prev);
        }).finally(() => qc.invalidateQueries({ queryKey: ["favourites"] }));
      }
    },
    [isFavourite, qc]
  );

  const bulkAdd = useCallback(async (assets: FavouriteAsset[]) => {
    const prev = qc.getQueryData<FavouriteAsset[]>(["favourites"]) ?? [];
    const newIds = new Set(assets.map((a) => a.assetId));
    qc.setQueryData<FavouriteAsset[]>(["favourites"], [
      ...prev.filter((f) => !newIds.has(f.assetId)),
      ...assets,
    ]);
    try {
      await bulkAddApi(assets);
    } catch (err) {
      qc.setQueryData(["favourites"], prev);
      throw err;
    } finally {
      qc.invalidateQueries({ queryKey: ["favourites"] });
    }
  }, [qc]);

  const bulkRemove = useCallback(async (assetIds: string[]) => {
    const prev = qc.getQueryData<FavouriteAsset[]>(["favourites"]) ?? [];
    const removeSet = new Set(assetIds);
    qc.setQueryData<FavouriteAsset[]>(["favourites"], prev.filter((f) => !removeSet.has(f.assetId)));
    try {
      await bulkRemoveApi(assetIds);
    } catch (err) {
      qc.setQueryData(["favourites"], prev);
      throw err;
    } finally {
      qc.invalidateQueries({ queryKey: ["favourites"] });
    }
  }, [qc]);

  return (
    <FavouritesContext.Provider value={{ favourites, isFavourite, toggleFavourite, bulkAdd, bulkRemove, isLoading }}>
      {children}
    </FavouritesContext.Provider>
  );
}
