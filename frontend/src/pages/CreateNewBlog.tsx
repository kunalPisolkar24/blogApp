"use client";

import type React from "react";
import { CheckCircle2, Circle, FileText, ImageIcon, Sparkles, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StickyNavbar, BlogEditor } from "@/widgets";
import {
  usePostAuthoringController,
  BlogTitleSection,
  AIDraftGenerator,
  FeaturedImageSection,
  BlogTagSection,
} from "@/features/blog";
import { useCreatePostDraft } from "@/features/blog/review";

const CreateNewBlog: React.FC = () => {
  const { state, setters, handlers, refs } = usePostAuthoringController({
    mode: "create",
  });
  const { submitForReview, isSubmitting: isSubmittingForReview } =
    useCreatePostDraft();
  const {
    contentText,
    isTitleReady: titleReady,
    isContentReady: contentReady,
    isCoverImageReady: imageReady,
  } = state;

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <StickyNavbar />

      <main className="container mx-auto px-4 pb-20 pt-app-navbar-offset sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <header className="relative overflow-hidden bg-surface-low p-5 ring-1 ring-outline-variant/20 sm:p-8 lg:p-10">
            <div
              className="absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgb(var(--outline-variant)/0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--outline-variant)/0.12)_1px,transparent_1px)] [background-size:4rem_4rem]"
              aria-hidden="true"
            />
            <div className="absolute right-0 top-0 h-28 w-28 bg-primary-container" aria-hidden="true" />
            <div className="relative max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 bg-primary-container px-3 py-2 text-primary-foreground">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.18em]">
                  Authoring Console
                </span>
              </div>
              <h1 className="text-4xl font-semibold leading-none tracking-[-0.05em] text-foreground md:text-6xl">
                Compose a precise Topos post.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
                Build the title, cover image, long-form body, and metadata in one focused publishing surface.
              </p>
            </div>
          </header>

          <form
            onSubmit={handlers.handleSubmit}
            className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
          >
            <div className="space-y-6">
              <BlogTitleSection
                value={state.title}
                onChange={setters.setTitle}
              />

              <AIDraftGenerator
                prompt={state.postPrompt}
                onPromptChange={setters.setPostPrompt}
                onGenerate={handlers.handleGeneratePost}
                isGenerating={state.isGeneratingPost}
                canGenerate={state.canGeneratePost}
                onClear={handlers.clearAIDraft}
                onSubmitForReview={() => void submitForReview(state.postPrompt)}
                isSubmittingForReview={isSubmittingForReview}
                summary={state.generatedSummary}
                isSummaryVisible={state.isSummaryVisible}
                onToggleSummary={handlers.toggleSummary}
              />

              <FeaturedImageSection
                preview={state.cardImagePreview}
                cardImage={state.cardImage}
                cardImageUrl={state.cardImageUrl}
                isUploading={state.isUploadingCardImage}
                onFileChange={handlers.handleCardImageChange}
                inputRef={refs.cardImageInputRef}
              />

              <BlogEditor
                ref={refs.quillRef}
                value={state.content}
                onChange={setters.setContent}
                onImageUpload={handlers.richTextimageHandler}
              />

              <BlogTagSection
                tags={state.tags}
                onRemoveTag={handlers.handleRemoveTag}
                isDialogOpen={state.isDialogOpen}
                setIsDialogOpen={setters.setIsDialogOpen}
                newTag={state.newTag}
                setNewTag={setters.setNewTag}
                onAddTag={handlers.handleAddTag}
                onGenerateTags={handlers.handleGenerateTags}
                isGeneratingTags={state.isGeneratingTags}
                canGenerateTags={state.canGenerateTags}
              />
            </div>

            <aside className="lg:sticky lg:top-app-navbar-offset lg:self-start">
              <div className="bg-surface-low p-4 ring-1 ring-outline-variant/20 sm:p-5">
                <p className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.22em] text-primary">
                  Publish Stack
                </p>
                <div className="mt-5 space-y-2">
                  <PublishChecklistItem
                    icon={FileText}
                    label="Title"
                    detail={titleReady ? "Ready" : "Required"}
                    complete={titleReady}
                  />
                  <PublishChecklistItem
                    icon={ImageIcon}
                    label="Cover"
                    detail={imageReady ? "Selected" : "Required"}
                    complete={imageReady}
                  />
                  <PublishChecklistItem
                    icon={FileText}
                    label="Body"
                    detail={contentReady ? `${contentText.length} chars` : "Required"}
                    complete={contentReady}
                  />
                  <PublishChecklistItem
                    icon={Tags}
                    label="Tags"
                    detail={`${state.tags.length} added`}
                    complete={state.tags.length > 0}
                  />
                </div>

                <div className="mt-5 bg-surface-lowest p-4 ring-1 ring-outline-variant/20">
                  <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Publishing Rule
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Title, body, and cover image are required. Tags improve discovery but remain optional.
                  </p>
                </div>

                <div className="mt-5 grid gap-3">
                  <Button
                    type="submit"
                    disabled={state.isSubmitting}
                    className="w-full"
                  >
                    {state.submitLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlers.handleCancel}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </aside>
          </form>
        </div>
      </main>
    </div>
  );
};

interface PublishChecklistItemProps {
  icon: React.ElementType;
  label: string;
  detail: string;
  complete: boolean;
}

const PublishChecklistItem: React.FC<PublishChecklistItemProps> = ({
  icon: Icon,
  label,
  detail,
  complete,
}) => (
  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-surface-lowest p-3 ring-1 ring-outline-variant/20">
    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
    <div className="min-w-0">
      <p className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-foreground">
        {label}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
    {complete ? (
      <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Complete" />
    ) : (
      <Circle className="h-4 w-4 text-muted-foreground" aria-label="Incomplete" />
    )}
  </div>
);

export default CreateNewBlog;
