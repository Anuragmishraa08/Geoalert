const EARTH_RADIUS_METERS = 6371000

const toRadians = (degrees) => (degrees * Math.PI) / 180

export const haversineDistanceMeters = (from, to) => {
  const lat1 = Number(from?.lat)
  const lon1 = Number(from?.lng)
  const lat2 = Number(to?.lat)
  const lon2 = Number(to?.lng)

  if ([lat1, lon1, lat2, lon2].some((value) => Number.isNaN(value))) {
    return Infinity
  }

  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_METERS * c
}

export const validateCoordinates = (lat, lng) => {
  const parsedLat = Number(lat)
  const parsedLng = Number(lng)
  const valid =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180

  return {
    valid,
    parsedLat,
    parsedLng,
  }
}
