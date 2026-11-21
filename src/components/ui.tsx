import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { motion } from "motion/react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all",
        "disabled:opacity-50 disabled:pointer-events-none active:scale-[0.97] cursor-default",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" &&
          "gradient-accent text-white shadow-[0_4px_20px_-4px_var(--accent)] hover:brightness-110",
        variant === "secondary" && "bg-panel-2 text-fg hover:bg-hover border border-line",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-hover",
        variant === "danger" && "text-danger hover:bg-danger/10",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  title,
  className,
  children,
  tone = "default",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tone?: "default" | "danger" }) {
  return (
    <button
      {...rest}
      title={title}
      aria-label={title}
      className={clsx(
        "grid place-items-center size-8 rounded-lg transition-colors cursor-default",
        tone === "danger"
          ? "text-muted hover:text-danger hover:bg-danger/10"
          : "text-muted hover:text-fg hover:bg-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  layoutId,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  layoutId: string;
}) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-panel-2 border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "relative px-3.5 h-8 rounded-lg text-[13px] font-medium transition-colors cursor-default",
            value === o.value ? "text-fg" : "text-muted hover:text-fg",
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-lg bg-panel shadow-[var(--shadow)] border border-line"
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex flex-col items-start px-3.5 py-2 rounded-xl border text-left transition-all cursor-default min-w-[84px]",
        active
          ? "border-accent bg-accent-soft ring-1 ring-accent"
          : "border-line bg-panel-2 hover:bg-hover",
      )}
    >
      <span className={clsx("text-[13px] font-semibold", active && "text-accent")}>{children}</span>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </button>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative w-10 h-6 rounded-full transition-colors shrink-0 cursor-default",
        checked ? "gradient-accent" : "bg-hover border border-line",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", bounce: 0.3, duration: 0.3 }}
        className={clsx(
          "absolute top-1 size-4 rounded-full bg-white shadow",
          checked ? "right-1" : "left-1",
        )}
      />
    </button>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={clsx(
        "h-9 px-3 pr-8 rounded-lg bg-panel-2 border border-line text-[13px] outline-none",
        "focus:border-accent appearance-none bg-no-repeat bg-[right_10px_center] bg-[length:12px]",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238d8d9e' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Thumb({
  src,
  className,
  children,
}: {
  src: string | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={clsx("relative overflow-hidden bg-panel-2 shrink-0", className)}>
      {src && (
        <img
          src={src}
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
      )}
      {children}
    </div>
  );
}
