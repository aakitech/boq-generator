type CreditBadgeProps = {
  remainingCredits: number;
  className?: string;
};

export default function CreditBadge({ remainingCredits, className = "" }: CreditBadgeProps) {
  const displayCredits = Math.max(remainingCredits, 0);
  const label =
    displayCredits === 1
      ? "1 credit left"
      : `${displayCredits.toLocaleString()} credits left`;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 ${className}`.trim()}
    >
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      {label}
    </span>
  );
}
