import '@/lib/server-guard';
import type { AreaGeometry, LatLng, LinearRing } from './types';
import { validateAreaGeometry } from './polygon';

/**
 * Free, per-county ArcGIS parcel FeatureServers, verified to return real
 * polygon geometry with attributes (not just rendered tiles), keyed by the
 * market's mall abbreviation so a market can be wired up one at a time
 * without a bigger schema change.
 *
 * PILOT: Randolph County, NC only (the ASHE market / Asheboro Mall), verified
 * directly - see the query test in this session's history. Adding another
 * county means adding another entry here with its own field mapping, since
 * every county names its columns differently.
 */
export interface CountyParcelSource {
  /** Human label shown as the geometry's provenance. */
  label: string;
  queryUrl: string;
  /** Field mapping - every county names its own columns differently. */
  fields: {
    parcelId: string;
    ownerName: string | null;
    acreage: string | null;
    situsAddress: string | null;
  };
  /**
   * 'exact' (default) matches the PIN field verbatim. 'prefix' matches the
   * field starting with the given PIN - some counties (Bibb Co. GA) publish
   * a shorter parcel number in their own records than the full PIN their GIS
   * layer stores (a trailing sub-parcel suffix gets appended), so an exact
   * match never finds them.
   */
  matchMode?: 'exact' | 'prefix';
  /**
   * For sources with no PIN in the source spreadsheet at all, matching has to
   * go by street address instead. Most counties store the whole situs address
   * in one field (fields.situsAddress works as-is with an exact match); a few
   * (Victoria Co. TX) split it into a house-number field and a street-name
   * field, so those provide a custom WHERE-clause builder instead. Returning
   * null means "don't even try" (e.g. no house number in the address).
   */
  addressWhere?: (address: string) => string | null;
}

