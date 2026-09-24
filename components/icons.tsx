/**
 * The icon set, drawn inline.
 *
 * A handful of 20×20 strokes does not justify an icon dependency, and keeping
 * them here means every icon inherits `currentColor` and one stroke weight.
 */

type IconProps = React.SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-[18px] shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10.5 8 14l7.5-8" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Icon>
);



export const GoogleIcon = (p: IconProps) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="size-[18px] shrink-0" {...p}>
    <path
      fill="#4285F4"
      d="M19.6 10.2c0-.7-.1-1.4-.2-2H10v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"
    />
    <path
      fill="#34A853"
      d="M10 20c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H1.1v2.6A10 10 0 0 0 10 20z"
    />
    <path
      fill="#FBBC05"
      d="M4.4 11.9a6 6 0 0 1 0-3.8V5.5H1.1a10 10 0 0 0 0 9z"
    />
    <path
      fill="#EA4335"
      d="M10 4c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 1.1 5.5l3.3 2.6C5.2 5.8 7.4 4 10 4z"
    />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8" y="8" width="9" height="9" rx="2" />
    <path d="M5 12V5a2 2 0 0 1 2-2h7" />
  </Icon>
);
