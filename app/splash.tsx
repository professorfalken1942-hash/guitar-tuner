// Launch screen shown on page load. Animated entirely in CSS (see globals.css)
// so it plays from the first paint, before the page hydrates.
export default function Splash() {
  return (
    <div className="splash" aria-hidden>
      <div className="splash-content">
        <p className="splash-logo font-display">Trootone</p>
        <div className="splash-meter">
          <span className="splash-center" />
          <span className="splash-needle" />
        </div>
      </div>
    </div>
  );
}
