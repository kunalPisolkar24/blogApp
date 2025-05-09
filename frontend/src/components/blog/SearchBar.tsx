import type React from "react"
import { useState, useEffect, useRef } from "react"
import axios from "axios"
import { Hash, Search, Loader2 } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface Tag {
  id: number
  name: string
}

interface SearchBarProps {
  onTagSelect: (tag: string) => void
}

export const SearchBar: React.FC<SearchBarProps> = ({ onTagSelect }) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [tagsToShow, setTagsToShow] = useState<Tag[]>([])
  const [inputIsFocused, setInputIsFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery)
  const commandWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)

    return () => {
      clearTimeout(timerId)
    }
  }, [searchQuery])

  useEffect(() => {
    const fetchTags = async () => {
      if (!inputIsFocused && !debouncedSearchQuery.trim()) {
        setTagsToShow([])
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      try {
        const response = await axios.get<Tag[]>(
          `${import.meta.env.VITE_BACKEND_URL}/api/tags?query=${encodeURIComponent(debouncedSearchQuery.trim())}`,
        )
        if (inputIsFocused || debouncedSearchQuery.trim()) {
          setTagsToShow(response.data)
        } else {
          setTagsToShow([])
        }
      } catch (error) {
        console.error("Error fetching tags:", error)
        setTagsToShow([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchTags()
  }, [debouncedSearchQuery, inputIsFocused])

  const handleInputChange = (query: string) => {
    setSearchQuery(query)
    if (!inputIsFocused && query) {
      setInputIsFocused(true)
    }
  }

  const handleSelectTag = (tag: Tag) => {
    onTagSelect(tag.name)
    setSearchQuery("")
    setInputIsFocused(false)
    const activeElement = document.activeElement as HTMLElement | null
    if (activeElement && commandWrapperRef.current?.contains(activeElement)) {
      activeElement.blur()
    }
  }

  return (
    <div ref={commandWrapperRef} className="w-full max-w-3xl mx-auto px-4 sm:px-6 mt-16 sm:mt-20">
      <Card className="border border-zinc-800 bg-zinc-900/80 backdrop-blur-sm shadow-lg rounded-xl overflow-hidden">
        <div className="relative">
          <Command shouldFilter={false} className="bg-transparent">
            <div className="flex items-center px-3 border-b border-zinc-800">
              <Search className="mr-2 h-4 w-4 shrink-0 text-zinc-400" />
              <CommandInput
                placeholder="Search tags..."
                value={searchQuery}
                onValueChange={handleInputChange}
                onFocus={() => setInputIsFocused(true)}
                onBlur={() => {
                  setTimeout(() => {
                    if (commandWrapperRef.current && !commandWrapperRef.current.contains(document.activeElement)) {
                      setInputIsFocused(false)
                    }
                  }, 150)
                }}
                className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-zinc-500 text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {(inputIsFocused || searchQuery.trim() !== "" || isLoading) && (
              <CommandList className="max-h-[300px] overflow-y-auto p-2">
                {isLoading && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                    <span className="ml-2 text-sm text-zinc-400">Searching tags...</span>
                  </div>
                )}

                {!isLoading && tagsToShow.length === 0 && (
                  <CommandEmpty className="py-6 text-center text-sm text-zinc-400">
                    {debouncedSearchQuery.trim()
                      ? `No results for "${debouncedSearchQuery}"`
                      : "Type to search for tags"}
                  </CommandEmpty>
                )}

                {!isLoading && tagsToShow.length > 0 && (
                  <CommandGroup
                    heading={
                      <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Suggestions</span>
                    }
                  >
                    {tagsToShow.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        onSelect={() => handleSelectTag(tag)}
                        value={tag.name}
                        className="cursor-pointer flex items-center px-2 py-2 rounded-lg hover:bg-zinc-800 transition-colors duration-200"
                      >
                        <Badge variant="outline" className="bg-zinc-800 text-zinc-300 border-zinc-700 mr-2">
                          <Hash className="mr-1 h-3 w-3 text-zinc-400" />
                          {tag.name}
                        </Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            )}
          </Command>
        </div>
      </Card>
    </div>
  )
}
