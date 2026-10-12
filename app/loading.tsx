export default function Loading() {
  return (
    <div className="vanta-route-loader" aria-live="polite" aria-busy="true">
      <div className="vanta-loader-bar" />
      <div className="vanta-loader-center">
        <div className="vanta-loader-brand">
          <span className="brand-mark">V</span>
        </div>
        <p className="vanta-loader-text">Loading...</p>
      </div>
    </div>
  );
}
