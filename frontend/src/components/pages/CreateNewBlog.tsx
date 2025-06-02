"use client";

import type React from "react";
import { useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  X,
  UploadCloud,
  ImageIcon,
  FileText,
  Tag,
  Sparkles,
} from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { createPostSchema } from "@kunalpisolkar24/blogapp-common";
import { StickyNavbar } from "../layouts";

const CreateNewBlog: React.FC = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [cardImage, setCardImage] = useState<File | null>(null);
  const [cardImageUrl, setCardImageUrl] = useState<string | null>(null);
  const [cardImagePreview, setCardImagePreview] = useState<string | null>(null);
  const [isUploadingCardImage, setIsUploadingCardImage] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const quillRef = useRef<ReactQuill>(null);
  const cardImageInputRef = useRef<HTMLInputElement>(null);

  const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${
    import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  }/image/upload`;
  const CLOUDINARY_UPLOAD_PRESET = import.meta.env
    .VITE_CLOUDINARY_UPLOAD_PRESET;

  const handleCardImageChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setCardImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCardImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setCardImageUrl(null);
    }
  };

  const uploadCardImageToCloudinary = async () => {
    if (!cardImage) {
      toast({
        title: "No Card Image",
        description: "Please select an image for the blog card.",
        variant: "destructive",
      });
      return null;
    }
    if (!CLOUDINARY_URL || !CLOUDINARY_UPLOAD_PRESET) {
      console.error(
        "Cloudinary URL or Upload Preset is not defined for card image."
      );
      toast({
        title: "Upload Error",
        description: "Cloudinary configuration missing.",
        variant: "destructive",
      });
      return null;
    }

    const formData = new FormData();
    formData.append("file", cardImage);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    setIsUploadingCardImage(true);
    try {
      toast({ title: "Uploading Card Image...", description: "Please wait." });
      const response = await axios.post(CLOUDINARY_URL, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setCardImageUrl(response.data.secure_url);
      toast({
        title: "Card Image Uploaded",
        description: "Successfully uploaded to Cloudinary.",
      });
      return response.data.secure_url;
    } catch (error) {
      console.error("Error uploading card image:", error);
      toast({
        title: "Card Image Upload Failed",
        description: "Could not upload image.",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsUploadingCardImage(false);
    }
  };

  const richTextimageHandler = async () => {
    if (!CLOUDINARY_URL || !CLOUDINARY_UPLOAD_PRESET) {
      console.error("Cloudinary URL or Upload Preset is not defined.");
      toast({
        title: "Image Upload Error",
        description: "Cloudinary configuration is missing.",
        variant: "destructive",
      });
      return;
    }
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*");
    input.click();
    input.onchange = async () => {
      if (input.files && input.files.length > 0) {
        const file = input.files[0];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
        try {
          toast({ title: "Uploading Image...", description: "Please wait." });
          const response = await axios.post(CLOUDINARY_URL, formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          const imageUrl = response.data.secure_url;
          const quill = quillRef.current?.getEditor();
          if (quill) {
            const range = quill.getSelection(true);
            quill.insertEmbed(range.index, "image", imageUrl);
            quill.setSelection(range.index + 1, 0);
          }
          toast({
            title: "Image Uploaded",
            description: "Successfully added to content.",
          });
        } catch (error) {
          console.error("Error uploading image to Cloudinary:", error);
          toast({ title: "Image Upload Failed", variant: "destructive" });
        }
      }
    };
  };

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, 4, 5, 6, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ indent: "-1" }, { indent: "+1" }],
          [{ align: [] }],
          ["link", "image", "video"],
          ["blockquote", "code-block"],
          [{ color: [] }, { background: [] }],
          ["clean"],
        ],
        handlers: { image: richTextimageHandler },
      },
      clipboard: { matchVisual: false },
    }),
    []
  );

  const formats = [
    "header",
    "bold",
    "italic",
    "underline",
    "strike",
    "list",
    "bullet",
    "indent",
    "align",
    "link",
    "image",
    "video",
    "blockquote",
    "code-block",
    "color",
    "background",
  ];

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag("");
      setIsDialogOpen(false);
    } else if (!newTag.trim()) {
      toast({
        title: "Empty Tag",
        description: "Tag cannot be empty.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Duplicate Tag",
        description: "This tag has already been added.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalCardImageUrl = cardImageUrl;

    if (cardImage && !finalCardImageUrl) {
      const uploadedUrl = await uploadCardImageToCloudinary();
      if (!uploadedUrl) {
        toast({
          title: "Submission Error",
          description: "Card image failed to upload. Please try again.",
          variant: "destructive",
        });
        return;
      }
      finalCardImageUrl = uploadedUrl;
    }

    if (!finalCardImageUrl) {
      toast({
        title: "Missing Card Image",
        description: "Please upload a card image for the blog.",
        variant: "destructive",
      });
      return;
    }

    const blogData = {
      title,
      body: content,
      tags,
      imageUrl: finalCardImageUrl,
    };

    try {
      createPostSchema.parse(blogData);
      const token = localStorage.getItem("jwt");
      if (!token) {
        toast({
          title: "Authentication Error",
          description: "Please log in.",
          variant: "destructive",
        });
        navigate("/login");
        return;
      }
      await axios.post(
        `${import.meta.env.VITE_BACKEND_URL}/api/posts`,
        blogData,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      toast({ title: "Blog Created", description: "Successfully created." });
      navigate("/");
    } catch (error: any) {
      console.error("Error creating blog:", error);
      if (error.errors) {
        error.errors.forEach((err: any) => {
          toast({
            title: "Validation Error",
            description: `${err.path.join(".")} - ${err.message}`,
            variant: "destructive",
          });
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to create blog post.",
          variant: "destructive",
        });
      }
    }
  };

  const handleCancel = () => {
    toast({
      title: "Action Cancelled",
      description: "Blog creation cancelled.",
    });
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      <StickyNavbar />
      <div className="container mx-auto px-4 mt-[70px] py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl lg:text-4xl font-bold text-zinc-100 mb-2 flex items-center">
              <Sparkles className="mr-3 h-8 w-8 text-zinc-400" />
              Create New Blog Post
            </h1>
            <p className="text-zinc-400">
              Share your thoughts and ideas with the world
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Title Section */}
            <Card className="bg-zinc-900/20 border-zinc-800 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="text-zinc-100 flex items-center">
                  <FileText className="mr-2 h-5 w-5 text-zinc-400" />
                  Blog Title
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Input
                  id="blogTitle"
                  type="text"
                  placeholder="Enter an engaging title for your blog post..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="text-xl prose p-4 bg-zinc-800/20 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500"
                  required
                />
              </CardContent>
            </Card>

            {/* Card Image Section */}
            <Card className="bg-zinc-900/20 border-zinc-800 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="text-zinc-100 flex items-center">
                  <ImageIcon className="mr-2 h-5 w-5 text-zinc-400" />
                  Featured Image
                </CardTitle>
                <p className="text-sm text-zinc-400">
                  Upload a compelling image for your blog card (Recommended:
                  600x400)
                </p>
              </CardHeader>
              <CardContent>
                <div
                  className="flex justify-center items-center px-6 pt-5 pb-6 border-2 border-dashed border-zinc-700 rounded-xl cursor-pointer h-64 bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
                  onClick={() => cardImageInputRef.current?.click()}
                >
                  <div className="space-y-2 text-center">
                    {cardImagePreview ? (
                      <img
                        src={cardImagePreview || "/placeholder.svg"}
                        alt="Card preview"
                        className="mx-auto h-48 object-contain rounded-lg"
                      />
                    ) : (
                      <UploadCloud className="mx-auto h-12 w-12 text-zinc-400" />
                    )}
                    <div className="text-sm text-zinc-400">
                      <span className="font-medium text-zinc-300 hover:text-zinc-100 transition-colors">
                        {cardImage ? "Change image" : "Upload an image"}
                      </span>
                      <input
                        id="cardImageUpload"
                        name="cardImageUpload"
                        type="file"
                        className="sr-only"
                        accept="image/*"
                        ref={cardImageInputRef}
                        onChange={handleCardImageChange}
                      />
                    </div>
                    {!cardImagePreview && (
                      <p className="text-xs text-zinc-500">
                        PNG, JPG, GIF up to 10MB
                      </p>
                    )}
                    {cardImage && (
                      <p className="text-xs text-zinc-400 mt-1">
                        {cardImage.name}
                      </p>
                    )}
                  </div>
                </div>
                {cardImageUrl && (
                  <div className="mt-3 p-3 bg-green-900/20 border border-green-800/50 rounded-lg">
                    <div className="text-sm text-green-300 flex items-center">
                      <ImageIcon size={16} className="mr-2" />
                      Image uploaded successfully
                    </div>
                  </div>
                )}
                {isUploadingCardImage && (
                  <div className="mt-3 p-3 bg-zinc-800 border border-zinc-700 rounded-lg">
                    <p className="text-sm text-zinc-300">
                      Uploading card image...
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Content Section */}
            <Card className="bg-zinc-900/20 border-zinc-800 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="text-zinc-100 flex items-center">
                  <FileText className="mr-2 h-5 w-5 text-zinc-400" />
                  Blog Content
                </CardTitle>
                <p className="text-sm text-zinc-400">
                  Write your blog content using the rich text editor
                </p>
              </CardHeader>
              <CardContent>
                <div className="blog-content-editor-wrapper rounded-lg overflow-hidden border border-zinc-700">
                  <ReactQuill
                    ref={quillRef}
                    theme="snow"
                    value={content}
                    onChange={setContent}
                    modules={modules}
                    formats={formats}
                    placeholder="Write your masterpiece here..."
                    id="blogContent"
                    bounds={".blog-content-editor-wrapper"}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Tags Section */}
            <Card className="bg-zinc-900/20 border-zinc-800 shadow-lg">
              <CardHeader className="pb-4">
                <CardTitle className="text-zinc-100 flex items-center">
                  <Tag className="mr-2 h-5 w-5 text-zinc-400" />
                  Tags
                </CardTitle>
                <p className="text-sm text-zinc-400">
                  Add relevant tags to help readers discover your content
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4 min-h-[2.5rem]">
                  {tags.length > 0 ? (
                    tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="px-3 py-1.5 text-sm bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          className="ml-2 text-zinc-400 hover:text-red-400 transition-colors"
                          aria-label={`Remove ${tag} tag`}
                        >
                          <X size={14} />
                        </button>
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500 py-2">
                      No tags added yet. Click 'Add Tags' to get started.
                    </p>
                  )}
                </div>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <Tag className="mr-2 h-4 w-4" />
                      Add Tags
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-zinc-800">
                    <DialogHeader>
                      <DialogTitle className="text-zinc-100">
                        Add a new tag
                      </DialogTitle>
                      <DialogDescription className="text-zinc-400">
                        Enter a new tag for your blog post. Click add when
                        you're done.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <Input
                        placeholder="Enter tag name"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        className="bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-zinc-700 text-zinc-300"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setNewTag("");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handleAddTag}
                        className="bg-zinc-300 hover:bg-zinc-400"
                      >
                        Add Tag
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row justify-end gap-4 pt-6 border-t border-zinc-800">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isUploadingCardImage}
                className="bg-zinc-300 hover:bg-zinc-400 text-zinc-900"
              >
                {isUploadingCardImage ? "Uploading..." : "Publish Post"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateNewBlog;
