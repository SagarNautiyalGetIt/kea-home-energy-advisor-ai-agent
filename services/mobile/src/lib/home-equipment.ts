export type Equipment = 'solar' | 'home' | 'car' | 'battery' | 'grid';
export type Point3 = readonly [number, number, number];
export type Region = { center: Point3; half: Point3; axisX: Point3; axisY: Point3; axisZ: Point3 };
const box = (center: Point3, half: Point3): Region => ({ center, half, axisX: [1, 0, 0], axisY: [0, 1, 0], axisZ: [0, 0, 1] });
// Raycast-calibrated against the unchanged, normalized Tripo source. Solar follows
// the pitched panel plane; positive X is the equipment wall, negative Z the grid.
export const equipmentRegions: Record<Equipment, Region> = {
  solar: { center: [0.254, 0.322, -0.25], half: [0.205, 0.012, 0.382], axisX: [0.91, -0.41, 0], axisY: [0.41, 0.91, 0], axisZ: [0, 0, 1] },
  home: box([-0.1, 0.02, -0.2], [0.75, 0.405, 0.575]),
  car: box([0.38, -0.307, 0.695], [0.185, 0.093, 0.305]),
  battery: box([0.651, -0.225, 0.059], [0.028, 0.115, 0.087]),
  grid: box([0.86, -0.292, -0.916], [0.073, 0.092, 0.101]),
};
export function containsEquipment(region: Region, point: Point3): boolean {
  const delta = point.map((v, i) => v - region.center[i]!);
  return [region.axisX, region.axisY, region.axisZ].every((axis, i) => Math.abs(axis.reduce((sum, v, j) => sum + v * delta[j]!, 0)) <= region.half[i]!);
}
/** Home tint excludes individual equipment, even where their bounds intersect. */
export function equipmentAt(target: Equipment, point: Point3): boolean {
  return containsEquipment(equipmentRegions[target], point) && (target !== 'home' || (['solar', 'car', 'battery', 'grid'] as const).every(key => !containsEquipment(equipmentRegions[key], point)));
}
// Conduit topology from the private EnergyHouse reference, calibrated to visible
// roof/wall runs, the ground wire and charging cable. No inferred telemetry.
export const conduitPoints: Record<Exclude<Equipment, 'home'>, readonly Point3[]> = {
  solar: [[0.444, 0.236, -0.505], [0.448, 0.234, -0.253], [0.454, 0.231, -0.237], [0.64, 0.155, -0.237], [0.664, 0.14, -0.232], [0.676, 0.11, -0.225], [0.676, -0.085, -0.225], [0.664, -0.105, -0.218], [0.646, -0.112, -0.215], [0.646, -0.137, -0.215]],
  battery: [[0.652, -0.252, -0.216], [0.652, -0.375, -0.216], [0.654, -0.396, -0.20], [0.654, -0.397, 0.055], [0.654, -0.384, 0.07], [0.654, -0.338, 0.07]],
  grid: [[0.66, -0.252, -0.216], [0.66, -0.381, -0.216], [0.674, -0.4, -0.216], [0.724, -0.4, -0.236], [0.875, -0.4, -0.249], [0.897, -0.4, -0.269], [0.897, -0.394, -0.812], [0.897, -0.37, -0.837]],
  car: [[0.62, -0.218, 0.298], [0.62, -0.31, 0.308], [0.609, -0.392, 0.33], [0.622, -0.397, 0.525], [0.586, -0.397, 0.679], [0.553, -0.395, 0.731], [0.518, -0.395, 0.754], [0.507, -0.383, 0.761]],
};
