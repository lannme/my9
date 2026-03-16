"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_SUBJECT_KIND,
  SUBJECT_KIND_ORDER,
  SubjectKind,
  getSubjectKindMeta,
  getSubjectKindShareTitle,
} from "@/lib/subject-kind";
import { cn } from "@/lib/utils";

export default function HomeKindEntry() {
  const [kind, setKind] = useState<SubjectKind>(DEFAULT_SUBJECT_KIND);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const kindMeta = getSubjectKindMeta(kind);
  const shareTitle = getSubjectKindShareTitle(kind);
  const titlePrefix = `构成我的九${kindMeta.selectionUnit}`;
  const kindSwitchable = SUBJECT_KIND_ORDER.length > 1;
  const optionRefs = useRef<Record<SubjectKind, HTMLButtonElement | null>>({
    game: null,
    boardgame: null,
    anime: null,
    tv: null,
    movie: null,
    manga: null,
    lightnovel: null,
    song: null,
    album: null,
    work: null,
    character: null,
    person: null,
  });

  const scrollKindIntoCenter = useCallback((targetKind: SubjectKind, behavior: ScrollBehavior) => {
    const picker = pickerRef.current;
    const option = optionRefs.current[targetKind];
    if (!picker || !option) return;

    const pickerRect = picker.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    const top =
      picker.scrollTop +
      (optionRect.top - pickerRect.top) -
      (pickerRect.height / 2 - optionRect.height / 2);

    picker.scrollTo({
      top,
      behavior,
    });
  }, []);

  function syncKindByCenter() {
    const picker = pickerRef.current;
    if (!picker) return;

    const pickerRect = picker.getBoundingClientRect();
    const centerY = pickerRect.top + pickerRect.height / 2;
    let nextKind = kind;
    let minDistance = Number.POSITIVE_INFINITY;

    for (const item of SUBJECT_KIND_ORDER) {
      const option = optionRefs.current[item];
      if (!option) continue;
      const optionRect = option.getBoundingClientRect();
      const distance = Math.abs(optionRect.top + optionRect.height / 2 - centerY);
      if (distance < minDistance) {
        minDistance = distance;
        nextKind = item;
      }
    }

    if (nextKind !== kind) {
      setKind(nextKind);
    }
  }

  function onPickerScroll() {
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      syncKindByCenter();
      scrollRafRef.current = null;
    });
  }

  useEffect(() => {
    if (kindSwitchable) {
      scrollKindIntoCenter(DEFAULT_SUBJECT_KIND, "auto");
    }
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, [kindSwitchable, scrollKindIntoCenter]);

  useEffect(() => {
    document.title = shareTitle;
  }, [shareTitle]);

  return (
    <main className="px-4 py-10 min-h-screen bg-background text-foreground sm:px-6 sm:py-14">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl items-center justify-center sm:min-h-[calc(100vh-7rem)]">
        <section className="flex justify-center w-full">
          <div className="flex flex-col gap-6 items-center sm:gap-8">
            <div className="inline-flex items-center">
              <h1 className="whitespace-nowrap pr-2 text-[2.08rem] font-black leading-none tracking-tight text-foreground sm:pr-3 sm:text-[3.3rem]">
                {titlePrefix}
              </h1>

              <div className="relative px-2 border-x-2 border-foreground sm:px-3">
                {kindSwitchable ? (
                  <div
                    ref={pickerRef}
                    onScroll={onPickerScroll}
                    className="h-56 snap-y snap-mandatory overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:h-72"
                  >
                    <div className="h-20 sm:h-28" aria-hidden />
                    {SUBJECT_KIND_ORDER.map((item) => {
                      const meta = getSubjectKindMeta(item);
                      const active = item === kind;
                      return (
                        <button
                          key={item}
                          type="button"
                          ref={(element) => {
                            optionRefs.current[item] = element;
                          }}
                          onClick={() => {
                            setKind(item);
                            scrollKindIntoCenter(item, "smooth");
                          }}
                          className={cn(
                            "block w-full snap-center py-2 text-center font-black leading-none tracking-tight transition-colors duration-200 sm:py-3",
                            item === "lightnovel" || item === "tv"
                              ? "text-[1.68rem] sm:text-[2.35rem]"
                              : "text-[2.08rem] sm:text-[3rem]",
                            active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                    <div className="h-20 sm:h-28" aria-hidden />
                  </div>
                ) : (
                  <div className="flex h-56 items-center justify-center sm:h-72">
                    <span className="text-[2.08rem] font-black leading-none tracking-tight text-foreground sm:text-[3rem]">
                      {kindMeta.label}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <Button
              asChild
              className="inline-flex justify-center items-center px-4 py-3 w-full max-w-sm h-auto text-sm font-bold text-white bg-sky-600 rounded-full shadow-sm transition-all shadow-sky-200 hover:bg-sky-700"
            >
              <Link href={`/${kind}`} prefetch={false}>开始填写！</Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
