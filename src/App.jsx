import { useEffect, useMemo, useRef, useState } from 'react'
import MapPicker from './components/MapPicker'
import {
  playImpactTone,
  requestNotificationPermission,
  sendSystemNotification,
  speakText,
} from './utils/alerts'
import { haversineDistanceMeters, validateCoordinates } from './utils/geo'
import { loadGeofences, saveGeofences } from './utils/storage'

const TRACKING_INTERVAL_MS = 30000
const RADIUS_OPTIONS = [50, 100, 500]

const defaultForm = {
  name: '',
  task: '',
  radius: 100,
  lat: '',
  lng: '',
}

const THEME_BY_MODE = {
  neutral: 'from-slate-900 via-slate-800 to-slate-900',
  office: 'from-blue-900 via-blue-700 to-cyan-700',
  gym: 'from-red-900 via-red-700 to-rose-700',
  home: 'from-emerald-900 via-green-700 to-teal-700',
}

const modeForName = (name) => {
  const lower = name.toLowerCase()
  if (lower.includes('office') || lower.includes('work')) return 'office'
  if (lower.includes('gym') || lower.includes('fit')) return 'gym'
  if (lower.includes('home')) return 'home'
  return 'neutral'
}

const geoStatusText = {
  pending: 'Waiting for location permission',
  granted: 'Location tracking is ON',
  denied: 'Location permission denied',
  unsupported: 'Geolocation not supported',
  unavailable: 'Location currently unavailable',
  timeout: 'Location request timed out',
}

const notificationStatusText = {
  pending: 'Checking notification permission',
  granted: 'Notifications are ON',
  denied: 'Notifications are blocked',
  default: 'Please allow notifications',
  unsupported: 'Notifications not supported',
}

const mapPhotonResult = (feature) => {
  const [lon, lat] = feature?.geometry?.coordinates || []
  const props = feature?.properties || {}
  const labelParts = [props.name, props.city, props.state, props.country].filter(Boolean)

  return {
    place_id: props.osm_id || `${lat}-${lon}-${props.name || 'location'}`,
    display_name: labelParts.join(', '),
    name: props.name || labelParts[0] || 'Selected Location',
    lat: String(lat),
    lon: String(lon),
  }
}

const fetchLocationSuggestions = async (query, signal) => {
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(
    query,
  )}`
  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`

  try {
    const response = await fetch(nominatimUrl, { signal })
    if (!response.ok) throw new Error('nominatim_failed')
    const data = await response.json()
    if (Array.isArray(data) && data.length > 0) {
      return data
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error
  }

  const fallbackResponse = await fetch(photonUrl, { signal })
  if (!fallbackResponse.ok) {
    throw new Error('location_search_failed')
  }
  const fallbackData = await fallbackResponse.json()
  const features = Array.isArray(fallbackData?.features) ? fallbackData.features : []
  return features.map(mapPhotonResult).filter((item) => item.lat && item.lon)
}

