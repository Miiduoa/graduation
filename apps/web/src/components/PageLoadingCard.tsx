export function PageLoadingCard(props: { icon?: string; message: string }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 16 }}>{props.icon ?? "⏳"}</div>
      <div style={{ color: "var(--muted)" }}>{props.message}</div>
    </div>
  );
}
