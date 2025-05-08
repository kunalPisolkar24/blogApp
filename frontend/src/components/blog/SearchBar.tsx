import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Hash } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface Tag {
  id: number;
  name: string;
}

interface SearchBarProps {
  onTagSelect: (tag: string) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onTagSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [tagsToShow, setTagsToShow] = useState<Tag[]>([]);
  const [inputIsFocused, setInputIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const commandWrapperRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => {
      clearTimeout(timerId);
    };
  }, [searchQuery]);

  useEffect(() => {
    const fetchTags = async () => {
      if (!inputIsFocused && !debouncedSearchQuery.trim()) {
        setTagsToShow([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const response = await axios.get<Tag[]>(
          `${import.meta.env.VITE_BACKEND_URL}/api/tags?query=${encodeURIComponent(debouncedSearchQuery.trim())}`
        );
        if (inputIsFocused || debouncedSearchQuery.trim()) {
          setTagsToShow(response.data);
        } else {
          setTagsToShow([]);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
        setTagsToShow([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTags();
  }, [debouncedSearchQuery, inputIsFocused]);

  const handleInputChange = (query: string) => {
    setSearchQuery(query);
    if (!inputIsFocused && query) {
      setInputIsFocused(true);
    }
  };

  const handleSelectTag = (tag: Tag) => {
    onTagSelect(tag.name);
    setSearchQuery('');
    setInputIsFocused(false);
    const activeElement = document.activeElement as HTMLElement | null;
    if (activeElement && commandWrapperRef.current?.contains(activeElement)) {
        activeElement.blur();
    }
  };


  return (
    <div ref={commandWrapperRef} className="mt-[120px] mx-auto md:w-[800px] sm:w-[500px] w-[375px]">
      <Command
        shouldFilter={false}
        className="relative overflow-visible"
      >
        <CommandInput
          placeholder="Search tags..."
          value={searchQuery}
          onValueChange={handleInputChange}
          onFocus={() => setInputIsFocused(true)}
          onBlur={() => {
            setTimeout(() => {
              if (commandWrapperRef.current && !commandWrapperRef.current.contains(document.activeElement)) {
                setInputIsFocused(false);
              }
            }, 150);
          }}
        />
        {(inputIsFocused || searchQuery.trim() !== "" || isLoading) && (
            <CommandList
                className="absolute top-full w-full bg-card border rounded-md shadow-lg z-50 mt-1 max-h-[200px] overflow-y-auto"
            >
            {isLoading && (
              <div className="p-3 text-sm text-muted-foreground text-center">Loading...</div>
            )}
            {!isLoading && tagsToShow.length === 0 && (
              <CommandEmpty>
                {debouncedSearchQuery.trim() ? `No results for "${debouncedSearchQuery}".` : (inputIsFocused ? "Type to search tags." : "")}
              </CommandEmpty>
            )}
            {!isLoading && tagsToShow.length > 0 && (
              <CommandGroup heading="Suggestions">
                {tagsToShow.map(tag => (
                  <CommandItem
                    key={tag.id}
                    onSelect={() => handleSelectTag(tag)}
                    value={tag.name}
                    className="cursor-pointer"
                  >
                    <Hash className="mr-2 text-muted-foreground" size={16} />
                    {tag.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        )}
      </Command>
    </div>
  );
};