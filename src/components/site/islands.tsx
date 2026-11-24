"use client";

import dynamic from "next/dynamic";

// The website's interactive islands, each in its own chunk (next/dynamic), so
// a page loads only the ones it uses and the below-the-fold ones never hold up
// the hero. They are still rendered on the server (no layout shift, readable
// without JavaScript); the browser fetches each one's code in parallel and
// brings it to life when it arrives.

export const HeroPhone = dynamic(() => import("./HeroPhone"));
export const ReportQuiz = dynamic(() => import("./ReportQuiz"));
export const HowScroll = dynamic(() => import("./HowScroll"));
export const CompareToggle = dynamic(() => import("./CompareToggle"));
export const Tools = dynamic(() => import("./Tools"));
export const HomeReadyTeaser = dynamic(() => import("./HomeReadyTeaser"));
export const PayTimeline = dynamic(() => import("./PayTimeline"));
