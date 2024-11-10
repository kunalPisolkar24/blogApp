import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "../../hooks/use-toast";
import { createPostSchema, CreatePostSchemaType } from '@kunalpisolkar24/blogapp-common';

import BannerImage from "../../assets/blogImages/banner.jpg";
import StickyNavbar from './StickyNavbar';

const CreateNewBlog: React.FC = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleAddTag = () => {
    if (newTag && !tags.includes(newTag)) {
      setTags([...tags, newTag]);
      setNewTag('');
      setIsDialogOpen(false);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const blogData: CreatePostSchemaType = {
      title,
      body: content,
      tags,
    };

    try {
      const parsedData = createPostSchema.parse(blogData);
      const token = localStorage.getItem('jwt');

      if (!token) {
        throw new Error('No token found');
      }

      await axios.post('https://blogapp.kpisolkar24.workers.dev/api/posts', parsedData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      toast({
        title: "Blog Created",
        description: "Your blog post has been successfully created.",
      });

      navigate('/');
    } catch (error) {
      console.error('Error creating blog:', error);
      toast({
        title: "Error",
        description: "Failed to create the blog post. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    toast({
      title: "Action Cancelled",
      description: "You've cancelled creating a new blog post.",
    });
    navigate('/');
  };

  return (
<div>
  <StickyNavbar />
    <div className="container mx-auto px-4 mt-[50px] py-8">
      <div className="mb-8">
        <img
          src={BannerImage}
          alt="Create New Blog Banner"
          width={1200}
          height={400}
          className="w-full h-[200px] md:h-[400px] object-cover rounded-lg shadow-md"
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
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
                    onClick={() => handleRemoveTag(tag)}
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
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Add Tags</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add a new tag</DialogTitle>
                <DialogDescription>
                  Enter a new tag for your blog post. Click add when you're done.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <Input
                  placeholder="Enter tag name"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleAddTag}>Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex justify-end space-x-4">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit">Submit</Button>
        </div>
      </form>
    </div>
</div> 
  );
};

export default CreateNewBlog;
