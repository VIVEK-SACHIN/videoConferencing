import { avatarHue, initials } from '../utils/names'

/** Shown over a tile when that participant's camera is off. */
export function Avatar({ name }: { name: string }) {
  return (
    <div className="tile-avatar">
      <div className="avatar-circle" style={{ background: `hsl(${avatarHue(name)} 55% 45%)` }}>
        {initials(name)}
      </div>
    </div>
  )
}
