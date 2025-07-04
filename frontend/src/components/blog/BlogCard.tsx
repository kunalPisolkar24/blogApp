import type React from "react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, ArrowRight } from "lucide-react";

interface BlogCardProps {
  imageUrl: string;
  title: string;
  snippet: string;
  author: {
    name: string;
    avatarUrl: string;
  };
  tags: string[];
  slug: string;
  id: number;
  publishedAt: Date;
}

const MAX_VISIBLE_TAGS = 3;

export const BlogCard: React.FC<BlogCardProps> = ({
  imageUrl,
  title,
  snippet,
  author,
  tags,
  id,
  publishedAt,
}) => {
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const remainingTagsCount = tags.length - MAX_VISIBLE_TAGS;

  let timeAgo = "just now";
  try {
    if (
      publishedAt &&
      publishedAt instanceof Date &&
      !isNaN(publishedAt.getTime())
    ) {
      timeAgo = formatDistanceToNow(publishedAt, { addSuffix: true });
    } else if (typeof publishedAt === "string") {
      const dateObj = new Date(publishedAt);
      if (!isNaN(dateObj.getTime())) {
        timeAgo = formatDistanceToNow(dateObj, { addSuffix: true });
      }
    }
  } catch (error) {
    console.error("Error formatting date:", publishedAt, error);
  }

  return (
    <Link to={`/blog/${id}`} className="block group">
      <Card className="overflow-hidden border-zinc-800 bg-zinc-950 transition-all duration-300 hover:bg-zinc-900 hover:shadow-xl hover:shadow-zinc-900/20">
        <div className="flex flex-col sm:flex-row md:h-[300px]">
          <div className="relative h-48 w-full overflow-hidden sm:h-auto sm:w-2/5 sm:order-2">
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent opacity-60 sm:hidden"></div>
            <img
              src={imageUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
              onError={(e) =>
                (e.currentTarget.src =
                  "https://images.unsplash.com/photo-1554995207-c18c203602cb?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=600&q=80")
              } // Fallback image
            />
          </div>

          <CardContent className="flex flex-1 flex-col justify-between p-5 sm:order-1 sm:p-6">
            <div className="mb-4">
              <h2 className="mb-2 line-clamp-2 text-xl font-bold text-zinc-100 transition-colors duration-300 group-hover:text-zinc-50 sm:text-2xl">
                {title}
              </h2>
              <p className="line-clamp-3 text-sm text-zinc-400 sm:line-clamp-4">
                {snippet}
              </p>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {visibleTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border-zinc-700"
                >
                  {tag}
                </Badge>
              ))}
              {remainingTagsCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                >
                  +{remainingTagsCount} more
                </Badge>
              )}
            </div>

            <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8 border border-zinc-700">
                  <AvatarImage
                    src={author.avatarUrl || "/placeholder.svg"}
                    alt={author.name}
                  />
                  <AvatarFallback className="bg-zinc-800 text-zinc-300">
                    {author.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-zinc-300">
                    {author.name}
                  </span>
                  <div className="flex items-center text-xs text-zinc-500">
                    <Clock className="mr-1 h-3 w-3" />
                    {timeAgo}
                  </div>
                </div>
              </div>

              <div className="flex items-center text-sm font-medium text-zinc-400 transition-colors group-hover:text-zinc-300">
                Read More
                <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
};
