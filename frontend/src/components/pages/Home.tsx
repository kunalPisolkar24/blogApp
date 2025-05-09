import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StickyNavbar } from "../layouts";
import { BlogList } from "../blog";
import { SearchBar } from "../blog";

import { ErrorBoundary } from "../utils/";

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    const jwt = localStorage.getItem("jwt");
    if (!jwt) {
      navigate("/signin");
    }
  }, [navigate]);

  const handleTagSelect = (tag: string) => {
    setSelectedTag(tag);
  };

  return (
    <div className="min-h-screen bg-zinc-900/20">
      <StickyNavbar />

      <main className=" mx-auto md:pt-4 pt-8">
        <ErrorBoundary>
          <SearchBar onTagSelect={handleTagSelect} />
        </ErrorBoundary>
        <ErrorBoundary>
          <BlogList filterTag={selectedTag || ""} />
        </ErrorBoundary>
      </main>
    </div>
  );
};

export default Home;
