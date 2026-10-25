import { formatPaiseToRupees } from '../../utils/currency';

export function AmountDisplay({
  paise = 0,
  direction = null, // 'CREDIT' | 'DEBIT' | null
  size = 'md', // 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  showSign = false,
  className = '',
}) {
  const isCredit = direction === 'CREDIT';
  const isDebit = direction === 'DEBIT';

  const sizeClasses = {
    sm: 'text-sm font-semibold',
    md: 'text-base font-bold',
    lg: 'text-xl font-extrabold tracking-tight',
    xl: 'text-2xl font-black tracking-tight',
    '2xl': 'text-4xl font-black tracking-tight',
  };

  const colorClasses = isCredit
    ? 'text-emerald-600'
    : isDebit
    ? 'text-rose-600'
    : 'text-navy-900';

  const formatted = formatPaiseToRupees(Math.abs(paise), true);
  const sign = showSign ? (isCredit ? '+' : isDebit ? '-' : '') : '';

  return (
    <span
      className={`font-mono inline-flex items-baseline ${sizeClasses[size] || sizeClasses.md} ${colorClasses} ${className}`}
    >
      {sign}
      {formatted}
    </span>
  );
}

export default AmountDisplay;
