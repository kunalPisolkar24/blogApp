import React, { useEffect, useState } from 'react';
import axios from 'axios';
import BlogCard from './BlogCard';
import Image1 from "../../assets/blogImages/one.jpg";
import Image2 from "../../assets/blogImages/two.jpg";
import Image3 from "../../assets/blogImages/three.jpg";
import Image4 from "../../assets/blogImages/four.jpg";
import Image5 from "../../assets/blogImages/five.jpg";
import Image6 from "../../assets/blogImages/six.jpg";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import LoadingSpinner from './LoadingSpinner';

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
  id: number; // Add the blog ID
}

function shuffleArray(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

interface BlogListProps {
  filterTag?: string;
}

const BlogList: React.FC<BlogListProps> = ({ filterTag }) => {
  const [blogPosts, setBlogPosts] = useState<FormattedBlogPost[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const itemsPerPage = 6;
  const arr = [Image1, Image2, Image3, Image4, Image5, Image6];
  shuffleArray(arr);

  useEffect(() => {
    const fetchBlogs = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get<BlogPost[]>('https://blogapp.kpisolkar24.workers.dev/api/posts');
        const data = response.data;
        const formattedBlogs: FormattedBlogPost[] = data.map(post => ({
          title: post.title,
          snippet: post.body.substring(0, 200) + '...',
          author: {
            name: post.author.username,
            avatarUrl: `https://i.pravatar.cc/150?img=${post.authorId}`,
          },
          tags: post.tags.map(tag => tag.tag.name),
          slug: `post-${post.id}`,
          id: post.id, // Include the blog ID
        }));
        setBlogPosts(formattedBlogs);
        setTotalPages(Math.ceil(formattedBlogs.length / itemsPerPage));
      } catch (error) {
        console.error('Error fetching blogs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBlogs();
  }, []);

  useEffect(() => {
    if (filterTag) {
      const fetchFilteredBlogs = async () => {
        setIsLoading(true);
        try {
          const response = await axios.get<BlogPost[]>(`https://blogapp.kpisolkar24.workers.dev/api/tags/getPost/${filterTag}`);
          const data = response.data;
          const formattedBlogs: FormattedBlogPost[] = data.map(post => ({
            title: post.title,
            snippet: post.body.substring(0, 200) + '...',
            author: {
              name: post.author.username,
              avatarUrl: `https://i.pravatar.cc/150?img=${post.authorId}`,
            },
            tags: post.tags.map(tag => tag.tag.name),
            slug: `post-${post.id}`,
            id: post.id, // Include the blog ID
          }));
          setBlogPosts(formattedBlogs);
          setTotalPages(Math.ceil(formattedBlogs.length / itemsPerPage));
        } catch (error) {
          console.error('Error fetching filtered blogs:', error);
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

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-1 xs:m-[15px] sm:m-[20px] lg:m-[40px] md:m-[30px] lg:grid-cols-1 gap-6 m-6 max-w-7xl lg:mx-auto">
        {currentBlogPosts.map((post, index) => (
          <BlogCard imageUrl={arr[index % arr.length]} key={post.slug} {...post} />
        ))}
      </div>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            {currentPage > 1 && (
              <PaginationPrevious
                href="#"
                onClick={() => handlePageChange(currentPage - 1)}
              />
            )}
          </PaginationItem>

{Array.from({ length: totalPages }, (_, i) => (
  <PaginationItem key={i}>
    <PaginationLink
      href="#"
      onClick={() => handlePageChange(i + 1)}
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
                onClick={() => handlePageChange(currentPage + 1)}
              />
            )}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
};

export default BlogList;
