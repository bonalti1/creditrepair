"use client";

import { useEffect } from "react";
import { rememberAttribution } from "@/lib/ads/capture";

// Keeps an ad link's marketing tags (utm_*, ad_id, and that a Facebook click
// id was there) in this browser, so the chat signup can credit the lead to
// the ad that brought them (src/lib/ads/capture.ts). Renders nothing, sends
// nothing, reads nothing personal.

export default function AttributionCapture() {
  useEffect(() => {
    if (window.location.search) rememberAttribution(window.location.search);
  }, []);
  return null;
}
