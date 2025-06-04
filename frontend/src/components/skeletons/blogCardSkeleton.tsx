import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export const BlogCardSkeleton: React.FC = () => {
  return (
    <Card className="overflow-hidden border-zinc-800 bg-zinc-950">
      <div className="flex flex-col sm:flex-row md:h-[300px]">
        <Skeleton className="h-48 w-full sm:h-auto sm:w-2/5 sm:order-2 bg-zinc-800" />
        <CardContent className="flex flex-1 flex-col justify-between p-5 sm:order-1 sm:p-6">
          <div className="mb-4">
            <Skeleton className="mb-3 h-6 w-3/4 rounded bg-zinc-700 sm:h-7" />
            <Skeleton className="mb-1 h-5 w-full rounded bg-zinc-700" />
            <Skeleton className="h-5 w-5/6 rounded bg-zinc-700" />
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Skeleton className="h-6 w-16 rounded-md bg-zinc-800" />
            <Skeleton className="h-6 w-20 rounded-md bg-zinc-800" />
            <Skeleton className="h-6 w-12 rounded-md bg-zinc-800" />
          </div>
          <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full bg-zinc-800" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-20 rounded bg-zinc-700" />
                <Skeleton className="h-3 w-24 rounded bg-zinc-700" />
              </div>
            </div>
            <Skeleton className="h-5 w-24 rounded bg-zinc-700 sm:self-end" />
          </div>
        </CardContent>
      </div>
    </Card>
  );
};