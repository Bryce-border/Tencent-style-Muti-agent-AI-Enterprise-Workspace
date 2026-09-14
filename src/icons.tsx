import type { SVGProps } from 'react'

export type IconName =
  | 'grid'
  | 'bot'
  | 'tasks'
  | 'book'
  | 'file'
  | 'chart'
  | 'calendar'
  | 'message'
  | 'settings'
  | 'search'
  | 'bell'
  | 'sparkles'
  | 'arrow'
  | 'clock'
  | 'check'
  | 'more'
  | 'plus'
  | 'send'
  | 'chevron'
  | 'activity'
  | 'play'
  | 'refresh'
  | 'shield'
  | 'users'
  | 'trend'
  | 'x'
  | 'menu'
  | 'paperclip'
  | 'filter'
  | 'external'

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName
  size?: number
}

const paths: Record<IconName, string[]> = {
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  bot: ['M12 3v3', 'M8 10h.01', 'M16 10h.01', 'M8 15h8', 'M7 7h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z', 'M9 21h6'],
  tasks: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  book: ['M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z', 'M4 5.5v16', 'M8 7h8', 'M8 11h6'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M8 13h8', 'M8 17h6'],
  chart: ['M4 19V5', 'M4 19h16', 'M8 16v-4', 'M12 16V8', 'M16 16v-7'],
  calendar: ['M6 3v4', 'M18 3v4', 'M4 9h16', 'M6 5h12a2 2 0 0 1 2 2v13H4V7a2 2 0 0 1 2-2Z', 'M8 13h.01', 'M12 13h.01', 'M16 13h.01'],
  message: ['M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3.7-.85L4 20l1.6-3.4A7.2 7.2 0 0 1 4.5 12 7.5 7.5 0 0 1 12 4.5a7.5 7.5 0 0 1 8 7Z', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01'],
  settings: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.8 1.8-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2.55v-.1a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.8-1.8.06-.06A1.7 1.7 0 0 0 7.6 15a1.7 1.7 0 0 0-1.56-1.03H6v-2.55h.04A1.7 1.7 0 0 0 7.6 10.4a1.7 1.7 0 0 0-.34-1.88L7.2 8.46l1.8-1.8.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.97 5.5V5h2.55v.5a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.8 1.8-.06.06A1.7 1.7 0 0 0 18.9 10.4a1.7 1.7 0 0 0 1.56 1.03h.04v2.55h-.04A1.7 1.7 0 0 0 19.4 15Z'],
  search: ['m21 21-4.35-4.35', 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  sparkles: ['m12 3-1.1 4.4L7 8.5l3.9 1.1L12 14l1.1-4.4L17 8.5l-3.9-1.1L12 3Z', 'm19 14-.55 2.2L16 17l2.45.8L19 20l.55-2.2L22 17l-2.45-.8L19 14Z', 'm5 14-.55 2.2L2 17l2.45.8L5 20l.55-2.2L8 17l-2.45-.8L5 14Z'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  check: ['m5 12 4 4L19 6'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  chevron: ['m9 18 6-6-6-6'],
  activity: ['M3 12h4l2-7 4 14 2-7h6'],
  play: ['m8 5 11 7-11 7V5Z'],
  refresh: ['M20 11a8 8 0 1 0 2 5', 'M20 4v7h-7'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  trend: ['m3 17 6-6 4 4 8-9', 'M17 6h4v4'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  paperclip: ['m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.4-9.4a4 4 0 0 1 5.7 5.7l-9.4 9.4a2 2 0 0 1-2.8-2.8l8.8-8.8'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  external: ['M14 3h7v7', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
}

export function Icon({ name, size = 18, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {paths[name].map((path, index) => (
        <path key={`${name}-${index}`} d={path} />
      ))}
    </svg>
  )
}