export const COUNTY_PARCEL_SOURCES: Record<string, CountyParcelSource> = {
  ASHE: {
    label: 'Randolph County, NC GIS',
    queryUrl: 'https://gis.randolphcountync.gov/arcgis/rest/services/PW/PW_ParcelMap/FeatureServer/14/query',
    fields: {
      parcelId: 'PIN', ownerName: 'ACCT_NAME', acreage: 'TAX_ACRES', situsAddress: 'LOCADDRESS',
    },
  },
  BRN: {
    label: 'Henderson County, NC GIS',
    queryUrl: 'https://gisweb.hendersoncountync.gov/arcgis/rest/services/Parcels/FeatureServer/0/query',
    fields: {
      parcelId: 'PIN', ownerName: 'PROPERTY_OWNER', acreage: 'ACREAGE', situsAddress: 'LOCATION_ADDR',
    },
  },
  CARO: {
    label: 'Cabarrus County, NC GIS',
    queryUrl: 'https://location.cabarruscounty.us/arcgisservices/rest/services/OpenData/Tax_Parcels/MapServer/1/query',
    fields: {
      parcelId: 'PIN14', ownerName: 'AcctName1', acreage: 'CALCULATED_ACREAGE', situsAddress: null,
    },
  },
  DALT: {
    label: 'Whitfield County, GA GIS',
    queryUrl: 'https://gis.whitfieldcountyga.com/server/rest/services/Parcels_and_Development/MapServer/4/query',
    fields: {
      parcelId: 'PARCEL_FUL', ownerName: 'lastname', acreage: 'totalacres', situsAddress: 'street_nam',
    },
  },
  GLEN: {
    label: 'Indiana statewide parcels GIS (Allen County)',
    queryUrl: 'https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query',
    fields: {
      parcelId: 'parcel_id', ownerName: null, acreage: null, situsAddress: 'prop_add',
    },
  },
  MACON: {
    label: 'Bibb County, GA GIS',
    queryUrl: 'https://services2.arcgis.com/zPFLSOZ5HzUzzTQb/arcgis/rest/services/Parcel_Data_2020/FeatureServer/0/query',
    fields: {
      parcelId: 'PARCEL_NO', ownerName: 'LASTNAME', acreage: 'TOTALACRES', situsAddress: 'SITEADDRESS',
    },
    matchMode: 'prefix',
  },
  CITRUS: {
    label: 'Hillsborough County, FL GIS',
    queryUrl: 'https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/HCPA_Parcels_All/FeatureServer/0/query',
    fields: {
      parcelId: 'FOLIO', ownerName: 'OWNER', acreage: 'ACREAGE', situsAddress: 'SITE_ADDR',
    },
  },
  LEIGH: {
    label: 'Lowndes County, MS GIS',
    queryUrl: 'https://services9.arcgis.com/IX0iMrnqj0M8ZIjn/arcgis/rest/services/Lowndes_Service1/FeatureServer/8/query',
    fields: {
      parcelId: 'PARCEL_ID', ownerName: 'OWNERNAME', acreage: 'TOTAL_AC', situsAddress: 'SITUS_ADDR',
    },
  },
  VIC: {
    label: 'Victoria County, TX GIS',
    queryUrl: 'https://services6.arcgis.com/TFRbpkUZXMMkfhmY/arcgis/rest/services/VictoriaCADWebService/FeatureServer/0/query',
    fields: {
      parcelId: 'prop_id_text', ownerName: 'file_as_name', acreage: 'legal_acreage', situsAddress: null,
    },
    addressWhere: (address) => {
      const m = address.trim().match(/^(\d+)\s+(?:N|S|E|W)\s+(.+)$/i) ?? address.trim().match(/^(\d+)\s+(.+)$/i);
      if (!m) return null;
      const num = m[1]!.replace(/'/g, "''");
      const street = m[2]!.trim().replace(/'/g, "''").toUpperCase();
      if (!street) return null;
      return `situs_num='${num}' AND situs_street='${street}'`;
    },
  },
};

export interface CountyParcelMatch {
  geometry: AreaGeometry;
  parcelId: string | null;
  ownerName: string | null;
  acreage: number | null;
  situsAddress: string | null;
  sourceLabel: string;
}

interface EsriPolygonGeometry {
  rings: number[][][];
}

function esriRingsToGeometry(rings: number[][][]): AreaGeometry {
  // Esri returns [lng, lat] pairs already (we request outSR=4326), same order
  // as GeoJSON, but does not distinguish outer rings from holes by winding the
  // way GeoJSON expects - validateAreaGeometry normalises winding for us.
  const closed: LinearRing[] = rings.map((ring) => {
    const positions = ring.map(([lng, lat]) => [lng, lat] as [number, number]);
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) positions.push(first);
    return positions;
  });
  return validateAreaGeometry({ type: 'Polygon', coordinates: closed });
}

function extractMatch(
  body: { features?: Array<{ attributes: Record<string, unknown>; geometry?: EsriPolygonGeometry }> },
  source: CountyParcelSource,
): CountyParcelMatch | null {
  const feature = body.features?.[0];
  if (!feature?.geometry?.rings?.length) return null;

  const get = (field: string | null): string | null => {
    if (!field) return null;
    const v = feature.attributes[field];
    return v == null || v === '' ? null : String(v);
  };
  const acreageField = source.fields.acreage;
  const acreageRaw = acreageField ? feature.attributes[acreageField] : null;
  const acreage = typeof acreageRaw === 'number' ? acreageRaw : null;

  return {
    geometry: esriRingsToGeometry(feature.geometry.rings),
    parcelId: get(source.fields.parcelId),
    ownerName: get(source.fields.ownerName),
    acreage,
    situsAddress: get(source.fields.situsAddress),
    sourceLabel: source.label,
  };
}

/**
 * Looks up the real parcel containing a point from a county's own GIS feed.
 * Returns null on any failure (network, no match, bad response) rather than
 * throwing - this is a "nice to have if available" enrichment, never a
 * blocker for saving a property.
 */
export async function lookupCountyParcel(point: LatLng, marketKey: string): Promise<CountyParcelMatch | null> {
  const source = COUNTY_PARCEL_SOURCES[marketKey];
  if (!source) return null;

  const params = new URLSearchParams({
    geometry: `${point.lng},${point.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });

  try {
    const res = await fetch(`${source.queryUrl}?${params.toString()}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return extractMatch(await res.json(), source);
  } catch {
    return null;
  }
}

/**
 * Looks up a parcel by its own ID (PIN/REID/etc, whatever the county calls
 * it) rather than by point - strictly more reliable than a coordinate lookup
 * when the source data already names the exact parcel, since it sidesteps
 * geocoding uncertainty entirely.
 */
export async function lookupCountyParcelByPin(parcelId: string, marketKey: string): Promise<CountyParcelMatch | null> {
  const source = COUNTY_PARCEL_SOURCES[marketKey];
  if (!source) return null;

  const escaped = parcelId.replace(/'/g, "''");
  const where = source.matchMode === 'prefix'
    ? `${source.fields.parcelId} LIKE '${escaped}%'`
    : `${source.fields.parcelId}='${escaped}'`;

  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });

  try {
    const res = await fetch(`${source.queryUrl}?${params.toString()}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return extractMatch(await res.json(), source);
  } catch {
    return null;
  }
}

/**
 * Looks up a parcel by street address - the fallback for source spreadsheets
 * that never recorded a parcel PIN at all. Strictly less reliable than a PIN
 * or point match (free-text address formatting varies), so only use it when
 * there's nothing better to go on.
 */
export async function lookupCountyParcelByAddress(address: string, marketKey: string): Promise<CountyParcelMatch | null> {
  const source = COUNTY_PARCEL_SOURCES[marketKey];
  if (!source) return null;

  let where: string | null = null;
  if (source.addressWhere) {
    where = source.addressWhere(address);
  } else if (source.fields.situsAddress) {
    where = `${source.fields.situsAddress}='${address.trim().replace(/'/g, "''")}'`;
  }
  if (!where) return null;

  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });

  try {
    const res = await fetch(`${source.queryUrl}?${params.toString()}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return extractMatch(await res.json(), source);
  } catch {
    return null;
  }
}
