import { Router, type IRouter } from "express";
import { ewaterFetch } from "../lib/ewater-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface EntityAsset {
  id: number;
  name: string;
  parentId: number;
  assetLifecycleState?: string;
}

interface EntityWaterSystem {
  id: number;
  name: string;
  parentId: number;
}

interface EntityOrganisation {
  id: number;
  name: string;
  parentId: number;
}

interface EntityCountry {
  id: number;
  name: string;
  parentId: number;
}

interface FullEntityList {
  assets: EntityAsset[];
  waterSystems: EntityWaterSystem[];
  organisations: EntityOrganisation[];
  countries: EntityCountry[];
}

async function getFullEntityList(): Promise<FullEntityList> {
  const result = await ewaterFetch("state", "/api/Entity/List");
  const data = result.data as Partial<FullEntityList>;
  return {
    assets: data.assets ?? [],
    waterSystems: data.waterSystems ?? [],
    organisations: data.organisations ?? [],
    countries: data.countries ?? [],
  };
}

async function getScopedAssets(
  entityList: FullEntityList,
  waterSystemId?: number,
  countryId?: number,
): Promise<EntityAsset[]> {
  if (waterSystemId) {
    const result = await ewaterFetch(
      "state",
      `/api/Entity/AssetsInWaterSystem?waterSystemId=${waterSystemId}`,
    );
    return ((result.data as { assets?: EntityAsset[] }).assets) ?? [];
  }

  if (countryId) {
    const result = await ewaterFetch(
      "state",
      `/api/Entity/AssetsInCountry?countryId=${countryId}`,
    );
    return ((result.data as { assets?: EntityAsset[] }).assets) ?? [];
  }

  return entityList.assets;
}

function extractSetting(settings: Record<string, unknown>[], key: string): number | null {
  const s = settings.find((x) => x.settingKey === key);
  if (!s) return null;
  const val = (s.value as Record<string, unknown> | null)?.lastKnownValue;
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

interface AssetSettings {
  fcf: number | null;
  lcf: number | null;
  fx: number | null;
}

async function fetchSettingsForAsset(assetId: number): Promise<AssetSettings> {
  try {
    const result = await ewaterFetch(
      "state",
      `/api/Asset/GetSettingsMapForAsset?assetId=${assetId}`,
    );
    const data = result.data as Record<string, unknown> | null;
    const inner = data?.["data"] as Record<string, unknown> | null;
    const settings = Array.isArray(inner?.["settings"])
      ? (inner!["settings"] as Record<string, unknown>[])
      : Array.isArray(data?.["settings"])
        ? (data!["settings"] as Record<string, unknown>[])
        : [];

    return {
      fcf: extractSetting(settings, "FlowConversion"),
      lcf: extractSetting(settings, "LitresConversion"),
      fx: extractSetting(settings, "CurrencyConversion"),
    };
  } catch (err) {
    logger.warn({ err, assetId }, "Failed to fetch settings for asset");
    return { fcf: null, lcf: null, fx: null };
  }
}

async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function csvEscape(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// GET /api/ewater/export/fcf-csv
// Query: waterSystemId?, countryId?
// Returns text/csv
router.get("/ewater/export/fcf-csv", async (req, res): Promise<void> => {
  const waterSystemId = req.query.waterSystemId
    ? Number(req.query.waterSystemId)
    : undefined;
  const countryId = req.query.countryId
    ? Number(req.query.countryId)
    : undefined;

  req.log.info({ waterSystemId, countryId }, "FCF/LCF/FX CSV export started");

  const entityList = await getFullEntityList();

  const wsMap = new Map<number, { name: string; orgId: number }>();
  entityList.waterSystems.forEach((w) =>
    wsMap.set(w.id, { name: w.name, orgId: w.parentId }),
  );

  const orgMap = new Map<number, { name: string; countryId: number }>();
  entityList.organisations.forEach((o) =>
    orgMap.set(o.id, { name: o.name, countryId: o.parentId }),
  );

  const countryMap = new Map<number, string>();
  entityList.countries.forEach((c) => countryMap.set(c.id, c.name));

  function resolveNames(wsId: number): { wsName: string; countryName: string } {
    const ws = wsMap.get(wsId);
    if (!ws) return { wsName: "", countryName: "" };
    const org = orgMap.get(ws.orgId);
    if (!org) return { wsName: ws.name, countryName: "" };
    const cName = countryMap.get(org.countryId) ?? "";
    return { wsName: ws.name, countryName: cName };
  }

  const assets = await getScopedAssets(entityList, waterSystemId, countryId);

  req.log.info({ count: assets.length }, "Fetching EWC settings");

  const allSettings = await pMap(assets, 10, (asset) =>
    fetchSettingsForAsset(asset.id),
  );

  const rows: string[] = [
    "Asset ID,Asset Name,Water System,Country,FCF,LCF,FX",
  ];

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const s = allSettings[i];
    const { wsName, countryName } = resolveNames(a.parentId);
    rows.push(
      [
        a.id,
        csvEscape(a.name),
        csvEscape(wsName),
        csvEscape(countryName),
        s.fcf ?? "",
        s.lcf ?? "",
        s.fx ?? "",
      ].join(","),
    );
  }

  const csv = rows.join("\r\n");
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `ewater-fcf-lcf-fx-${dateStr}.csv`;

  req.log.info({ rows: rows.length - 1, filename }, "CSV export complete");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

export default router;
