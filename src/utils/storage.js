const STORAGE_KEY = 'aps.geofences.v1'

export const loadGeofences = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const saveGeofences = (geofences) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geofences))
    return true
  } catch {
    return false
  }
}
