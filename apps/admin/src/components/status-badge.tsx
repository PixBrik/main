type StatusBadgeProps = {
  tone: "ready" | "blocked" | "pending";
  children: React.ReactNode;
};

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}
