export default function ForbiddenPage() {
  return (
    <main className="public-page">
      <section className="public-card">
        <span className="eyebrow">Access denied</span>
        <h1>Permission required.</h1>
        <p>Your identity is valid, but your PixBrik role does not allow this action. Ask an owner to review your assigned role.</p>
      </section>
    </main>
  );
}
