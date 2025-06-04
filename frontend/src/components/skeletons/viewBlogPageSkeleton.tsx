import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const ViewBlogPageSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen bg-zinc-950/20">
      <Skeleton className="h-[60px] w-full fixed top-0 left-0 z-50 bg-zinc-900 border-b border-zinc-800" />

      <div className="container mx-auto px-4 py-8 mt-[70px] sm:mt-[80px]">
        <Skeleton className="mb-8 h-[250px] sm:h-[300px] md:h-[400px] w-full rounded-xl bg-zinc-800" />

        <div className="flex flex-col lg:flex-row gap-8">
          <main className="flex-1 space-y-6">
            <Skeleton className="h-10 w-3/4 rounded bg-zinc-800" /> 
            <div className="flex items-center space-x-2">
              <Skeleton className="h-4 w-4 rounded-full bg-zinc-700" />
              <Skeleton className="h-4 w-1/3 rounded bg-zinc-700" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-5 w-full rounded bg-zinc-700" />
              <Skeleton className="h-5 w-full rounded bg-zinc-700" />
              <Skeleton className="h-5 w-5/6 rounded bg-zinc-700" />
              <Skeleton className="h-5 w-3/4 rounded bg-zinc-700" />
              <Skeleton className="h-5 w-full rounded bg-zinc-700" />
              <Skeleton className="h-5 w-2/3 rounded bg-zinc-700" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-20 rounded-md bg-zinc-800" />
              <Skeleton className="h-6 w-24 rounded-md bg-zinc-800" />
              <Skeleton className="h-6 w-16 rounded-md bg-zinc-800" />
            </div>
            <div className="mt-8 pt-6 border-t border-zinc-800">
              <Skeleton className="h-10 w-full sm:w-48 rounded-md bg-zinc-800" /> 
            </div>
          </main>

          <aside className="w-full lg:w-1/3 lg:max-w-xs xl:max-w-sm">
            <Card className="sticky top-20 shadow-lg bg-zinc-900/20 border-zinc-800">
              <CardHeader className="text-center border-b border-zinc-800 pb-6 pt-6">
                <Skeleton className="w-24 h-24 mx-auto mb-4 rounded-full bg-zinc-800" />
                <Skeleton className="h-6 w-3/4 mx-auto mb-1 rounded bg-zinc-800" />
                <Skeleton className="h-4 w-1/2 mx-auto rounded bg-zinc-700" />
              </CardHeader>
              <CardContent className="pt-6 space-y-3">
                <Skeleton className="h-5 w-1/3 rounded bg-zinc-800" /> 
                <Skeleton className="h-4 w-full rounded bg-zinc-700" />
                <Skeleton className="h-4 w-5/6 rounded bg-zinc-700" />
                <Skeleton className="h-4 w-3/4 rounded bg-zinc-700" />
                 <div className="flex flex-col space-y-3 pt-3">
                    <Skeleton className="h-10 w-full rounded-md bg-zinc-800" />
                    <Skeleton className="h-10 w-full rounded-md bg-red-900/30" />
                 </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
};

