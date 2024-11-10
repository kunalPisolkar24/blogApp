import React, { useState, useEffect } from 'react';

interface UseRandomImageProps {
  folderPath: string;
  defaultImage?: string;
}

interface UseRandomImageReturn {
  imageUrl: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

const useRandomImage = ({
  folderPath,
  defaultImage = '/defaultBlogImage.jpg',
}: UseRandomImageProps): UseRandomImageReturn => {
  const [imageUrl, setImageUrl] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchImages() {
      setIsLoading(true);
      setError(null);
      try {
        // Using Vite's glob import feature
        const images = import.meta.glob('/src/assets/blogApp/**/*.{png,jpg,jpeg,svg}', {
          eager: true,
          import: 'default'
        });

        // Convert object to array of URLs
        const imageUrls = Object.values(images) as string[];

        if (imageUrls.length === 0) {
          throw new Error('No images found in the specified directory');
        }

        const randomIndex = Math.floor(Math.random() * imageUrls.length);
        setImageUrl(imageUrls[randomIndex]);
      } catch (err) {
        console.error('Error importing images:', err);
        setError(err instanceof Error ? err : new Error('Failed to load images'));
        setImageUrl(defaultImage);
      } finally {
        setIsLoading(false);
      }
    }

    fetchImages();
  }, [folderPath, defaultImage]);

  return { imageUrl, isLoading, error };
};

export default useRandomImage;
