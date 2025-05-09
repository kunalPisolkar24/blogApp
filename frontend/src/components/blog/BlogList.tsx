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

interface Tag {
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
  authorId: number;
  tags: Tag[];
  author: Author;
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
}

interface BlogListProps {
  filterTag?: string;
}

export const BlogList: React.FC<BlogListProps> = ({ filterTag }) => {
  const [blogPosts, setBlogPosts] = useState<FormattedBlogPost[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const itemsPerPage = 6;

  const formatBlogData = (data: BlogPost[]): FormattedBlogPost[] => {
    return data.map((post) => ({
      id: post.id,
      title: post.title,
      snippet: post.body.substring(0, 150) + (post.body.length > 150 ? "..." : ""),
      author: {
        name: post.author.username,
        avatarUrl: `https://i.pravatar.cc?u=${encodeURIComponent(
          post.author.username
        )}&background=random&color=fff&size=48&font-size=0.4&rounded=true`,
      },
      tags: post.tags.map((tag) => tag.tag.name),
      slug: `post-${post.id}`,
      imageUrl: `https://picsum.photos/seed/${post.id}/600/400`,
    }));
  };

  useEffect(() => {
    const fetchAllBlogs = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get<BlogPost[]>(
          `${import.meta.env.VITE_BACKEND_URL}/api/posts`
        );
        const formattedBlogs = formatBlogData(response.data);
        setBlogPosts(formattedBlogs);
        setTotalPages(Math.ceil(formattedBlogs.length / itemsPerPage));
      } catch (error) {
        console.error("Error fetching blogs:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (!filterTag) {
      fetchAllBlogs();
    }
  }, [filterTag]);

  useEffect(() => {
    if (filterTag) {
      const fetchFilteredBlogs = async () => {
        setIsLoading(true);
        setBlogPosts([]); 
        setCurrentPage(1);
        try {
          const response = await axios.get<BlogPost[]>(
            `${import.meta.env.VITE_BACKEND_URL}/api/tags/getPost/${filterTag}`
          );
          const formattedBlogs = formatBlogData(response.data);
          setBlogPosts(formattedBlogs);
          setTotalPages(Math.ceil(formattedBlogs.length / itemsPerPage));
        } catch (error) {
          console.error("Error fetching filtered blogs:", error);
          setTotalPages(0); 
        } finally {
          setIsLoading(false);
        }
      };
      fetchFilteredBlogs();
    }
  }, [filterTag]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentBlogPosts = blogPosts.slice(startIndex, endIndex);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isLoading && blogPosts.length === 0 && filterTag) {
     return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p className="text-xl text-muted-foreground">No posts found for the tag "{filterTag}".</p>
      </div>
    );
  }
  
  if (!isLoading && blogPosts.length === 0) {
    return (
     <div className="container mx-auto px-4 py-8 text-center">
       <p className="text-xl text-muted-foreground">No blog posts available yet.</p>
     </div>
   );
 }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-1 xs:m-[15px] sm:m-[20px] lg:m-[40px] md:m-[30px] lg:grid-cols-1 gap-8 m-6 max-w-7xl lg:mx-auto">
        {currentBlogPosts.map((post) => (
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