import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Home from "@/pages/Home";
import SearchResultsPage from "@/pages/SearchResultsPage";
import ViewBlogPage from "@/pages/ViewBlogPage";
import { LoadingSpinner } from "@/shared/ui/feedback/LoadingSpinner";
import { ProtectedRoute } from "@/app/routing/ProtectedRoute";
import { PublicOnlyRoute } from "@/app/routing/PublicOnlyRoute";

const Signup = lazy(() =>
  import("@/features/auth").then((module) => ({
    default: module.Signup,
  })),
);

const Signin = lazy(() =>
  import("@/features/auth").then((module) => ({
    default: module.Signin,
  })),
);

const CreateNewBlog = lazy(() =>
  import("@/pages/CreateNewBlog").then((module) => ({
    default: module.default,
  })),
);

const UserProfile = lazy(() =>
  import("@/pages/UserProfile").then((module) => ({
    default: module.default,
  })),
);

const ReviewQueuePage = lazy(() =>
  import("@/features/blog/review").then((module) => ({
    default: module.default,
  })),
);

export default function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route
          path="/signup"
          element={
            <PublicOnlyRoute>
              <Signup />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/signin"
          element={
            <PublicOnlyRoute>
              <Signin />
            </PublicOnlyRoute>
          }
        />
        <Route path="/" element={<Home />} />
        <Route path="/blog/:id" element={<ViewBlogPage />} />
        <Route
          path="/create-blog"
          element={
            <ProtectedRoute>
              <CreateNewBlog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <UserProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/review"
          element={
            <ProtectedRoute>
              <ReviewQueuePage />
            </ProtectedRoute>
          }
        />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
