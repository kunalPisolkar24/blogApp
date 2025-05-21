import React, { useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { X, UploadCloud, Image as ImageIcon } from "lucide-react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  createPostSchema,
} from "@kunalpisolkar24/blogapp-common";
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
    <div>
      <StickyNavbar />
      <div className="container mx-auto px-4 mt-[70px] py-8">
        <form
          onSubmit={handleSubmit}
          className="space-y-8 bg-card p-6 sm:p-8 rounded-lg shadow-xl"
        >
          <div>
            <label
              htmlFor="blogTitle"
              className="block text-lg font-medium text-foreground mb-3"
            >
              Blog Title
            </label>
            <Input
              id="blogTitle"
              type="text"
              placeholder="Enter title for the blog"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-xl font-semibold p-3 blog-title-input"
              required
            />
          </div>

          <div>
            <label
              htmlFor="cardImageUpload"
              className="block text-lg font-medium text-foreground mb-3"
            >
              Blog Card Image (Recommended: 600x400)
            </label>
            <div
              className="mt-2 flex justify-center items-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md cursor-pointer h-64"
              style={{ borderColor: "hsl(var(--border))" }}
              onClick={() => cardImageInputRef.current?.click()}
            >
              <div className="space-y-1 text-center">
                {cardImagePreview ? (
                  <img
                    src={cardImagePreview}
                    alt="Card preview"
                    className="mx-auto h-48 object-contain rounded-md"
                  />
                ) : (
                  <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
                )}
                <div className="flex text-sm text-muted-foreground">
                  <span className="relative rounded-md font-medium text-primary hover:text-primary-focus focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary-focus">
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
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, GIF up to 10MB
                  </p>
                )}
                {cardImage && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {cardImage.name}
                  </p>
                )}
              </div>
            </div>
            {cardImageUrl && (
              <div className="mt-2 text-xs text-green-500 flex items-center">
                <ImageIcon size={14} className="mr-1" /> Image uploaded:{" "}
                <a
                  href={cardImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline ml-1 truncate max-w-[200px]"
                >
                  {cardImageUrl}
                </a>
              </div>
            )}
            {isUploadingCardImage && (
              <p className="text-sm text-primary mt-2">
                Uploading card image...
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="blogContent"
              className="block text-lg font-medium text-foreground mb-3"
            >
              Blog Content
            </label>
            <div className="blog-content-editor-wrapper rounded-md">
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
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Tags</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="px-3 py-1.5 text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-2 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Remove ${tag} tag`}
                    >
                      <X size={14} />
                    </button>
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No tags added yet. Click 'Add Tags' to get started.
                </p>
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
                    Enter a new tag for your blog post. Click add when you're
                    done.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <Input
                    placeholder="Enter tag name"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
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
                    onClick={() => {
                      setIsDialogOpen(false);
                      setNewTag("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleAddTag}>
                    Add Tag
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex justify-end space-x-4 pt-4 border-t border-border mt-8">
            <Button type="button" variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isUploadingCardImage}>
              Publish Post
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateNewBlog;
