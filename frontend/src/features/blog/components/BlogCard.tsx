import type React from "react";
import { Link } from "react-router-dom";
import { Bookmark, Heart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/cn";
import { getBlogCardImageSources } from "@/entities/upload";
import { useSessionStore } from "@/entities/session";
import { useFeedMode } from "@/features/blog/feed-mode";
import { usePostInteractions } from "@/features/blog/interactions/usePostInteractions";
import {
  DEFAULT_BLOG_CARD_IMAGE,
  formatBlogCardDate,
  formatBlogCardTag,
  type BlogCardItem,
} from "@/entities/post/lib";

const MAX_VISIBLE_TAGS = 3;

type BlogCardProps = BlogCardItem;

export const BlogCard: React.FC<BlogCardProps> = ({
  imageUrl,
  title,
  snippet,
  author,
  tags,
  id,
  publishedAt,
  likedByMe,
  savedByMe,
  reason,
}) => {
  const isAuthenticated =
    useSessionStore((state) => state.status) === "authenticated";
  const feedMode = useFeedMode();
  const { liked, saved, isToggling, toggleLike, toggleSave } =
    usePostInteractions(id, likedByMe, savedByMe, feedMode);

  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const remainingTagsCount = tags.length - MAX_VISIBLE_TAGS;
  const formattedDate = publishedAt ? formatBlogCardDate(publishedAt) : null;
  const authorName = author.name.trim() || "Unknown Author";
  const publishedAtValue = publishedAt;
  const blogCardImage = getBlogCardImageSources(imageUrl ?? DEFAULT_BLOG_CARD_IMAGE);
  const fallbackImage = getBlogCardImageSources(DEFAULT_BLOG_CARD_IMAGE);

  return (
    <div className="group block">
      <Card
        data-interactive="true"
        className="gap-0 bg-surface-lowest py-0 group-focus-visible:bg-primary-container/20 group-focus-visible:[box-shadow:inset_0_0_0_1px_rgb(var(--primary)/0.38),0_0_0_1px_rgb(var(--primary-fixed-dim)/0.88)]"
      >
        <Link
          to={`/blog/${id}`}
          className="block focus-visible:outline-none"
          aria-label={`Open blog post: ${title}`}
        >
          <div className="grid min-w-0 gap-0 md:h-[280px] md:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.95fr)]">
            <div
              data-slot="blog-card-image-frame"
              className="relative aspect-[8/5] bg-surface-low md:col-start-2 md:row-start-1 md:h-full md:aspect-auto"
            >
              <img
                src={blogCardImage.src}
                srcSet={blogCardImage.srcSet}
                sizes={blogCardImage.sizes}
                alt={title}
                className="h-full w-full object-cover"
                width={blogCardImage.width}
                height={blogCardImage.height}
                decoding="async"
                loading="lazy"
                data-slot="blog-card-image"
                onError={(event) => {
                  if (event.currentTarget.src !== fallbackImage.src) {
                    event.currentTarget.src = fallbackImage.src;
                    event.currentTarget.sizes = fallbackImage.sizes;
                    if (fallbackImage.srcSet) {
                      event.currentTarget.srcset = fallbackImage.srcSet;
                    } else {
                      event.currentTarget.removeAttribute("srcset");
                    }
                  }
                }}
              />
            </div>

            <div
              data-slot="blog-card-content"
              className="flex min-w-0 flex-col gap-3 px-5 py-5 sm:px-6 sm:py-6 md:col-start-1 md:row-start-1 md:gap-4"
            >
              <div className="space-y-3">
                <div className="space-y-2">
                  <h2
                    data-slot="blog-card-title"
                    className="line-clamp-2 text-[1.3rem] font-semibold leading-[1.12] tracking-[-0.028em] text-foreground sm:text-[1.5rem] lg:text-[1.65rem]"
                  >
                    {title}
                  </h2>
                  <p className="line-clamp-3 max-w-3xl min-w-0 break-words text-[0.95rem] leading-7 tracking-[0.01em] text-muted-foreground sm:text-[1rem]">
                    {snippet}
                  </p>
                  {reason && (
                    <p
                      data-slot="blog-card-reason"
                      className="text-[0.8125rem] leading-5 text-muted-foreground/90"
                    >
                      {reason}
                    </p>
                  )}
                </div>

                {visibleTags.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-2.5 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-primary">
                    {visibleTags.map((tag) => (
                      <span key={tag}>{formatBlogCardTag(tag)}</span>
                    ))}
                    {remainingTagsCount > 0 && (
                      <span className="text-muted-foreground/90">
                        +{remainingTagsCount} MORE
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 border border-primary/75 bg-primary/20"
                />
                <span className="text-foreground/90">{authorName}</span>
                {formattedDate ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="h-3 w-px bg-outline-variant/30"
                    />
                    <time dateTime={publishedAtValue ?? undefined}>{formattedDate}</time>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </Link>

        {isAuthenticated && (
          <div
            data-slot="blog-card-actions"
            className="flex items-center gap-2 border-t border-outline-variant/20 px-5 py-3 sm:px-6"
          >
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void toggleLike()}
              disabled={isToggling}
              aria-pressed={liked}
              aria-label={liked ? "Unlike post" : "Like post"}
            >
              <Heart
                aria-hidden="true"
                className={cn(liked && "fill-current text-primary")}
              />
              {liked ? "Liked" : "Like"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void toggleSave()}
              disabled={isToggling}
              aria-pressed={saved}
              aria-label={saved ? "Remove save" : "Save post"}
            >
              <Bookmark
                aria-hidden="true"
                className={cn(saved && "fill-current text-primary")}
              />
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};