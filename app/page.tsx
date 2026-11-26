"use client";

import dynamic from "next/dynamic";

// The studio is a client-side app (same screens as v3); it talks to the API routes in app/api.
const App = dynamic(() => import("../ui/App.jsx"), { ssr: false, loading: () => <div className="center-message">Loading…</div> });

export default function Home() {
  return <App />;
}
