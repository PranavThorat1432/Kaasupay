import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const variants = {
  primary:
    'bg-cobalt-600 text-white font-semibold hover:bg-cobalt-700 active:bg-cobalt-800 shadow-md shadow-cobalt-600/20 hover:shadow-lg hover:shadow-cobalt-600/35 hover:-translate-y-0.5 active:translate-y-0 border border-transparent transition-all duration-200',
  secondary:
    'bg-white text-navy-900 font-semibold border border-slate-300 hover:bg-slate-50 hover:border-slate-400 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:bg-slate-100 shadow-xs transition-all duration-200',
  dark:
    'bg-navy-950 text-white font-semibold hover:bg-black active:bg-black border border-navy-800 shadow-md shadow-navy-950/20 hover:shadow-xl hover:shadow-navy-950/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200',
  lavender:
    'bg-lavender-100 text-lavender-700 font-semibold border border-lavender-300 hover:bg-lavender-200 active:bg-lavender-300 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200',
  outline:
    'bg-transparent text-cobalt-700 font-semibold border-2 border-cobalt-600 hover:bg-cobalt-50 hover:-translate-y-0.5 active:translate-y-0 active:bg-cobalt-100 transition-all duration-200',
  ghost:
    'bg-transparent text-slate-700 font-medium hover:bg-slate-100 hover:text-navy-950 border border-transparent transition-colors duration-150',
  danger:
    'bg-rose-600 text-white font-semibold hover:bg-rose-700 active:bg-rose-800 shadow-sm shadow-rose-600/25 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 border border-transparent transition-all duration-200',
  soft:
    'bg-slate-100 text-navy-800 font-semibold hover:bg-slate-200 active:bg-slate-300 border border-slate-200 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200',
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs font-medium rounded-lg gap-1.5',
  md: 'px-4 py-2 text-sm font-semibold rounded-xl gap-2',
  lg: 'px-5 py-2.5 text-base font-semibold rounded-xl gap-2.5',
};

export const Button = forwardRef(function Button(
  {
    children,
    type = 'button',
    variant = 'primary',
    size = 'md',
    isLoading = false,
    disabled = false,
    leftIcon,
    rightIcon,
    className = '',
    ...props
  },
  ref
) {
  const baseClasses =
    'group inline-flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-600 focus-visible:ring-offset-2';

  const variantClass = variants[variant] || variants.primary;
  const sizeClass = sizes[size] || sizes.md;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      className={`${baseClasses} ${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-current" aria-hidden="true" />
      ) : (
        leftIcon && <span className="inline-flex shrink-0 text-current transition-transform duration-200 group-hover:-translate-x-0.5">{leftIcon}</span>
      )}
      <span className="truncate">{children}</span>
      {!isLoading && rightIcon && (
        <span className="inline-flex shrink-0 text-current transition-transform duration-200 group-hover:translate-x-1">{rightIcon}</span>
      )}
    </button>
  );
});

export default Button;
