"use client";

import type React from "react";
import { Sparkles } from "lucide-react";
import { useParams } from "react-router-dom";
import { StickyNavbar } from "@/widgets";
import { ViewBlogPageSkeleton } from "@/shared/ui/feedback";
import {
  usePostViewerController,
  BlogEditForm,
  AISummaryDialog,
  BlogHeader,
  BlogBody,
  BlogRelatedSection,
  type PostForEditing,
} from "@/features/blog";
import { BlogAuthorSidebar } from "@/widgets";
import { useCurrentUser } from "@/entities/session";

const ViewBlogPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useCurrentUser();
  const { state, setView, setDialog, deletePost, refetch } =
    usePostViewerController(id);

  if (state.kind === "loading") return <ViewBlogPageSkeleton />;

  if (state.kind === "error" || state.kind === "not-found") {
    return (
      <div className="min-h-screen bg-surface text-foreground">
        <StickyNavbar />
        <main className="container mx-auto px-4 pb-20 pt-app-navbar-offset sm:px-5 lg:px-6">
          <div className="mx-auto max-w-3xl bg-surface-low p-6 ring-1 ring-outline-variant/20 sm:p-8">
            <p className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.22em] text-primary">
              Missing Article
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
              Blog post not found.
            </h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              The requested post may have been deleted or moved.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const { post, view, dialog, isDeleting } = state;
  const isAuthor = currentUser?.id === post.author.id;
  const editingPost: PostForEditing = {
    id: post.id,
    title: post.title,
    body: post.body,
    imageUrl: post.imageUrl,
    tags: post.tags,
  };
  const isEditView = view === "editing";
  const summaryOpen = dialog === "summary";
  const deleteDialogOpen = dialog === "delete";

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <StickyNavbar />
      <main className="container mx-auto px-4 pb-20 pt-app-navbar-offset sm:px-5 lg:px-6">
        <div className="mx-auto max-w-[88rem]">
          {isEditView ? (
            <>
              <header className="relative overflow-hidden bg-surface-low p-5 ring-1 ring-outline-variant/20 sm:p-8 lg:p-10 mb-6">
                <div
                  className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgb(var(--outline-variant)/0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--outline-variant)/0.12)_1px,transparent_1px)] [background-size:4rem_4rem]"
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-0 h-28 w-28 bg-primary-container" aria-hidden="true" />
                <div className="relative max-w-3xl">
                  <div className="mb-5 inline-flex items-center gap-2 bg-primary-container px-3 py-2 text-primary-foreground">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    <span className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.18em]">
                      Revision Console
                    </span>
                  </div>
                  <h1 className="text-4xl font-semibold leading-none tracking-[-0.05em] text-foreground md:text-6xl">
                    Revise your Topos post.
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                    Modify the title, cover image, body text, or tags. Saved revisions are updated instantly across all channels.
                  </p>
                </div>
              </header>

              <BlogEditForm
                blog={editingPost}
                onCancel={() => setView("reading")}
                onComplete={() => {
                  setView("reading");
                  refetch();
                }}
              />
            </>
          ) : (
            <>
              <BlogHeader
                title={post.title}
                imageUrl={post.imageUrl}
                createdAt={post.createdAt}
                updatedAt={post.updatedAt}
              />
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_384px]">
                <section className="min-w-0 space-y-6">
                  <BlogBody body={post.body} tags={post.tags} />
                  <div className="bg-surface-low p-4 ring-1 ring-outline-variant/20 sm:p-5">
                    <p className="mb-4 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.22em] text-primary">
                      Reading Utility
                    </p>
                    <AISummaryDialog
                      summary={post.summary}
                      summaryStatus={post.summaryStatus}
                      isOpen={summaryOpen}
                      onOpenChange={(open) =>
                        setDialog(open ? "summary" : "closed")
                      }
                    />
                  </div>
                  <BlogRelatedSection posts={post.related} />
                </section>

                <BlogAuthorSidebar
                  author={post.author}
                  isAuthor={isAuthor}
                  isEditing={isEditView}
                  onEdit={() => setView("editing")}
                  onDelete={deletePost}
                  isDeleting={isDeleting}
                  isDeleteDialogOpen={deleteDialogOpen}
                  setIsDeleteDialogOpen={(open) =>
                    setDialog(open ? "delete" : "closed")
                  }
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default ViewBlogPage;
