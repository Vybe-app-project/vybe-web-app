import type { SVGProps } from 'react';

/**
 * Inline stroke icons on a 24 grid, 1.8 stroke, round caps. Sized in `em` so
 * an icon inherits the surrounding text size unless `size` is passed.
 * Pass `filled` for the solid state (liked, saved, active tab).
 */
export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  filled?: boolean;
};

export type IconComponent = (p: IconProps) => React.ReactNode;

function make(name: string, children: React.ReactNode) {
  const Icon = ({ size, filled = false, ...rest }: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      width={size ?? '1.25em'}
      height={size ?? '1.25em'}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

/* ------------------------------------------------------------------ navigation */
export const Home = make('Home', <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></>);
export const Compass = make('Compass', <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></>);
export const Dumbbell = make('Dumbbell', <><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/></>);
export const Utensils = make('Utensils', <><path d="M4 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M6 12v9"/><path d="M17 3c-1.7 1-2.5 3-2.5 5.5S15.3 13 17 13v8"/></>);
export const Heart = make('Heart', <><path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7c0 4.9-7 9.3-7 9.3z"/></>);
export const MessageCircle = make('MessageCircle', <><path d="M21 11.5a8 8 0 0 1-11.6 7.1L3 21l2.4-6.4A8 8 0 1 1 21 11.5z"/></>);
export const Bell = make('Bell', <><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.5 20a2 2 0 0 0 3 0"/></>);
export const User = make('User', <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>);
export const Search = make('Search', <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></>);
export const Plus = make('Plus', <><path d="M12 5v14M5 12h14"/></>);
export const Minus = make('Minus', <><path d="M5 12h14"/></>);
export const Settings = make('Settings', <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.6a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></>);
export const LogOut = make('LogOut', <><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/></>);
export const Inbox = make('Inbox', <><path d="M6 5h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/><path d="M3.5 13H8l1.5 2.5h5L16 13h4.5"/></>);
export const Menu = make('Menu', <><path d="M4 7h16M4 12h16M4 17h16"/></>);
export const Dashboard = make('Dashboard', <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></>);
export const Building = make('Building', <><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/></>);
export const Globe = make('Globe', <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>);
export const Radio = make('Radio', <><circle cx="12" cy="12" r="2.5"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2"/></>);
export const Layers = make('Layers', <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></>);
export const BookOpen = make('BookOpen', <><path d="M12 6.5C10.5 5 8 4.5 3 4.5v14c5 0 7.5.5 9 2 1.5-1.5 4-2 9-2v-14c-5 0-7.5.5-9 2z"/><path d="M12 6.5v14"/></>);
export const CalendarDays = make('CalendarDays', <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/></>);
export const ClipboardList = make('ClipboardList', <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/></>);
export const Target = make('Target', <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/></>);
export const Scale = make('Scale', <><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7.5 10.5a6 6 0 0 1 9 0"/><path d="m12 12 2.5-3.5"/></>);
export const Footprints = make('Footprints', <><path d="M6.5 3.5c-2 0-3 2.5-2.8 5.1.2 2 .8 3.4 2.3 3.4s2.5-1.4 2.6-3.4c.2-2.6-.1-5.1-2.1-5.1z"/><path d="M4.4 14c-.5 1.5 0 3.5 1.5 3.5s2.4-1.6 1.7-3.5"/><path d="M17.5 8c2 0 3 2.5 2.8 5.1-.2 2-.8 3.4-2.3 3.4s-2.5-1.4-2.6-3.4c-.2-2.6.1-5.1 2.1-5.1z"/><path d="M19.6 18.5c.5 1.5 0 3.5-1.5 3.5s-2.4-1.6-1.7-3.5"/></>);

/* ------------------------------------------------------------------ actions */
export const Trash = make('Trash', <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></>);
export const Edit = make('Edit', <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>);
export const Camera = make('Camera', <><path d="M3 8h3l2-2h8l2 2h3v11H3z"/><circle cx="12" cy="13" r="3.5"/></>);
export const Play = make('Play', <><path d="M7 4.5v15l12-7.5z"/></>);
export const Pause = make('Pause', <><path d="M8 5v14M16 5v14"/></>);
export const X = make('X', <><path d="M6 6l12 12M18 6 6 18"/></>);
export const Check = make('Check', <><path d="m5 12.5 4.5 4.5L19 7"/></>);
export const CheckCircle = make('CheckCircle', <><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/></>);
export const MoreHorizontal = make('MoreHorizontal', <><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>);
export const MoreVertical = make('MoreVertical', <><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></>);
export const Bookmark = make('Bookmark', <><path d="M6 4h12v17l-6-4.5L6 21z"/></>);
export const Share = make('Share', <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></>);
export const ShareUp = make('ShareUp', <><path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M6 12H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-1"/></>);
export const Send = make('Send', <><path d="M21 3 10.5 13.5"/><path d="M21 3l-7 18-3.5-7.5L3 10z"/></>);
export const Copy = make('Copy', <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></>);
export const Link = make('Link', <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></>);
export const ExternalLink = make('ExternalLink', <><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>);
export const Refresh = make('Refresh', <><path d="M20 11a8 8 0 0 0-13.7-5.3L3 9"/><path d="M4 13a8 8 0 0 0 13.7 5.3L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/></>);
export const Filter = make('Filter', <><path d="M3 5h18l-7 8v6l-4 2v-8z"/></>);
export const Download = make('Download', <><path d="M12 3v12"/><path d="m7.5 11 4.5 4.5L16.5 11"/><path d="M4 20h16"/></>);
export const Upload = make('Upload', <><path d="M12 20V8"/><path d="m7.5 12 4.5-4.5L16.5 12"/><path d="M4 4h16"/></>);
export const Repeat = make('Repeat', <><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>);
export const Flag = make('Flag', <><path d="M5 21V4"/><path d="M5 5h11l-1.5 3.5L16 12H5z"/></>);
export const Eye = make('Eye', <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></>);
export const EyeOff = make('EyeOff', <><path d="M4 4l16 16"/><path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.4 4.1M6.4 7.6A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6"/><path d="M9.9 10.1a3 3 0 0 0 4.1 4.2"/></>);

/* ------------------------------------------------------------------ chevrons */
export const ChevronLeft = make('ChevronLeft', <><path d="m15 5-7 7 7 7"/></>);
export const ChevronRight = make('ChevronRight', <><path d="m9 5 7 7-7 7"/></>);
export const ChevronDown = make('ChevronDown', <><path d="m5 9 7 7 7-7"/></>);
export const ChevronUp = make('ChevronUp', <><path d="m5 15 7-7 7 7"/></>);
export const ArrowLeft = make('ArrowLeft', <><path d="M19 12H5"/><path d="m11 6-6 6 6 6"/></>);
export const ArrowRight = make('ArrowRight', <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>);
export const ArrowUp = make('ArrowUp', <><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></>);
export const ArrowDown = make('ArrowDown', <><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></>);

/* ------------------------------------------------------------------ media & objects */
export const Image = make('Image', <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5L20 17"/></>);
export const Video = make('Video', <><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10.5 6-3.5v10l-6-3.5z"/></>);
export const VideoOff = make('VideoOff', <><path d="m3 3 18 18"/><path d="M15 12.5v1.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1"/><path d="M10 6h3a2 2 0 0 1 2 2v1.5l6-3.5v10l-2.5-1.5"/></>);
export const Mic = make('Mic', <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M9 21h6"/></>);
export const MicOff = make('MicOff', <><path d="m3 3 18 18"/><path d="M15 9.5V6a3 3 0 0 0-6 0v1"/><path d="M9 9.5V11a3 3 0 0 0 5.1 2.1"/><path d="M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11a6.5 6.5 0 0 1-.6 2.7"/><path d="M12 17.5V21M9 21h6"/></>);
export const Volume = make('Volume', <><path d="M4 9.5v5h3l4 3.5V6L7 9.5z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"/></>);
export const VolumeOff = make('VolumeOff', <><path d="M4 9.5v5h3l4 3.5V6L7 9.5z"/><path d="m16 10 4 4M20 10l-4 4"/></>);
export const Maximize = make('Maximize', <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></>);
export const MapPin = make('MapPin', <><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></>);
export const Calendar = make('Calendar', <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>);
export const Clock = make('Clock', <><circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/></>);
export const Timer = make('Timer', <><circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 1.5M9.5 3h5M12 3v3"/></>);
export const Mail = make('Mail', <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/></>);
export const Lock = make('Lock', <><rect x="4.5" y="10" width="15" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>);
export const Shield = make('Shield', <><path d="M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6z"/></>);
export const AlignLeft = make('AlignLeft', <><path d="M4 6h16M4 12h10M4 18h13"/></>);
export const FileText = make('FileText', <><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></>);
export const List = make('List', <><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></>);
export const Server = make('Server', <><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></>);
export const LifeBuoy = make('LifeBuoy', <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/></>);
export const Hash = make('Hash', <><path d="M5 9h14M4.5 15h14M10 3.5 8 20.5M16 3.5l-2 17"/></>);
export const Users = make('Users', <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M17 11a3.5 3.5 0 1 0-2-6.4"/><path d="M17.5 14.5A6 6 0 0 1 21.5 21"/></>);
export const UserPlus = make('UserPlus', <><circle cx="10" cy="8" r="4"/><path d="M2.5 21a7.5 7.5 0 0 1 15 0"/><path d="M19 8v6M16 11h6"/></>);
export const Wifi = make('Wifi', <><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><path d="M12 19h.01"/></>);
export const WifiOff = make('WifiOff', <><path d="m3 3 18 18"/><path d="M2 8.5a15 15 0 0 1 4.6-2.7M22 8.5a15 15 0 0 0-11.7-3.4M5 12a10 10 0 0 1 2.9-2.1M19 12a10 10 0 0 0-6.4-2.9M8.5 15.5a5 5 0 0 1 4-1.4"/><path d="M12 19h.01"/></>);

/* ------------------------------------------------------------------ status & stats */
export const Activity = make('Activity', <><path d="M3 12h4l3 8 4-16 3 8h4"/></>);
export const TrendingUp = make('TrendingUp', <><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></>);
export const TrendingDown = make('TrendingDown', <><path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/></>);
export const BarChart = make('BarChart', <><path d="M4 21V10M10 21V4M16 21v-7M22 21H2"/></>);
export const Alert = make('Alert', <><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.2v.1"/></>);
export const Info = make('Info', <><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/></>);
export const Droplet = make('Droplet', <><path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z"/></>);
export const Flame = make('Flame', <><path d="M12 3c.5 3.5 4.5 5.5 4.5 10a4.5 4.5 0 0 1-9 0c0-2 1-3.4 2-4.3.2 1.3 1 2.1 2 2.4C10.8 8.8 11.2 5.5 12 3z"/></>);
export const Zap = make('Zap', <><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></>);
export const Sparkles = make('Sparkles', <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></>);
export const Trophy = make('Trophy', <><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a4 4 0 0 0 3 3.9M17 6h3v1a4 4 0 0 1-3 3.9"/><path d="M12 14v4M9 21h6"/></>);
export const Award = make('Award', <><circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1 7.5 4.5-2.5 4.5 2.5-1-7.5"/></>);
export const Medal = make('Medal', <><path d="m8.6 10.6-3.6-7.6h5l2 4.2 2-4.2h5l-3.6 7.6"/><circle cx="12" cy="15" r="5"/><path d="m12 12.8.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z"/></>);
export const Star = make('Star', <><path d="m12 4 2.5 5.2 5.5.7-4 3.9 1 5.6-5-2.8-5 2.8 1-5.6-4-3.9 5.5-.7z"/></>);
export const Plate = make('Plate', <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/></>);
export const BadgeCheck = make('BadgeCheck', <><path d="m12 3 2.2 1.6 2.7-.3 1 2.5 2.4 1.3-.5 2.7 1.3 2.4-2 1.8-.3 2.7-2.7.4L14.4 21 12 19.7 9.6 21l-1.7-2.1-2.7-.4-.3-2.7-2-1.8 1.3-2.4-.5-2.7 2.4-1.3 1-2.5 2.7.3z"/><path d="m9 12.5 2 2 4-4.5"/></>);

/* ------------------------------------------------------------------ theme */
export const Sun = make('Sun', <><circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></>);
export const Moon = make('Moon', <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></>);
export const Monitor = make('Monitor', <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></>);
export const Palette = make('Palette', <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-2 0-.6-.3-1-.6-1.4-.3-.4-.4-.7-.4-1.1 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-7.7-9-7.7z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/></>);

/* ------------------------------------------------------------------ reactions (replaces emoji) */
export const ThumbsUp = make('ThumbsUp', <><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/><path d="M7 11l4-7a2 2 0 0 1 3 2v3h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 19H7"/></>);
export const Clap = make('Clap', <><path d="m7.5 10.5-2.4 2.4a3.5 3.5 0 0 0 0 5l1 1a3.5 3.5 0 0 0 5 0l5.4-5.4a1.4 1.4 0 0 0-2-2"/><path d="m9.8 8.2 4.7-4.7"/><path d="M15.5 7.5 10 13a1.4 1.4 0 0 1-2-2l4.6-4.6a1.4 1.4 0 0 1 2 2z"/><path d="M17.5 3v1.5M20 5.5 19 6.5M21 9h-1.5"/></>);
export const Wow = make('Wow', <><circle cx="12" cy="12" r="9"/><path d="M9 9.5h.01M15 9.5h.01"/><ellipse cx="12" cy="15" rx="1.6" ry="2.2"/></>);
export const Smile = make('Smile', <><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/></>);

/** The reaction set used by Stories and comments, in display order. */
export const REACTION_ICONS = {
  like: ThumbsUp,
  love: Heart,
  fire: Flame,
  clap: Clap,
  wow: Wow,
} as const;
export type ReactionKey = keyof typeof REACTION_ICONS;
