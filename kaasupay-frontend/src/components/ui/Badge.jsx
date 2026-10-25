const badgeVariants = {
  credit: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  debit: 'bg-rose-50 text-rose-700 border-rose-200/60',
  primary: 'bg-cobalt-50 text-cobalt-700 border-cobalt-200/60',
  lavender: 'bg-lavender-50 text-lavender-700 border-lavender-200/80',
  warning: 'bg-amber-50 text-amber-700 border-amber-200/60',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
};

const badgeSizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs font-semibold',
  lg: 'px-3 py-1.5 text-sm font-semibold',
};

export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  dot = false,
  className = '',
  ...props
}) {
  const variantClass = badgeVariants[variant] || badgeVariants.neutral;
  const sizeClass = badgeSizes[size] || badgeSizes.md;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium tracking-wide ${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            variant === 'credit'
              ? 'bg-emerald-500'
              : variant === 'debit'
              ? 'bg-rose-500'
              : variant === 'warning'
              ? 'bg-amber-500'
              : variant === 'lavender'
              ? 'bg-lavender-500'
              : 'bg-cobalt-600'
          }`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

export default Badge;
