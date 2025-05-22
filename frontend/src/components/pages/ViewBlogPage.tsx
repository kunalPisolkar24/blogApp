import React, { useEffect, useState, useRef, useMemo } from "react";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { z } from "zod";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "../utils";
import { toast } from "../../hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  X,
  Trash2,
  Edit3,
  UploadCloud,
  Image as ImageIcon,
} from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StickyNavbar } from "../layouts";

const internalUpdatePostSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  body: z.string().min(1, "Body content is required").optional(),
  tags: z.array(z.string()).optional(),
  imageUrl: z.string().url("Invalid image URL format").nullable().optional(),
});
type InternalUpdatePostSchemaType = z.infer<typeof internalUpdatePostSchema>;

interface TagItem {
  postId: number;
  tagId: number;
  tag: {
    id: number;
    name: string;
  };
}

interface AuthorData {
  id: number;
  username: string;
  email: string;
}

interface Blog {
  id: number;
  title: string;
  body: string;
  imageUrl?: string | null;
  authorId: number;
  tags: TagItem[];
  author: AuthorData;
  createdAt: string;
  updatedAt: string;
}

const ViewBlogPage: React.FC = () => {
  const [blog, setBlog] = useState<Blog | null>(null);
  const [isAuthor, setIsAuthor] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNewTag, setEditNewTag] = useState("");
  const [editCardImage, setEditCardImage] = useState<File | null>(null);
  const [editCardImageUrl, setEditCardImageUrl] = useState<string | null>(null);
  const [editCardImagePreview, setEditCardImagePreview] = useState<
    string | null
  >(null);
  const [isUploadingCardImage, setIsUploadingCardImage] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const quillRef = useRef<ReactQuill>(null);
  const cardImageInputRef = useRef<HTMLInputElement>(null);

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${
    import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  }/image/upload`;
  const CLOUDINARY_UPLOAD_PRESET = import.meta.env
    .VITE_CLOUDINARY_UPLOAD_PRESET;

  useEffect(() => {
    const fetchBlogData = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get<Blog>(
          `${import.meta.env.VITE_BACKEND_URL}/api/posts/${id}`
        );
        setBlog(response.data);

        const jwt = localStorage.getItem("jwt");
        if (jwt) {
          try {
            const decodedToken = JSON.parse(atob(jwt.split(".")[1]));
            const userId = decodedToken.id;
            setIsAuthor(userId === response.data.authorId);
          } catch (e) {
            console.error("Error decoding JWT:", e);
            setIsAuthor(false);
          }
        }
      } catch (error) {
        console.error("Failed to fetch blog data:", error);
        toast({
          title: "Error",
          description: "Could not load blog post.",
          variant: "destructive",
        });
        navigate("/");
      } finally {
        setIsLoading(false);
      }
    };

    if (id) {
      fetchBlogData();
    }
  }, [id, navigate]);

  const confirmDelete = async () => {
    try {
      const jwt = localStorage.getItem("jwt");
      if (!jwt) {
        throw new Error("No token found");
      }
      await axios.delete(
        `${import.meta.env.VITE_BACKEND_URL}/api/posts/${id}`,
        { headers: { Authorization: `Bearer ${jwt}` } }
      );
      toast({
        title: "Blog Deleted",
        description: "Your blog post has been successfully deleted.",
      });
      navigate("/");
    } catch (error) {
      console.error("Error deleting blog:", error);
      toast({
        title: "Error",
        description: "Failed to delete the blog post.",
        variant: "destructive",
      });
    } finally {
      setIsDeleteDialogOpen(false);
    }
  };

  const handleEditCardImageChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      setEditCardImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditCardImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setEditCardImageUrl(null);
    }
  };

  const uploadEditCardImageToCloudinary = async () => {
    if (!editCardImage) return editCardImageUrl;

    if (!CLOUDINARY_URL || !CLOUDINARY_UPLOAD_PRESET) {
      toast({
        title: "Upload Error",
        description: "Cloudinary configuration missing.",
        variant: "destructive",
      });
      return null;
    }

    const formData = new FormData();
    formData.append("file", editCardImage);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    setIsUploadingCardImage(true);
    try {
      toast({ title: "Uploading Card Image...", description: "Please wait." });
      const response = await axios.post(CLOUDINARY_URL, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
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

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blog) return;

    let finalCardImageUrl = editCardImageUrl;

    if (editCardImage) {
      const uploadedUrl = await uploadEditCardImageToCloudinary();
      if (!uploadedUrl && editCardImage) {
        toast({
          title: "Image Upload Failed",
          description:
            "Card image could not be uploaded. Please try again or remove the new image.",
          variant: "destructive",
        });
        return;
      }
      finalCardImageUrl = uploadedUrl;
    }

    try {
      const jwt = localStorage.getItem("jwt");
      if (!jwt) throw new Error("No token found");

      const blogData: InternalUpdatePostSchemaType = {
        title: editTitle === blog.title ? undefined : editTitle,
        body: editContent === blog.body ? undefined : editContent,
        tags:
          JSON.stringify(editTags) ===
          JSON.stringify(blog.tags.map((t) => t.tag.name))
            ? undefined
            : editTags,
        imageUrl:
          finalCardImageUrl === blog.imageUrl ? undefined : finalCardImageUrl,
      };

      const updatePayload: Partial<InternalUpdatePostSchemaType> = {};
      if (blogData.title !== undefined) updatePayload.title = blogData.title;
      if (blogData.body !== undefined) updatePayload.body = blogData.body;
      if (blogData.tags !== undefined) updatePayload.tags = blogData.tags;
      if (blogData.imageUrl !== undefined)
        updatePayload.imageUrl = blogData.imageUrl;

      if (Object.keys(updatePayload).length === 0) {
        toast({
          title: "No Changes",
          description: "No changes were made to the blog post.",
        });
        setIsEditing(false);
        return;
      }

      const parsedData = internalUpdatePostSchema.parse(updatePayload);

      await axios.put(
        `${import.meta.env.VITE_BACKEND_URL}/api/posts/${id}`,
        parsedData,
        { headers: { Authorization: `Bearer ${jwt}` } }
      );

      toast({
        title: "Blog Updated",
        description: "Your blog post has been successfully updated.",
      });
      setIsEditing(false);
      const response = await axios.get<Blog>(
        `${import.meta.env.VITE_BACKEND_URL}/api/posts/${id}`
      );
      setBlog(response.data);
    } catch (error: any) {
      console.error("Error updating blog:", error);
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
          description: "Failed to update the blog post.",
          variant: "destructive",
        });
      }
    }
  };

  const handleEdit = () => {
    if (blog) {
      setEditTitle(blog.title);
      setEditContent(blog.body);
      setEditTags(blog.tags.map((tagItem) => tagItem.tag.name));
      setEditCardImageUrl(blog.imageUrl || null);
      setEditCardImagePreview(blog.imageUrl || null);
      setEditCardImage(null);
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

  const handleAddEditTag = () => {
    if (editNewTag.trim() && !editTags.includes(editNewTag.trim())) {
      setEditTags([...editTags, editNewTag.trim()]);
      setEditNewTag("");
    }
  };

  const handleRemoveEditTag = (tagToRemove: string) => {
    setEditTags(editTags.filter((tag) => tag !== tagToRemove));
  };

  const richTextimageHandler = async () => {
    if (!CLOUDINARY_URL || !CLOUDINARY_UPLOAD_PRESET) {
      toast({
        title: "Upload Error",
        description: "Cloudinary configuration missing.",
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

  if (isLoading) return <LoadingSpinner />;
  if (!blog)
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        Blog post not found.
      </div>
    );

  const authorAvatarUrl = `https://i.pravatar.cc/128?u=${encodeURIComponent(
    blog.author.username
  )}`;
  const cleanBlogBody = DOMPurify.sanitize(blog.body);

  return (
    <div>
      <StickyNavbar />
      <div className="container mx-auto px-4 py-8 mt-[50px]">
        {blog.imageUrl && !isEditing && (
          <div className="mb-8 rounded-lg overflow-hidden shadow-lg">
            <img
              src={blog.imageUrl}
              alt={blog.title}
              className="w-full h-auto max-h-[400px] object-cover"
            />
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-8">
          <main className="flex-1">
            {isEditing ? (
              <form
                onSubmit={handleUpdate}
                className="space-y-8 bg-card p-6 rounded-lg shadow-md"
              >
                <div>
                  <label
                    htmlFor="editBlogTitle"
                    className="block text-lg font-medium text-foreground mb-2"
                  >
                    Edit Title
                  </label>
                  <Input
                    id="editBlogTitle"
                    type="text"
                    placeholder="Enter title for the blog"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="text-2xl font-bold p-4 blog-title-input"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="editCardImageUpload"
                    className="block text-lg font-medium text-foreground mb-2"
                  >
                    Blog Card Image (Recommended: 600x400)
                  </label>
                  <div
                    className="mt-1 flex justify-center items-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md cursor-pointer h-60"
                    style={{ borderColor: "hsl(var(--border))" }}
                    onClick={() => cardImageInputRef.current?.click()}
                  >
                    <div className="space-y-1 text-center">
                      {editCardImagePreview ? (
                        <img
                          src={editCardImagePreview}
                          alt="Card preview"
                          className="mx-auto h-40 object-contain rounded-md"
                        />
                      ) : (
                        <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground" />
                      )}
                      <div className="flex text-sm text-muted-foreground">
                        <span className="relative rounded-md font-medium text-primary hover:text-primary-focus">
                          {editCardImage
                            ? "Change image"
                            : editCardImageUrl
                            ? "Change image"
                            : "Upload an image"}
                        </span>
                        <input
                          id="editCardImageUpload"
                          name="editCardImageUpload"
                          type="file"
                          className="sr-only"
                          accept="image/*"
                          ref={cardImageInputRef}
                          onChange={handleEditCardImageChange}
                        />
                      </div>
                      {!editCardImagePreview && (
                        <p className="text-xs text-muted-foreground">
                          PNG, JPG, GIF
                        </p>
                      )}
                      {editCardImage && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {editCardImage.name}
                        </p>
                      )}
                    </div>
                  </div>
                  {isUploadingCardImage && (
                    <p className="text-sm text-primary mt-2">
                      Uploading card image...
                    </p>
                  )}
                  {editCardImageUrl && !editCardImage && (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-destructive mt-1 p-0 h-auto"
                      onClick={() => {
                        setEditCardImageUrl(null);
                        setEditCardImagePreview(null);
                      }}
                    >
                      Remove current card image
                    </Button>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="editBlogContent"
                    className="block text-lg font-medium text-foreground mb-2"
                  >
                    Edit Content
                  </label>
                  <div className="blog-content-editor-wrapper rounded-md">
                    <ReactQuill
                      ref={quillRef}
                      theme="snow"
                      value={editContent}
                      onChange={setEditContent}
                      modules={modules}
                      formats={formats}
                      placeholder="Write your masterpiece here..."
                      id="editBlogContent"
                      bounds={".blog-content-editor-wrapper"}
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-2">Edit Tags</h3>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {editTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="px-3 py-1"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleRemoveEditTag(tag)}
                          className="ml-2 text-xs"
                          aria-label={`Remove ${tag} tag`}
                        >
                          <X size={12} />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Add Tag
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Tag</DialogTitle>
                        <DialogDescription>
                          Enter the tag name.
                        </DialogDescription>
                      </DialogHeader>
                      <Input
                        placeholder="Enter tag name"
                        value={editNewTag}
                        onChange={(e) => setEditNewTag(e.target.value)}
                        className="mb-4"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddEditTag();
                          }
                        }}
                      />
                      <DialogFooter>
                        <Button type="button" onClick={handleAddEditTag}>
                          Add
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="flex justify-end space-x-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isUploadingCardImage}>
                    Save Changes
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <h1 className="text-4xl lg:text-5xl font-bold mb-4 view-blog-title">
                  {blog.title}
                </h1>
                <div className="flex items-center space-x-2 text-xs text-muted-foreground mb-6 md:sm">
                  <span>
                    Published on{" "}
                    {new Date(blog.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                  {blog.createdAt !== blog.updatedAt && (
                    <span>
                      (Updated on{" "}
                      {new Date(blog.updatedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                      )
                    </span>
                  )}
                </div>
                <div
                  className="prose prose-lg dark:prose-invert max-w-none mb-8 quill-content-view"
                  dangerouslySetInnerHTML={{ __html: cleanBlogBody }}
                />
                <div className="flex flex-wrap gap-2">
                  {blog.tags.map((tagItem) => (
                    <Badge
                      key={tagItem.tag.id}
                      variant="secondary"
                      className="hover:bg-secondary/80 transition-colors cursor-pointer"
                      onClick={() => navigate(`/tag/${tagItem.tag.name}`)}
                    >
                      {tagItem.tag.name}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </main>

          <aside className="w-full md:w-1/3 md:max-w-xs lg:max-w-sm">
            <Card className="sticky top-20 shadow-lg">
              <CardHeader className="text-center border-b">
                <Avatar className="w-24 h-24 mx-auto mb-4 border-2 border-primary">
                  <AvatarImage
                    src={authorAvatarUrl}
                    alt={blog.author.username}
                  />
                  <AvatarFallback className="text-4xl bg-muted">
                    {blog.author.username.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <CardTitle className="text-xl mb-1">
                  {blog.author.username}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {blog.author.email}
                </p>
              </CardHeader>
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-2 text-foreground">
                  About Author
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  A passionate writer and tech enthusiast sharing insights on
                  various topics.
                </p>
                {isAuthor && !isEditing && (
                  <div className="flex flex-col space-y-3">
                    <Button
                      variant="outline"
                      onClick={handleEdit}
                      className="w-full"
                    >
                      <Edit3 size={16} className="mr-2" /> Update Blog
                    </Button>
                    <AlertDialog
                      open={isDeleteDialogOpen}
                      onOpenChange={setIsDeleteDialogOpen}
                    >
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="w-full">
                          <Trash2 size={16} className="mr-2" /> Delete Blog
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Are you absolutely sure?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently
                            delete your blog post and remove its data from our
                            servers.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={confirmDelete}>
                            Continue
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
