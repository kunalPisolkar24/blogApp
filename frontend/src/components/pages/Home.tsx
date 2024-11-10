import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StickyNavbar from './StickyNavbar';
import BlogList from './BlogList';
import SearchBar from './SearchBar';

import ErrorBoundary from './ErrorBoundary';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    const jwt = localStorage.getItem('jwt');
    if (!jwt) {
      navigate('/signin');
    }
  }, [navigate]);

  const handleTagSelect = (tag: string) => {
    setSelectedTag(tag);
  };

  return (
    <div>
      <StickyNavbar />
      <ErrorBoundary>
        <SearchBar onTagSelect={handleTagSelect} />
      </ErrorBoundary>
      <ErrorBoundary>
        <BlogList filterTag={selectedTag || ''} />
      </ErrorBoundary>
    </div>
  );
};

export default Home;
