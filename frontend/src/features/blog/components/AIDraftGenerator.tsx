import type React from "react";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface AIDraftGeneratorProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  canGenerate: boolean;
  onClear: () => void;
  summary: string | null;
  isSummaryVisible: boolean;
  onToggleSummary: () => void;
  // Optional peer-review path: submits the same prompt to
  // createPostDraft so the generated post waits for another user's
  // approval instead of landing in the editor.
  onSubmitForReview?: () => void;
  isSubmittingForReview?: boolean;
}

export const AIDraftGenerator: React.FC<AIDraftGeneratorProps> = ({
  prompt,
  onPromptChange,
  onGenerate,
  isGenerating,
  canGenerate,
  onClear,
  summary,
  isSummaryVisible,
  onToggleSummary,
  onSubmitForReview,
  isSubmittingForReview = false,
}) => {
  return (
    <Card className="gap-0 bg-surface-lowest py-0">
      <CardHeader className="bg-primary-container p-4 text-primary-foreground sm:p-5">
        <p className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.22em] text-primary-foreground/80">
          02 // Assisted Draft
        </p>
        <CardTitle className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-[-0.04em]">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
          Generate from a brief
        </CardTitle>
        <p className="max-w-2xl text-sm leading-6 text-primary-foreground/70">
          Optional accelerator. Generated output replaces the current title, body, and tags.
        </p>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <div className="space-y-5">
          <label
            htmlFor="draftPrompt"
            className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-muted-foreground"
          >
            Draft prompt
          </label>
          <Textarea
            id="draftPrompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Describe the reader, argument, structure, and constraints..."
            className="blog-draft-input min-h-32 bg-surface-lowest leading-7"
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating || !canGenerate}
              className="sm:w-auto"
            >
              {isGenerating ? "Generating..." : "Generate Draft"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClear}
              disabled={!prompt && !summary}
              className="sm:w-auto"
            >
              Clear Prompt
            </Button>
            {onSubmitForReview && (
              <Button
                type="button"
                variant="outline"
                onClick={onSubmitForReview}
                disabled={isSubmittingForReview || !canGenerate}
                className="sm:w-auto"
              >
                {isSubmittingForReview
                  ? "Submitting..."
                  : "Submit for Peer Review"}
              </Button>
            )}
          </div>
          {summary && (
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                onClick={onToggleSummary}
              >
                {isSummaryVisible ? "Hide Summary" : "View Summary"}
              </Button>
              {isSummaryVisible && (
                <div className="bg-surface-low p-4 ring-1 ring-outline-variant/20">
                  <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
                    Generated Summary
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">
                    {summary}
                  </p>
                </div>
              )}
            </div>
          )}
          <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">
            Minimum useful prompt: topic + audience + angle + constraints.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
