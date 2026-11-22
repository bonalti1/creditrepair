import { notFound } from "next/navigation";
import LessonView from "@/components/learn/LessonView";
import { getLesson, LESSONS } from "@/lib/learn/lessons";

// One "Aprende" lesson, built at build time for every slug in lessons.ts.

export function generateStaticParams() {
  return LESSONS.map((lesson) => ({ slug: lesson.slug }));
}

export const dynamicParams = false;

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLesson(slug)) notFound();
  return <LessonView slug={slug} />;
}
