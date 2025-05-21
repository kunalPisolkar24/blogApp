import React, { useEffect, useState } from "react";
import axios from "axios";
import { BlogCard } from "./BlogCard";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { LoadingSpinner } from "../utils";

interface TagItem {
  postId: number;
  tagId: number;
  tag: {
    id: number;
    name: string;
  };
}

interface Author {
  id: number;
  username: string;
  email: string;
}

interface BlogPost {
  id: number;
  title: string;
  body: string;
  imageUrl?: string;
  authorId: number;
  tags: TagItem[];
  author: Author;
  createdAt: string;
  updatedAt: string;
}

interface FormattedBlogPost {
  title: string;
  snippet: string;
  author: {
    name: string;
    avatarUrl: string;
  };
  tags: string[];
  slug: string;
  id: number;
  imageUrl: string;
  publishedAt: Date;
}

interface PaginatedResponse {
  data: BlogPost[];
  totalPages: number;
  currentPage: number;
  totalPosts: number;
}

interface BlogListProps {
  filterTag?: string;
}

const stripHtml = (html: string): string => {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent || "";
  }
  return html.replace(/<[^>]+>/g, "");
};

const DEFAULT_PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1554995207-c18c203602cb?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=600&q=80";

export const BlogList: React.FC<BlogListProps> = ({ filterTag }) => {
  const [blogPosts, setBlogPosts] = useState<FormattedBlogPost[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPosts, setTotalPosts] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const itemsPerPage = 6;

  const formatBlogData = (data: BlogPost[]): FormattedBlogPost[] => {
    return data.map((post) => {
      const plainTextBody = stripHtml(post.body);
      return {
        id: post.id,
        title: post.title,
        snippet:
          plainTextBody.substring(0, 150) +
          (plainTextBody.length > 150 ? "..." : ""),
        author: {
          name: post.author.username,
          avatarUrl: `https://i.pravatar.cc/48?u=${encodeURIComponent(
            post.author.username
          )}`,
        },
        tags: post.tags.map((tagItem) => tagItem.tag.name),
        slug: `post-${post.id}`,
        imageUrl: post.imageUrl || DEFAULT_PLACEHOLDER_IMAGE,
        publishedAt: new Date(post.createdAt),
      };
    });
  };

  useEffect(() => {
    const fetchBlogs = async () => {
      setIsLoading(true);
      let url = "";
      const params = `?page=${currentPage}&limit=${itemsPerPage}`;

      if (filterTag) {
        url = `${
          import.meta.env.VITE_BACKEND_URL
        }/api/tags/getPost/${encodeURIComponent(filterTag)}${params}`;
      } else {
        url = `${import.meta.env.VITE_BACKEND_URL}/api/posts${params}`;
      }

      try {
        const response = await axios.get<PaginatedResponse>(url);
        const formattedBlogs = formatBlogData(response.data.data);
        setBlogPosts(formattedBlogs);
        setTotalPages(response.data.totalPages);
        setCurrentPage(response.data.currentPage);
        setTotalPosts(response.data.totalPosts);
      } catch (error) {
        console.error("Error fetching blogs:", error);
        setBlogPosts([]);
        setTotalPages(1);
        setTotalPosts(0);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBlogs();
  }, [currentPage, filterTag]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterTag]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isLoading && totalPosts === 0) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p className="text-xl text-muted-foreground">
          {filterTag
            ? `No posts found for the tag "${filterTag}".`
            : "No blog posts available yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-1 xs:m-[15px] sm:m-[20px] lg:m-[40px] md:m-[30px] lg:grid-cols-1 gap-8 m-6 max-w-7xl lg:mx-auto">
        {blogPosts.map((post) => (
          <BlogCard key={post.slug} {...post} />
        ))}
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              {currentPage > 1 && (
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    handlePageChange(currentPage - 1);
                  }}
                />
              )}
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => (
              <PaginationItem key={i}>
                <PaginationLink
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    handlePageChange(i + 1);
                  }}
                  isActive={currentPage === i + 1}
                >
                  {i + 1}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              {currentPage < totalPages && (
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    handlePageChange(currentPage + 1);
                  }}
                />
              )}
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
};
