import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client/react";
import { BlogCard } from "./BlogCard";
import { BlogCardSkeleton } from "@/shared/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/entities/session";
import { FeedModeProvider } from "@/features/blog/feed-mode";
import { markFeedMode } from "@/features/blog/viewing/feed-attribution";
import {
  PostsDocument,
  RecommendedPostsDocument,
  type RecommendMode,
} from "@/shared/graphql/content-documents";
import { mapPostToBlogCardItem } from "@/entities/post/lib";
import { PagePagination } from "@/widgets";

const ITEMS_PER_PAGE = 6;
const FOR_YOU_HEADING = "FOR YOU";

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export const ForYouList: React.FC = () => {
  const isAuthenticated =
    useSessionStore((state) => state.status) === "authenticated";
  const [currentPage, setCurrentPage] = useState(1);
  const [mode, setMode] = useState<RecommendMode>("DEFAULT");
  const [seed, setSeed] = useState(randomSeed);
  const [useLatestFallback, setUseLatestFallback] = useState(false);

  const recommendedQuery = useQuery(RecommendedPostsDocument, {
    variables: { page: currentPage, limit: ITEMS_PER_PAGE, mode, seed },
    skip: !isAuthenticated || useLatestFallback,
    notifyOnNetworkStatusChange: true,
  });

  const latestQuery = useQuery(PostsDocument, {
    variables: { page: currentPage, limit: ITEMS_PER_PAGE },
    skip: isAuthenticated && !useLatestFallback,
    notifyOnNetworkStatusChange: true,
  });

  const showLatest = !isAuthenticated || useLatestFallback;
  const paginatedPosts = showLatest
    ? latestQuery.data?.posts
    : recommendedQuery.data?.recommendedPosts;

  useEffect(() => {
    if (!isAuthenticated || useLatestFallback) {
      return;
    }
    const recommended = recommendedQuery.data?.recommendedPosts;
    const isEmptyResult =
      !recommendedQuery.loading && recommended && recommended.posts.length === 0;
    if (recommendedQuery.error || isEmptyResult) {
      setUseLatestFallback(true);
    }
  }, [
    recommendedQuery.data,
    recommendedQuery.error,
    recommendedQuery.loading,
    isAuthenticated,
    useLatestFallback,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [mode, seed]);

  const blogPosts = useMemo(
    () => paginatedPosts?.posts.map(mapPostToBlogCardItem) ?? [],
    [paginatedPosts],
  );

  // Remember the feed mode per rendered card so the view recorded on
  // the detail page can be attributed to this feed. Only the
  // recommendation feed attributes: the latest fallback is not a
  // personalized feed, so it leaves no attribution behind.
  useEffect(() => {
    if (!isAuthenticated || useLatestFallback) {
      return;
    }
    blogPosts.forEach((post) => markFeedMode(post.id, mode));
  }, [blogPosts, mode, isAuthenticated, useLatestFallback]);

  const totalPages = paginatedPosts?.totalPages ?? 1;
  const totalPosts = paginatedPosts?.totalPosts ?? 0;

  const handleSurprise = () => {
    setMode("SURPRISE");
    setSeed(randomSeed());
    setUseLatestFallback(false);
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const sectionHeading = (
    <div className="mb-6 flex items-center justify-between">
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.28em] text-muted-foreground">
        {FOR_YOU_HEADING}
      </p>
      {isAuthenticated && (
        <Button type="button" variant="outline" size="sm" onClick={handleSurprise}>
          Surprise me
        </Button>
      )}
    </div>
  );

  const loading = showLatest ? latestQuery.loading : recommendedQuery.loading;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[88rem] px-4 py-8 sm:px-5 lg:px-6">
        {sectionHeading}
        <div className="space-y-4">
          {Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
            <BlogCardSkeleton key={index} />
          ))}
        </div>
        <div className="mb-6 mt-10 flex items-center justify-center space-x-2">
          <Skeleton className="h-10 w-24 rounded-none bg-surface-low" />
          <Skeleton className="h-10 w-10 rounded-none bg-surface-low" />
          <Skeleton className="h-10 w-10 rounded-none bg-surface-low" />
          <Skeleton className="h-10 w-10 rounded-none bg-surface-low" />
          <Skeleton className="h-10 w-24 rounded-none bg-surface-low" />
        </div>
      </div>
    );
  }

  if (totalPosts === 0) {
    return (
      <div className="mx-auto w-full max-w-[88rem] px-4 py-8 sm:px-5 lg:px-6">
        {sectionHeading}
        <p className="text-lg text-muted-foreground">
          No blog posts available yet.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-8 sm:px-5 lg:px-6">
      {sectionHeading}
      <FeedModeProvider value={mode}>
        <div className="space-y-4">
          {blogPosts.map((post) => (
            <BlogCard key={post.id} {...post} />
          ))}
        </div>
      </FeedModeProvider>

      <div className="mt-10">
        <PagePagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  );
};