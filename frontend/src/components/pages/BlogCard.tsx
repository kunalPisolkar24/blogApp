import React from 'react';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

interface BlogCardProps {
  imageUrl: string;
  title: string;
  snippet: string;
  author: {
    name: string;
    avatarUrl: string;
  };
  tags: string[];
  slug: string;
  id: number; 
}

const BlogCard: React.FC<BlogCardProps> = ({ imageUrl, title, snippet, author, tags, slug, id }) => {
  return (
    <Link to={`/blog/${id}`} className="block"> 
      <Card className="overflow-hidden transition-all hover:bg-accent hover:shadow-lg">
        <div className="flex flex-col md:flex-row">
          <div className="md:w-2/5 md:order-2">
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-auto md:h-full object-cover"
            />
          </div>
          <div className="flex flex-col justify-between p-6 md:w-3/5 md:order-1">
            <CardHeader className="p-0">
              <h2 className="text-2xl font-bold mb-2">{title}</h2>
              <p className="text-muted-foreground mb-4">{snippet}</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex items-center space-x-4 mb-4 mb-2 mt-5">
                <Avatar>
                  <AvatarFallback>{author.name.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="font-semibold">{author.name}</span>
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2 p-0">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </CardFooter>
            <div className="mt-4">
              <span className="text-primary font-semibold hover:underline">Read More →</span>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
};

export default BlogCard;
