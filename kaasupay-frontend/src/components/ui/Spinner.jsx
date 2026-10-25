export function Spinner({ size = 'md', className = '', ...props }) {
  const sizeMap = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
    xl: 'w-12 h-12 border-4',
  };

  const chosenSize = sizeMap[size] || sizeMap.md;

  return (
    <div
      role="status"
      aria-label="Loading"
      className={`inline-block rounded-full border-cobalt-200 border-t-cobalt-600 animate-spin ${chosenSize} ${className}`}
      {...props}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function Skeleton({ className = '', rounded = 'rounded-md', ...props }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-slate-200/80 ${rounded} ${className}`}
      {...props}
    />
  );
}

export default Spinner;