function App() {
  const [geofences, setGeofences] = useState(() => loadGeofences())
  const [form, setForm] = useState(defaultForm)
  const [locationQuery, setLocationQuery] = useState('')
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const [locationSearchError, setLocationSearchError] = useState('')
  const [currentPosition, setCurrentPosition] = useState(null)
  const [distances, setDistances] = useState({})
  const [activeFenceId, setActiveFenceId] = useState(null)
  const [geoStatus, setGeoStatus] = useState('pending')
  const [notificationStatus, setNotificationStatus] = useState('pending')
  const [errorMessage, setErrorMessage] = useState('')

  const watchIdRef = useRef(null)
  const insideRef = useRef({})

  useEffect(() => {
    saveGeofences(geofences)
  }, [geofences])

  useEffect(() => {
    let mounted = true
    requestNotificationPermission().then((status) => {
      if (mounted) {
        setNotificationStatus(status)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unsupported')
      return
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setGeoStatus('granted')
        setCurrentPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      (error) => {
        if (error.code === 1) {
          setGeoStatus('denied')
          setErrorMessage('Geolocation permission denied. Enable location access.')
        } else if (error.code === 2) {
          setGeoStatus('unavailable')
          setErrorMessage('Location unavailable. Move to a clearer area and retry.')
        } else if (error.code === 3) {
          setGeoStatus('timeout')
          setErrorMessage('Location request timed out. Tracking may be delayed.')
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 20000,
      },
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!currentPosition || geofences.length === 0) {
      return
    }

    const evaluateGeofences = () => {
      const distanceMap = {}
      let nearestInside = null

      geofences.forEach((fence) => {
        const distance = haversineDistanceMeters(currentPosition, {
          lat: fence.lat,
          lng: fence.lng,
        })
        distanceMap[fence.id] = distance

        const inside = distance <= Number(fence.radius)
        const wasInside = Boolean(insideRef.current[fence.id])
        insideRef.current[fence.id] = inside

        if (inside && !wasInside) {
          sendSystemNotification({
            title: `Reached ${fence.name}`,
            body: fence.task || 'Location reminder triggered.',
          })
          playImpactTone()
          speakText(
            `You have reached ${fence.name}. ${
              fence.task || 'Your location reminder is now active.'
            }`,
          )
        }

        if (inside) {
          if (!nearestInside || distance < nearestInside.distance) {
            nearestInside = { id: fence.id, distance }
          }
        }
      })

      setDistances(distanceMap)
      setActiveFenceId(nearestInside?.id ?? null)
    }

    evaluateGeofences()
    const intervalId = window.setInterval(evaluateGeofences, TRACKING_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [currentPosition, geofences])

  useEffect(() => {
    const query = locationQuery.trim()
    if (query.length < 3) {
      setLocationSuggestions([])
      setLocationSearchError('')
      setIsSearchingLocation(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setIsSearchingLocation(true)
      setLocationSearchError('')
      try {
        const data = await fetchLocationSuggestions(query, controller.signal)
        setLocationSuggestions(Array.isArray(data) ? data : [])
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLocationSuggestions([])
          setLocationSearchError('Could not fetch suggestions. Check internet and try again.')
        }
      } finally {
        setIsSearchingLocation(false)
      }
    }, 450)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [locationQuery])

  const activeFence = useMemo(
    () => geofences.find((fence) => fence.id === activeFenceId) ?? null,
    [activeFenceId, geofences],
  )
  const { valid: hasSelectedCoords, parsedLat, parsedLng } = validateCoordinates(form.lat, form.lng)
  const selectedMapPosition = hasSelectedCoords ? [parsedLat, parsedLng] : null
  const currentMapPosition = currentPosition ? [currentPosition.lat, currentPosition.lng] : null
  const mapCenter = selectedMapPosition || currentMapPosition || [28.6139, 77.209]

  const themeClass = THEME_BY_MODE[activeFence?.mode || 'neutral']

  const handleGetCurrentLocation = () => {
    if (!('geolocation' in navigator)) {
      setErrorMessage('Geolocation is not supported by this browser.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((prev) => ({
          ...prev,
          name: prev.name.trim() || 'My Current Location',
          lat: String(position.coords.latitude),
          lng: String(position.coords.longitude),
        }))
        setLocationQuery('My Current Location')
        setErrorMessage('')
      },
      (error) => {
        if (error.code === 1) {
          setErrorMessage('Permission denied for current location access.')
        } else {
          setErrorMessage('Could not fetch current coordinates.')
        }
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const handleAddGeofence = (event) => {
    event.preventDefault()

    const { valid, parsedLat, parsedLng } = validateCoordinates(form.lat, form.lng)
    if (!valid) {
      setErrorMessage('Pick a place or use current location first.')
      return
    }

    const radius = Number(form.radius)
    if (!Number.isFinite(radius) || radius <= 0) {
      setErrorMessage('Radius must be a positive number in meters.')
      return
    }

    const name =
      form.name.trim() || locationQuery.split(',')[0]?.trim() || `Destination ${geofences.length + 1}`
    const fence = {
      id: crypto.randomUUID(),
      name,
      task: form.task.trim() || `You reached ${name}. Check your task.`,
      radius,
      lat: parsedLat,
      lng: parsedLng,
      mode: modeForName(name),
    }

    setGeofences((prev) => [fence, ...prev].slice(0, 20))
    setForm(defaultForm)
    setLocationQuery('')
    setLocationSuggestions([])
    setLocationSearchError('')
    setErrorMessage('')
  }

  const handleSuggestionSelect = (suggestion) => {
    const label = suggestion.display_name || ''
    const shortName = suggestion.name || label.split(',')[0] || ''
    setForm((prev) => ({
      ...prev,
      name: shortName || prev.name,
      lat: suggestion.lat,
      lng: suggestion.lon,
    }))
    setLocationQuery(label)
    setLocationSuggestions([])
    setLocationSearchError('')
    setErrorMessage('')
  }

  const handleMapPick = ({ lat, lng }) => {
    setForm((prev) => ({
      ...prev,
      lat: String(lat),
      lng: String(lng),
      name: prev.name.trim() || 'Pinned Destination',
    }))
    setLocationSuggestions([])
    setLocationSearchError('')
    setErrorMessage('')
  }

  const handleDelete = (id) => {
    setGeofences((prev) => prev.filter((fence) => fence.id !== id))
    setDistances((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
    if (activeFenceId === id) {
      setActiveFenceId(null)
    }
    delete insideRef.current[id]
  }

  return (
    <main
      className={`min-h-screen bg-gradient-to-br ${themeClass} px-4 py-6 text-white transition-colors duration-500`}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
          <h1 className="text-2xl font-bold">GeoTask Impact Tracker</h1>
          <p className="mt-1 text-sm text-white/90">
            Add destination in seconds. You get alert when you enter the selected radius.
          </p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <p className="rounded-lg bg-black/20 p-2">{geoStatusText[geoStatus] || geoStatus}</p>
            <p className="rounded-lg bg-black/20 p-2">
              {notificationStatusText[notificationStatus] || notificationStatus}
            </p>
            <p className="rounded-lg bg-black/20 p-2">
              Active Mode: {activeFence ? activeFence.name : 'Idle'}
            </p>
          </div>
          {errorMessage ? (
            <p className="mt-3 rounded-lg border border-red-300/40 bg-red-500/30 p-2 text-xs">
              {errorMessage}
            </p>
          ) : null}
        </header>

        <section className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
          <h2 className="text-lg font-semibold">Add Destination</h2>
          <form className="mt-3 space-y-3" onSubmit={handleAddGeofence}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleGetCurrentLocation}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                Use My Current Location
              </button>
              <p className="self-center text-xs text-white/70">
                Quick setup: tap button above or search place below.
              </p>
            </div>

            <div>
              <div>
                <input
                  className="w-full rounded-xl border border-white/20 bg-black/20 p-3 text-sm outline-none placeholder:text-white/60"
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && locationSuggestions.length > 0) {
                      e.preventDefault()
                      handleSuggestionSelect(locationSuggestions[0])
                    }
                  }}
                  placeholder="Type destination (e.g. Office, Mall Road, New York)"
                />
                {locationQuery.trim().length > 0 ? (
                  <div className="mt-2 rounded-xl border border-white/20 bg-black/20 p-2 text-xs">
                    {isSearchingLocation ? (
                      <p className="px-2 py-1 text-white/70">Searching...</p>
                    ) : locationSuggestions.length > 0 ? (
                      <div className="max-h-40 space-y-1 overflow-auto">
                        {locationSuggestions.map((suggestion) => (
                          <button
                            key={suggestion.place_id}
                            type="button"
                            onClick={() => handleSuggestionSelect(suggestion)}
                            className="w-full rounded-lg px-2 py-2 text-left text-white/90 hover:bg-white/10"
                          >
                            {suggestion.display_name}
                          </button>
                        ))}
                      </div>
                    ) : locationQuery.trim().length >= 3 ? (
                      <p className="px-2 py-1 text-white/70">
                        {locationSearchError || 'No suggestions found.'}
                      </p>
                    ) : (
                      <p className="px-2 py-1 text-white/70">Type at least 3 letters.</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="w-full rounded-xl border border-white/20 bg-black/20 p-3 text-sm outline-none placeholder:text-white/60"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Destination name (auto-filled)"
              />
              <input
                className="w-full rounded-xl border border-white/20 bg-black/20 p-3 text-sm outline-none placeholder:text-white/60"
                value={form.task}
                onChange={(e) => setForm((prev) => ({ ...prev, task: e.target.value }))}
                placeholder="Reminder (optional)"
              />
            </div>

            <div>
              <p className="mb-2 text-xs text-white/80">Alert radius</p>
              <div className="flex gap-2">
                {RADIUS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, radius: option }))}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                      form.radius === option ? 'bg-cyan-500 text-white' : 'bg-black/30 text-white/85'
                    }`}
                  >
                    {option}m
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-white/80">
                Live map picker: tap anywhere to set destination coordinates.
              </p>
              <MapPicker
                center={mapCenter}
                selectedPosition={selectedMapPosition}
                currentPosition={currentMapPosition}
                onPick={handleMapPick}
              />
            </div>

            <details className="rounded-xl border border-white/20 bg-black/10 p-3 text-xs text-white/80">
              <summary className="cursor-pointer select-none">Advanced: manual coordinates</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  type="number"
                  className="rounded-xl border border-white/20 bg-black/20 p-3 text-sm outline-none"
                  value={form.lat}
                  onChange={(e) => setForm((prev) => ({ ...prev, lat: e.target.value }))}
                  placeholder="Latitude"
                  step="any"
                />
                <input
                  type="number"
                  className="rounded-xl border border-white/20 bg-black/20 p-3 text-sm outline-none"
                  value={form.lng}
                  onChange={(e) => setForm((prev) => ({ ...prev, lng: e.target.value }))}
                  placeholder="Longitude"
                  step="any"
                />
              </div>
            </details>

            <button
              type="submit"
              className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-400"
            >
              Save Destination Reminder
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
          <h2 className="text-lg font-semibold">Active Geofences ({geofences.length})</h2>
          <div className="mt-3 space-y-3">
            {geofences.length === 0 ? (
              <p className="text-sm text-white/80">No saved locations yet.</p>
            ) : (
              geofences.map((fence) => {
                const distance = distances[fence.id]
                const inside =
                  typeof distance === 'number' && Number.isFinite(distance)
                    ? distance <= fence.radius
                    : false

                return (
                  <article
                    key={fence.id}
                    className={`rounded-xl border p-3 ${
                      inside
                        ? 'border-emerald-300/70 bg-emerald-500/20'
                        : 'border-white/20 bg-black/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{fence.name}</h3>
                        <p className="text-xs text-white/80">{fence.task || 'No task text provided.'}</p>
                      </div>
                      <button
                        onClick={() => handleDelete(fence.id)}
                        className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold hover:bg-rose-500"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                      <p>Radius: {fence.radius}m</p>
                      <p>
                        Distance:{' '}
                        {typeof distance === 'number' && Number.isFinite(distance)
                          ? `${Math.round(distance)}m`
                          : 'Waiting GPS...'}
                      </p>
                      <p>Lat: {fence.lat.toFixed(6)}</p>
                      <p>Lng: {fence.lng.toFixed(6)}</p>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
