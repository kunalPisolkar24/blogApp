import { HttpResponse, graphql } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApolloProvider } from "@apollo/client/react";
import { MemoryRouter } from "react-router-dom";
import type { ApolloClient } from "@apollo/client";
import { server } from "@/test/server";
import { createApolloClient } from "@/shared/api";
import { env } from "@/shared/config/env";
import { sessionStoreActions } from "@/entities/session";
import {
  type PostDraft,
} from "@/shared/graphql/content-documents";
import { useReviewQueueController } from "../useReviewQueueController";

const noopUnauthorized = async () => {};

const buildDraft = (overrides: Partial<PostDraft> = {}): PostDraft => ({
  __typename: "PostDraft",
  id: "d1",
  approvalId: "ap-1",
  prompt: "write about go",
  title: "Generated title",
  body: "<p>body</p>",
  summary: "A summary",
  tags: ["go"],
  status: "PENDING",
  authorId: "author-9",
  postId: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const communityDraft = buildDraft();

const setupHandlers = (
  overrides?: {
    postDrafts?: PostDraft[];
    myPostDrafts?: PostDraft[];
    failApprove?: boolean;
  },
) => {
  const graphqlApi = graphql.link("http://localhost:4000/graphql");
  const approvedVariables: unknown[] = [];
  server.use(
    graphqlApi.query("PostDrafts", () =>
      HttpResponse.json({
        data: {
          postDrafts: {
            __typename: "PaginatedPostDrafts",
            drafts: overrides?.postDrafts ?? [communityDraft],
            totalPages: 1,
            currentPage: 1,
            totalDrafts: overrides?.postDrafts?.length ?? 1,
          },
        },
      }),
    ),
    graphqlApi.query("MyPostDrafts", () =>
      HttpResponse.json({
        data: {
          myPostDrafts: {
            __typename: "PaginatedPostDrafts",
            drafts: overrides?.myPostDrafts ?? [],
            totalPages: 1,
            currentPage: 1,
            totalDrafts: overrides?.myPostDrafts?.length ?? 0,
          },
        },
      }),
    ),
    graphqlApi.mutation("ApprovePostDraft", async ({ variables }) => {
      approvedVariables.push(variables);
      if (overrides?.failApprove) {
        return HttpResponse.json({
          errors: [{ message: "forbidden" }],
        });
      }
      const draft =
        overrides?.postDrafts?.find((d) => d.id === variables.id) ??
        communityDraft;
      return HttpResponse.json({
        data: {
          approvePostDraft: {
            ...draft,
            status: "APPROVED",
            ...(variables.input?.title ? { title: variables.input.title } : {}),
          },
        },
      });
    }),
  );
  return { approvedVariables };
};

const createWrapper = () => {
  let client!: ApolloClient;
  const wrapper = ({ children }: { children: ReactNode }) => {
    if (!client) {
      client = createApolloClient({
        uri: env.VITE_GRAPHQL_URL,
        getToken: () => null,
        onUnauthorized: noopUnauthorized,
      });
    }
    return (
      <ApolloProvider client={client}>
        <MemoryRouter initialEntries={["/review"]}>{children}</MemoryRouter>
      </ApolloProvider>
    );
  };
  return { wrapper, getClient: () => client };
};

describe("useReviewQueueController", () => {
  beforeEach(() => {
    sessionStoreActions.markAuthenticated("test-token");
  });

  it("loads the community queue and own drafts separately", async () => {
    const { wrapper } = createWrapper();
    setupHandlers();

    const { result } = renderHook(() => useReviewQueueController(), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.community.section).toBe("ready");
      expect(result.current.mine.section).toBe("ready");
    });

    expect(result.current.community.data.drafts).toHaveLength(1);
    expect(result.current.community.data.drafts[0].id).toBe("d1");
    expect(result.current.mine.data.drafts).toHaveLength(0);
  });

  it("approves a peer draft and refreshes both queues", async () => {
    const { wrapper, getClient } = createWrapper();
    const { approvedVariables } = setupHandlers();

    const { result } = renderHook(() => useReviewQueueController(), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.community.section).toBe("ready");
    });

    const refetchSpy = vi.spyOn(getClient(), "refetchQueries");

    await act(async () => {
      await result.current.approve("d1", { title: "Edited title" });
    });

    expect(approvedVariables[0]).toEqual({
      id: "d1",
      input: { title: "Edited title" },
    });
    expect(refetchSpy).toHaveBeenCalledWith({
      include: ["PostDrafts", "MyPostDrafts"],
    });
    // The list refetched with server truth.
    expect(result.current.community.data.drafts[0]?.status).toBe("PENDING");
  });

  it("rolls the optimistic status back when approval fails", async () => {
    const { wrapper } = createWrapper();
    setupHandlers({ failApprove: true });

    const { result } = renderHook(() => useReviewQueueController(), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.community.section).toBe("ready");
    });
    expect(result.current.community.data.drafts[0]?.status).toBe("PENDING");

    await act(async () => {
      await result.current.approve("d1", {});
    });

    expect(result.current.community.data.drafts[0]?.status).toBe("PENDING");
  });
});
