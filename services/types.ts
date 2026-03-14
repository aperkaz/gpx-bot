// ── Shared Types ─────────────────────────────────────────────────────────────

export type Coordinate = {
  lat: number;
  lon: number;
};

export type OverpassElement = {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

export type OverpassResponse = {
  elements: OverpassElement[];
};

/** Generic point of interest found along a route */
export type PointOfInterest = {
  id: number;
  lat: number;
  lon: number;
  name: string;
  poiType: string;
  description: string;
  distanceAlongRoute: number; // meters from route start to nearest point
};

/** Configuration for GPX output generation */
export type GpxOutputConfig = {
  name: string;
  description: string;
};

/** Functions each script provides to classify and describe Overpass results */
export type PoiProcessor = {
  classify: (tags: Record<string, string>) => string;
  buildDescription: (tags: Record<string, string>) => string;
  defaultName: (poiType: string) => string;
};
