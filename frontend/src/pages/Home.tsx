import React, { useState } from "react";
import { StickyNavbar } from "@/widgets";
import { BlogList, ForYouList } from "@/features/blog";
import { SearchBar } from "@/features/search";
import { ErrorBoundary } from "@/app/providers/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X } from "lucide-react";

const Home: React.FC = () => {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const handleTagSelect = (tag: string | null) => {
    setSelectedTag(tag);
  };

  return (
    <div className="min-h-screen bg-surface">
      <StickyNavbar />

      <main className="mx-auto pt-4 md:pt-4 pt-8">
        <ErrorBoundary>
          <SearchBar onTagSelect={handleTagSelect} currentFilterTag={selectedTag} />
        </ErrorBoundary>

        {selectedTag && (
          <div className="container mx-auto mt-6 max-w-[88rem] px-4 sm:px-5 lg:px-6">
            <div
              role="status"
              aria-live="polite"
              data-slot="filter-chip"
              className="inline-flex items-center gap-1 bg-surface-highest p-1 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted-foreground"
            >
              <span className="px-2 py-1">Filtering by:</span>
              <span
                data-slot="filter-chip-tag"
                className="bg-primary-container px-2 py-1 text-primary-foreground"
              >
                {selectedTag}
              </span>
              <Button
                type="button"
                onClick={() => handleTagSelect(null)}
                size="icon-xs"
                variant="ghost"
                className="ml-1 text-muted-foreground hover:bg-surface-high hover:text-foreground"
                aria-label={`Clear filter for ${selectedTag}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        <ErrorBoundary>
          {selectedTag ? (
            <BlogList filterTag={selectedTag} />
          ) : (
            <div className="mx-auto w-full max-w-[88rem] px-4 pt-8 sm:px-5 lg:px-6">
              <Tabs defaultValue="latest">
                <TabsList>
                  <TabsTrigger value="latest">Latest</TabsTrigger>
                  <TabsTrigger value="for-you">For You</TabsTrigger>
                </TabsList>
                <TabsContent value="latest">
                  <BlogList />
                </TabsContent>
                <TabsContent value="for-you">
                  <ForYouList />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
};

export default Home;