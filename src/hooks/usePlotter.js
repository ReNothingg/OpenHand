import { useCallback, useEffect, useRef, useState } from 'react'

const encoder = new TextEncoder()

function lineEnding(profile) {
  return profile === 'marlin' ? '\n' : '\r\n'
}

export function usePlotter() {
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator
  const [status, setStatus] = useState('disconnected')
  const [logs, setLogs] = useState([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const portRef = useRef(null)
  const readerRef = useRef(null)
  const writerRef = useRef(null)
  const profileRef = useRef('grbl')
  const pendingRef = useRef([])
  const abortRef = useRef(false)
  const pausedRef = useRef(false)
  const pauseWaitersRef = useRef([])

  const log = useCallback((direction, message) => {
    const time = new Date().toLocaleTimeString('ru-RU', { hour12: false })
    setLogs((current) => [...current.slice(-149), { time, direction, message }])
  }, [])

  const settlePending = useCallback((line, error = false) => {
    const pending = pendingRef.current.shift()
    if (!pending) return
    clearTimeout(pending.timeout)
    if (error) pending.reject(new Error(line))
    else pending.resolve(line)
  }, [])

  const readLoop = useCallback(async (reader) => {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue
          log('in', line)
          if (/^(ok|OK)\b/.test(line)) settlePending(line)
          else if (/^(error|ALARM)/i.test(line)) settlePending(line, true)
        }
      }
    } catch (error) {
      if (status !== 'disconnected') log('error', error.message)
    } finally {
      try { reader.releaseLock() } catch { /* already released */ }
    }
  }, [log, settlePending, status])

  const writeRaw = useCallback(async (value, visible = true) => {
    if (!writerRef.current) throw new Error('Плоттер не подключён.')
    const bytes = typeof value === 'string' ? encoder.encode(value) : value
    await writerRef.current.write(bytes)
    if (visible) log('out', typeof value === 'string' ? value.trim() : `[${Array.from(bytes).join(', ')}]`)
  }, [log])

  const sendCommand = useCallback(async (command, timeoutMs = 12000) => {
    if (!writerRef.current) throw new Error('Плоттер не подключён.')
    const acknowledgement = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = pendingRef.current.findIndex((item) => item.timeout === timeout)
        if (index >= 0) pendingRef.current.splice(index, 1)
        reject(new Error(`Плоттер не ответил на команду: ${command}`))
      }, timeoutMs)
      pendingRef.current.push({ resolve, reject, timeout })
    })
    await writeRaw(`${command}${lineEnding(profileRef.current)}`)
    return acknowledgement
  }, [writeRaw])

  const connect = useCallback(async (profile, baudRate) => {
    if (!supported) throw new Error('Web Serial недоступен. Используйте Chrome или Edge по HTTPS/localhost.')
    setStatus('connecting')
    profileRef.current = profile
    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: Number(baudRate), dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' })
      try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }) } catch { /* optional */ }
      portRef.current = port
      writerRef.current = port.writable.getWriter()
      readerRef.current = port.readable.getReader()
      void readLoop(readerRef.current)
      setStatus('connected')
      log('system', `${profile.toUpperCase()} · ${baudRate} бод`)
      if (profile === 'marlin') await writeRaw('M115\n')
      else await writeRaw(new Uint8Array([24]))
    } catch (error) {
      try { await readerRef.current?.cancel() } catch { /* incomplete connection */ }
      try { writerRef.current?.releaseLock() } catch { /* incomplete connection */ }
      readerRef.current = null
      writerRef.current = null
      try { await portRef.current?.close() } catch { /* incomplete connection */ }
      portRef.current = null
      setStatus('disconnected')
      throw error
    }
  }, [log, readLoop, supported, writeRaw])

  const disconnect = useCallback(async () => {
    abortRef.current = true
    pausedRef.current = false
    pauseWaitersRef.current.splice(0).forEach((resume) => resume())
    for (const pending of pendingRef.current.splice(0)) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Соединение закрыто.'))
    }
    try { await readerRef.current?.cancel() } catch { /* already closed */ }
    try { writerRef.current?.releaseLock() } catch { /* already released */ }
    readerRef.current = null
    writerRef.current = null
    try { await portRef.current?.close() } catch { /* already closed */ }
    portRef.current = null
    setStatus('disconnected')
    log('system', 'Соединение закрыто')
  }, [log])

  const waitWhilePaused = useCallback(() => {
    if (!pausedRef.current) return Promise.resolve()
    return new Promise((resolve) => pauseWaitersRef.current.push(resolve))
  }, [])

  const run = useCallback(async (commands) => {
    abortRef.current = false
    pausedRef.current = false
    setStatus('running')
    setProgress({ current: 0, total: commands.length })
    try {
      for (let index = 0; index < commands.length; index += 1) {
        if (abortRef.current) throw new DOMException('Задание остановлено.', 'AbortError')
        await waitWhilePaused()
        if (abortRef.current) throw new DOMException('Задание остановлено.', 'AbortError')
        await sendCommand(commands[index])
        setProgress({ current: index + 1, total: commands.length })
      }
      setStatus('connected')
      log('system', 'Задание завершено')
    } catch (error) {
      setStatus(writerRef.current ? 'connected' : 'disconnected')
      if (error.name !== 'AbortError') {
        log('error', error.message)
        throw error
      }
    }
  }, [log, sendCommand, waitWhilePaused])

  const pause = useCallback(async () => {
    if (status !== 'running') return
    pausedRef.current = true
    setStatus('paused')
    if (profileRef.current === 'grbl') await writeRaw(new Uint8Array([33]))
  }, [status, writeRaw])

  const resume = useCallback(async () => {
    if (status !== 'paused') return
    if (profileRef.current === 'grbl') await writeRaw(new Uint8Array([126]))
    pausedRef.current = false
    setStatus('running')
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve())
  }, [status, writeRaw])

  const stop = useCallback(async () => {
    abortRef.current = true
    pausedRef.current = false
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve())
    for (const pending of pendingRef.current.splice(0)) {
      clearTimeout(pending.timeout)
      pending.reject(new DOMException('Задание остановлено.', 'AbortError'))
    }
    if (!writerRef.current) return
    if (profileRef.current === 'grbl') await writeRaw(new Uint8Array([33, 24]))
    else if (profileRef.current === 'marlin') await writeRaw('M410\n')
    else await writeRaw('R\r\n')
    setStatus('connected')
    log('system', 'Отправлена аварийная остановка')
  }, [log, writeRaw])

  const sendCommands = useCallback(async (commands) => {
    for (const command of commands) await sendCommand(command)
  }, [sendCommand])

  useEffect(() => () => {
    try { readerRef.current?.cancel() } catch { /* unmount */ }
    try { writerRef.current?.releaseLock() } catch { /* unmount */ }
    try { portRef.current?.close() } catch { /* unmount */ }
  }, [])

  return {
    supported,
    status,
    logs,
    progress,
    connect,
    disconnect,
    run,
    pause,
    resume,
    stop,
    sendCommands,
    clearLogs: () => setLogs([]),
  }
}
