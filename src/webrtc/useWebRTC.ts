import { useEffect, useMemo, useRef, useState } from 'react'
import { MeshClient, initialMeshState, type MeshState } from './MeshClient'
import type { DevicePrefs } from './types'

/**
 * React binding for {@link MeshClient}. The client owns all the WebRTC logic;
 * this hook just mirrors its snapshots into React state and exposes the
 * imperative actions with stable references.
 */
export function useWebRTC() {
  const [state, setState] = useState<MeshState>(initialMeshState)
  const clientRef = useRef<MeshClient | null>(null)
  if (!clientRef.current) clientRef.current = new MeshClient()

  useEffect(() => {
    const client = clientRef.current!
    client.onChange = setState
    return () => client.leaveRoom()
  }, [])

  const actions = useMemo(() => {
    const client = clientRef.current!
    return {
      joinRoom: (room: string, name: string, devices: DevicePrefs = {}) =>
        client.joinRoom(room, name, devices),
      sendMessage: (text: string) => client.sendMessage(text),
      toggleMic: () => client.toggleMic(),
      toggleCamera: () => client.toggleCamera(),
      leaveRoom: () => client.leaveRoom(),
    }
  }, [])

  return { ...state, ...actions }
}

export type UseWebRTC = ReturnType<typeof useWebRTC>
