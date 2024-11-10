import React, { useState, useEffect } from 'react';
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

const SearchBar: React.FC<SearchBarProps> = ({ onTagSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTags, setFilteredTags] = useState<Tag[]>([]);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const response = await axios.get<Tag[]>('https://blogapp.kpisolkar24.workers.dev/api/tags');
        setFilteredTags(response.data);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };

    fetchTags();
  }, [searchQuery]);

  const handleInputChange = (query: string) => {
    setSearchQuery(query);
    if (query) {
      setFilteredTags((prevTags) => prevTags.filter(tag => tag.name.toLowerCase().includes(query.toLowerCase())));
    }
  };

  return (
    <div className="mt-[120px] mx-auto md:w-[800px] sm:w-[500px] w-[375px]">
      <Command>
        <CommandInput
          placeholder="Search tags..."
          value={searchQuery}
          onValueChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {isFocused && (
          <CommandList className="h-[120px]">
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Tags">
              {filteredTags.map(tag => (
                <CommandItem
                  key={tag.id}
                  onSelect={() => {
                    onTagSelect(tag.name);
                    console.log(tag.name);
                    setSearchQuery('');
                    setIsFocused(false);
                  }}
                >
                  <Hash className="mr-2 text-gray-500" size={16} />
                  {tag.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        )}
      </Command>
    </div>
  );
};

export default SearchBar;
