"use client";

// Last-resort boundary: replaces the whole document when the root layout
// itself fails, so it cannot rely on the app's stylesheet or fonts.
// Colours are brand colors v2 (light background, gold button, navy text).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F6F8",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
          color: "#1d1d1f",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Algo no cargó bien</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#6e6e73" }}>
            No perdiste nada. Intenta de nuevo en un momento.
            <br />
            Something didn&apos;t load. Nothing was lost; please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 12,
              height: 56,
              width: "100%",
              border: 0,
              borderRadius: 999,
              background: "#EFB537",
              color: "#12213A",
              fontSize: 17,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Intentar de nuevo
          </button>
          {error.digest && <p style={{ marginTop: 16, fontSize: 12, color: "#75757a" }}>Ref. {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
