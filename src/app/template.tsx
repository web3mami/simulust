// Remounts on every top-level route change, so each page fades in. Opacity
// only (see .page-in in globals.css); h-full keeps the conversation screen's
// full-height layout intact.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in h-full">{children}</div>;
}
