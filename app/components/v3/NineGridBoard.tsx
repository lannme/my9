"use client";

import Image from "next/image";
import { MessageSquare, Plus, X } from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { Feedback, AutoScroller, Cursor } from '@dnd-kit/dom';
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import { arrayMove } from "@dnd-kit/helpers";
import { ShareGame } from "@/lib/share/types";
import { SubjectKind } from "@/lib/subject-kind";
import { cn } from "@/lib/utils";

interface NineGridBoardProps {
  games: Array<ShareGame | null>;
  subjectLabel: string;
  kind?: SubjectKind;
  readOnly?: boolean;
  onSelectSlot?: (index: number) => void;
  onRemoveSlot?: (index: number) => void;
  onOpenComment?: (index: number) => void;
  onReorder?: (games: Array<ShareGame | null>) => void;
}

function displayTitle(game: ShareGame) {
  return game.localizedName?.trim() || game.name;
}

interface SortableSlotProps {
  children: (isDragSource: boolean) => React.ReactNode;
  id: string;
  index: number;
  disabled: boolean;
}

function SortableSlot({ children, id, index, disabled }: SortableSlotProps) {
  const { ref, isDragSource } = useSortable({ id, index, disabled });

  return (
    <div ref={ref} className="relative">
      {children(isDragSource)}
    </div>
  );
}

interface GridCellProps {
  game: ShareGame | null;
  index: number;
  subjectLabel: string;
  kind?: SubjectKind;
  readOnly?: boolean;
  isDragSource?: boolean;
  onSelectSlot?: (index: number) => void;
  onRemoveSlot?: (index: number) => void;
  onOpenComment?: (index: number) => void;
}

function GridCell({
  game,
  index,
  subjectLabel,
  readOnly,
  isDragSource,
  onSelectSlot,
  onRemoveSlot,
  onOpenComment,
}: GridCellProps) {
  const hasComment = game?.comment && game.comment.trim().length > 0;

  return (
    <>
      <div
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        aria-label={readOnly ? undefined : `选择第 ${index + 1} 格${subjectLabel}`}
        onClick={() => {
          if (readOnly) return;
          onSelectSlot?.(index);
        }}
        onKeyDown={(event) => {
          if (readOnly) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectSlot?.(index);
          }
        }}
        className={cn(
          "group relative flex w-full flex-col overflow-hidden rounded-xl bg-[#1c1c2e] shadow-[0_2px_8px_rgba(0,0,0,0.25),0_8px_24px_rgba(0,0,0,0.15)] transition-all sm:rounded-2xl",
          !readOnly && "cursor-pointer hover:shadow-[0_4px_16px_rgba(0,0,0,0.35),0_12px_32px_rgba(0,0,0,0.2)] hover:scale-[1.02]",
          isDragSource && "opacity-40 ring-2 ring-sky-400"
        )}
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden">
          {game?.cover ? (
            <Image
              src={game.cover}
              alt={displayTitle(game)}
              fill
              unoptimized
              className="absolute inset-0 object-cover select-none [-webkit-touch-callout:none]"
              sizes="(max-width: 640px) 30vw, (max-width: 1024px) 22vw, 180px"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted text-xs font-medium text-muted-foreground">
              <Plus className="h-4 w-4" />
              <span>选择</span>
            </div>
          )}
        </div>

        <div className="flex min-h-[1.75rem] flex-col justify-center px-1.5 py-1 sm:min-h-[2.25rem] sm:px-2.5 sm:py-1.5">
          <p className="truncate text-[10px] font-semibold leading-tight text-white/90 sm:text-xs">
            {game ? displayTitle(game) : `${subjectLabel} ${index + 1}`}
          </p>
          {hasComment && (
            <p className="mt-0.5 truncate text-[9px] leading-tight text-white/50 sm:text-[10px]">
              {game!.comment}
            </p>
          )}
        </div>
      </div>

      {game && !readOnly ? (
        <div className="absolute bottom-[1.75rem] right-1 flex items-center gap-1 sm:bottom-[2.25rem] sm:right-1.5 sm:gap-1.5">
          <button
            type="button"
            aria-label={`编辑第 ${index + 1} 格评论`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenComment?.(index);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm transition hover:bg-sky-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 sm:h-8 sm:w-8"
          >
            <MessageSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`移除第 ${index + 1} 格游戏`}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveSlot?.(index);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm transition hover:bg-rose-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 sm:h-8 sm:w-8"
          >
            <X className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </button>
        </div>
      ) : null}
    </>
  );
}

export function NineGridBoard({
  games,
  subjectLabel,
  kind,
  readOnly,
  onSelectSlot,
  onRemoveSlot,
  onOpenComment,
  onReorder,
}: NineGridBoardProps) {
  const grid = (
    <div className="w-full grid grid-cols-3 gap-2.5 sm:gap-3.5">
      {games.map((game, index) => {
        const id = game ? `subject-${game.id}` : `empty-${index}`;

        if (readOnly) {
          return (
            <div key={id} className="relative">
              <GridCell
                game={game}
                index={index}
                subjectLabel={subjectLabel}
                kind={kind}
                readOnly
              />
            </div>
          );
        }

        return (
          <SortableSlot
            key={id}
            id={id}
            index={index}
            disabled={!game}
          >
            {(isDragSource) => (
              <GridCell
                game={game}
                index={index}
                subjectLabel={subjectLabel}
                kind={kind}
                isDragSource={isDragSource}
                onSelectSlot={onSelectSlot}
                onRemoveSlot={onRemoveSlot}
                onOpenComment={onOpenComment}
              />
            )}
          </SortableSlot>
        );
      })}
    </div>
  );

  if (readOnly) return grid;

  return (
    <DragDropProvider
      plugins={[
        Feedback,
        AutoScroller,
        Cursor
      ]}
      onDragEnd={(event) => {
        if (!onReorder) return;
        const { source, canceled } = event.operation;
        if (!source || canceled || !isSortable(source)) return;
        const from = source.initialIndex;
        const to = source.index;
        if (from === to) return;
        onReorder(arrayMove(games, from, to));
      }}
    >
      {grid}
    </DragDropProvider>
  );
}
