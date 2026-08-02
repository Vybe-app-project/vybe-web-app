import type { SVGProps } from 'react';

/**
 * Inline stroke icons. Kept dependency-free and sized in `em` so an icon
 * inherits the surrounding text size unless `size` is passed explicitly.
 */
export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  filled?: boolean;
};

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
export const Settings = make('Settings', <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.6a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></>);
export const LogOut = make('LogOut', <><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/></>);
export const Trash = make('Trash', <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></>);
export const Edit = make('Edit', <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>);
export const Camera = make('Camera', <><path d="M3 8h3l2-2h8l2 2h3v11H3z"/><circle cx="12" cy="13" r="3.5"/></>);
export const Play = make('Play', <><path d="M7 4.5v15l12-7.5z"/></>);
export const Users = make('Users', <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path d="M17 11a3.5 3.5 0 1 0-2-6.4"/><path d="M17.5 14.5A6 6 0 0 1 21.5 21"/></>);
export const Trophy = make('Trophy', <><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a4 4 0 0 0 3 3.9M17 6h3v1a4 4 0 0 1-3 3.9"/><path d="M12 14v4M9 21h6"/></>);
export const Droplet = make('Droplet', <><path d="M12 3s6 6.2 6 10a6 6 0 0 1-12 0c0-3.8 6-10 6-10z"/></>);
export const Activity = make('Activity', <><path d="M3 12h4l3 8 4-16 3 8h4"/></>);
export const ChevronLeft = make('ChevronLeft', <><path d="m15 5-7 7 7 7"/></>);
export const ChevronRight = make('ChevronRight', <><path d="m9 5 7 7-7 7"/></>);
export const X = make('X', <><path d="M6 6l12 12M18 6 6 18"/></>);
export const Check = make('Check', <><path d="m5 12.5 4.5 4.5L19 7"/></>);
export const MoreHorizontal = make('MoreHorizontal', <><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>);
export const Bookmark = make('Bookmark', <><path d="M6 4h12v17l-6-4.5L6 21z"/></>);
export const Share = make('Share', <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></>);
export const Send = make('Send', <><path d="M21 3 10.5 13.5"/><path d="M21 3l-7 18-3.5-7.5L3 10z"/></>);
export const Image = make('Image', <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5L20 17"/></>);
export const Video = make('Video', <><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10.5 6-3.5v10l-6-3.5z"/></>);
export const MapPin = make('MapPin', <><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></>);
export const Calendar = make('Calendar', <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>);
export const Clock = make('Clock', <><circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/></>);
export const TrendingUp = make('TrendingUp', <><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></>);
export const Shield = make('Shield', <><path d="M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6z"/></>);
export const BarChart = make('BarChart', <><path d="M4 21V10M10 21V4M16 21v-7M22 21H2"/></>);
export const FileText = make('FileText', <><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></>);
export const Flag = make('Flag', <><path d="M5 21V4"/><path d="M5 5h11l-1.5 3.5L16 12H5z"/></>);
export const LifeBuoy = make('LifeBuoy', <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/></>);
export const Menu = make('Menu', <><path d="M4 7h16M4 12h16M4 17h16"/></>);
export const Alert = make('Alert', <><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.2v.1"/></>);
export const Dashboard = make('Dashboard', <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></>);
export const Award = make('Award', <><circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1 7.5 4.5-2.5 4.5 2.5-1-7.5"/></>);
export const List = make('List', <><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></>);
export const Server = make('Server', <><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></>);
export const Refresh = make('Refresh', <><path d="M20 11a8 8 0 0 0-13.7-5.3L3 9"/><path d="M4 13a8 8 0 0 0 13.7 5.3L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/></>);
export const Filter = make('Filter', <><path d="M3 5h18l-7 8v6l-4 2v-8z"/></>);
export const Lock = make('Lock', <><rect x="4.5" y="10" width="15" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>);
export const Mail = make('Mail', <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/></>);
export const Eye = make('Eye', <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></>);
export const EyeOff = make('EyeOff', <><path d="M4 4l16 16"/><path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.4 4.1M6.4 7.6A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6"/><path d="M9.9 10.1a3 3 0 0 0 4.1 4.2"/></>);
export const Download = make('Download', <><path d="M12 3v12"/><path d="m7.5 11 4.5 4.5L16.5 11"/><path d="M4 20h16"/></>);
export const Upload = make('Upload', <><path d="M12 20V8"/><path d="m7.5 12 4.5-4.5L16.5 12"/><path d="M4 4h16"/></>);
export const Star = make('Star', <><path d="m12 4 2.5 5.2 5.5.7-4 3.9 1 5.6-5-2.8-5 2.8 1-5.6-4-3.9 5.5-.7z"/></>);
export const Info = make('Info', <><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/></>);
