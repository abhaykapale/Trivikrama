export function LoadingScreen({ label = "Verifying secure session" }: { readonly label?: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-mark" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}
