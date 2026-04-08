import Image from "next/image";
import { Plus } from "lucide-react";
import { ShareGame } from "@/lib/share/types";
import { SubjectKind } from "@/lib/subject-kind";

interface ReadonlyNineGridBoardProps {
  games: Array<ShareGame | null>;
  subjectLabel: string;
  kind?: SubjectKind;
}

function displayTitle(game: ShareGame) {
  return game.localizedName?.trim() || game.name;
}

export function ReadonlyNineGridBoard({ games, subjectLabel }: ReadonlyNineGridBoardProps) {
  return (
    <div className="w-full grid grid-cols-3 gap-2.5 sm:gap-3.5">
      {games.map((game, index) => {
        const id = game ? `subject-${game.id}-${index}` : `empty-${index}`;
        const hasComment = game?.comment && game.comment.trim().length > 0;
        return (
          <div key={id} className="relative">
            <div className="relative flex w-full flex-col overflow-hidden rounded-xl bg-[#1c1c2e] shadow-[0_2px_8px_rgba(0,0,0,0.25),0_8px_24px_rgba(0,0,0,0.15)] sm:rounded-2xl">
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
                    <span>选择{subjectLabel}</span>
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
          </div>
        );
      })}
    </div>
  );
}
