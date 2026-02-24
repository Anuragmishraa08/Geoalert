export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    return 'unsupported'
  }

  if (Notification.permission === 'granted') {
    return 'granted'
  }

  if (Notification.permission === 'denied') {
    return 'denied'
  }

  try {
    const permission = await Notification.requestPermission()
    return permission
  } catch {
    return 'denied'
  }
}

export const sendSystemNotification = ({ title, body }) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false
  }

  new Notification(title, { body, icon: '/vite.svg' })
  return true
}

export const speakText = (text) => {
  if (!('speechSynthesis' in window)) {
    return false
  }

  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1
  utterance.pitch = 1
  window.speechSynthesis.speak(utterance)
  return true
}

export const playImpactTone = () => {
  const AudioContextImpl = window.AudioContext || window.webkitAudioContext
  if (!AudioContextImpl) {
    return false
  }

  try {
    const context = new AudioContextImpl()
    const oscillator = context.createOscillator()
    const gainNode = context.createGain()

    oscillator.type = 'triangle'
    oscillator.frequency.value = 860
    gainNode.gain.value = 0.04
    oscillator.connect(gainNode)
    gainNode.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.3)
    oscillator.onended = () => context.close()
    return true
  } catch {
    return false
  }
}
