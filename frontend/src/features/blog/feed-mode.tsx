import { createContext, useContext } from "react";
import type { RecommendMode } from "@/shared/graphql/content-documents";

// FeedModeContext carries the recommendation feed mode (DEFAULT or
// SURPRISE) down to the post cards rendered inside the For You feed.
// null means the post was not shown in a recommendation feed (Latest,
// search, tag feeds, detail page), and its interactions stay
// unattributed to any feed mode.
const FeedModeContext = createContext<RecommendMode | null>(null);

export const FeedModeProvider = FeedModeContext.Provider;

export const useFeedMode = (): RecommendMode | null =>
  useContext(FeedModeContext);