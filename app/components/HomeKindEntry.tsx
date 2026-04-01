"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getSubjectKindShareTitle } from "@/lib/subject-kind";

export default function HomeKindEntry() {
  const shareTitle = getSubjectKindShareTitle("boardgame");

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 sm:py-14">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl items-center justify-center sm:min-h-[calc(100vh-7rem)]">
        <section className="flex w-full justify-center">
          <div className="flex flex-col items-center gap-6 sm:gap-8">
            <h1 className="whitespace-nowrap text-[2.08rem] font-black leading-none tracking-tight text-foreground sm:text-[3.3rem]">
              {shareTitle}
            </h1>
            <Button
              asChild
              className="inline-flex h-auto w-full max-w-sm items-center justify-center rounded-full bg-sky-600 px-4 py-3 text-sm font-bold text-white shadow-sm shadow-sky-200 transition-all hover:bg-sky-700"
            >
              <Link href="/boardgame" prefetch={false}>开始填写！</Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
