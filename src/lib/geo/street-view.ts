/**
 * Google's documented cross-platform Maps URL scheme
 * (https://developers.google.com/maps/documentation/urls/get-started#panorama-action):
 * `map_action=pano` opens directly in Street View when imagery exists near the
 * point, and falls back to a normal map view otherwise. No API key required -
 * this just deep-links into Google's own Maps product rather than embedding
 * imagery in the app.
 */
export function streetViewUrl(lat: number, lng: number): string {
  const point = `${lat},${lng}`;
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point}`;
}
