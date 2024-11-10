import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import LoadingSpinner from "./LoadingSpinner";
import BannerImage from "../../assets/blogImages/banner.jpg";
import { toast } from "../../hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X } from 'lucide-react';
import { updatePostSchema, UpdatePostSchemaType } from '@kunalpisolkar24/blogapp-common';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import StickyNavbar from './StickyNavbar';

interface Tag {
  id: number;
  name: string;
}

interface Blog {
  id: number;
  title: string;
  body: string;
  authorId: number;
  tags: {
    postId: number;
    tagId: number;
    tag: Tag;
  }[];
  author: {
    id: number;
    username: string;
    email: string;
  };
}

interface Author {
  name: string;
  email: string;
  avatar: string;
  bio: string;
}

const ViewBlogPage: React.FC = () => {
  const [blog, setBlog] = useState<Blog | null>(null);
  const [author, setAuthor] = useState<Author | null>(null);
  const [isAuthor, setIsAuthor] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchBlogData = async () => {
      try {
        const response = await axios.get<Blog>(`https://blogapp.kpisolkar24.workers.dev/api/posts/${id}`);
        setBlog(response.data);
        setAuthor({
          name: response.data.author.username,
          email: response.data.author.email,
          avatar: '/placeholder.svg?height=128&width=128',
          bio: 'I\'m is a seasoned web developer and AI enthusiast with over a decade of experience in creating innovative digital solutions. I\'m passionate about exploring the intersection of AI and web technologies.'
        });

        const jwt = localStorage.getItem('jwt');
        if (jwt) {
          const decodedToken = JSON.parse(atob(jwt.split('.')[1]));
          const userId = decodedToken.id;
          setIsAuthor(userId === response.data.authorId);
        }
      } catch (error) {
        console.error("Failed to fetch blog data:", error);
      }
    };

    fetchBlogData();
  }, [id]);

  const handleDelete = async () => {
    try {
      const jwt = localStorage.getItem('jwt');
      if (!jwt) {
        throw new Error('No token found');
      }

      await axios.delete(`https://blogapp.kpisolkar24.workers.dev/api/posts/${id}`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      });

      toast({
        title: "Blog Deleted",
        description: "Your blog post has been successfully deleted.",
      });

      navigate('/');
    } catch (error) {
      console.error('Error deleting blog:', error);
      toast({
        title: "Error",
        description: "Failed to delete the blog post. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const jwt = localStorage.getItem('jwt');
      if (!jwt) {
        throw new Error('No token found');
      }

      const blogData: UpdatePostSchemaType = {
        title,
        body: content,
        tags,
      };

      const parsedData = updatePostSchema.parse(blogData);

      await axios.put(`https://blogapp.kpisolkar24.workers.dev/api/posts/${id}`, parsedData, {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      });

      toast({
        title: "Blog Updated",
        description: "Your blog post has been successfully updated.",
      });

      setIsEditing(false);
      navigate('/');
    } catch (error) {
      console.error('Error updating blog:', error);
      toast({
        title: "Error",
        description: "Failed to update the blog post. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEdit = () => {
    if (blog) {
      setTitle(blog.title);
      setContent(blog.body);
      setTags(blog.tags.map(tag => tag.tag.name));
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    toast({
      title: "Action Cancelled",
      description: "You've cancelled updating the blog post.",
    });
  };

  const handleAddTag = () => {
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag]);
      setNewTag('');
    }
  };

  if (!blog || !author) {
    return <LoadingSpinner />;
  }

  return (
    <div>
    <StickyNavbar /> 
    <div className="mt-[40px] container mx-auto px-4 py-8">
      <div className="mb-8">
        <img
          src={BannerImage}
          alt="Blog banner"
          width={1200}
          height={400}
          className="w-full h-[400px] object-cover rounded-lg shadow-md"
        />
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        <main className="flex-1">
          {isEditing ? (
            <form onSubmit={handleUpdate} className="space-y-8">
              <div>
                <Input
                  type="text"
                  placeholder="Enter title for the blog"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="text-2xl font-bold p-4"
                  required
                />
              </div>

              <div>
                <Textarea
                  placeholder="Write your blog content here..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[300px] p-4"
                  required
                />
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-2">Tags</h3>
                <div className="flex flex-wrap gap-2 mb-4">
                  {tags.length > 0 ? (
                    tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="px-3 py-1">
                        {tag}
                        <button
                          onClick={() => setTags(tags.filter(t => t !== tag))}
                          className="ml-2 text-xs"
                          aria-label={`Remove ${tag} tag`}
                        >
                          <X size={12} />
                        </button>
                      </Badge>
                    ))
                  ) : (
                    <p className="text-muted-foreground">No tags added yet.</p>
                  )}
                </div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button>Add Tag</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Tag</DialogTitle>
                      <DialogDescription>
                        Enter the tag name you want to add.
                      </DialogDescription>
                    </DialogHeader>
                    <Input
                      placeholder="Enter tag name"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      className="mb-4"
                    />
                    <DialogFooter>
                      <Button type="button" onClick={handleAddTag}>Add</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="flex justify-end space-x-4">
                <Button type="button" variant="outline" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button type="submit">Submit</Button>
              </div>
            </form>
          ) : (
            <>
              <h1 className="text-4xl font-bold mb-6">{blog.title}</h1>
              <div
                className="prose prose-lg max-w-none mb-8"
                dangerouslySetInnerHTML={{ __html: blog.body }}
              />
              <div className="flex flex-wrap gap-2">
                {blog.tags.map((tag) => (
                  <Badge key={tag.tag.id} variant="secondary" className="hover:bg-secondary/80 transition-colors">
                    {tag.tag.name}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </main>

        <aside className="w-full md:w-1/3 md:max-w-xs">
          <Card className="sticky top-4">
            <CardHeader className="text-center">
              <Avatar className="w-24 h-24 mx-auto mb-4">
                <AvatarImage src={author.avatar} alt={author.name} />
                <AvatarFallback className="text-[40px]">{author.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <CardTitle className="text-xl mb-1">{author.name}</CardTitle>
              <p className="text-sm text-muted-foreground">{author.email}</p>
            </CardHeader>
            <CardContent>
              <h3 className="font-semibold mb-2">About</h3>
              <p className="text-sm text-muted-foreground">{author.bio}</p>
              {isAuthor && (
                <div className="flex space-x-[45px] mt-4">
                  <Button variant="destructive" onClick={handleDelete}>
                    Delete Blog
                  </Button>
                  <Button className="" variant="secondary" onClick={handleEdit}>
                    Update Blog
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
</div>  
  );
};

export default ViewBlogPage;
