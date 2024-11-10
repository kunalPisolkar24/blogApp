import React, { useState, useEffect } from 'react';
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, Settings, HelpCircle, LogOut, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';

const StickyNavbar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [userInitial, setUserInitial] = useState("U");
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('jwt');
    navigate('/signin');
  };

  useEffect(() => {
    const fetchUserInitial = async () => {
      const jwt = localStorage.getItem('jwt');
      if (jwt) {
        try {
          const decodedToken = JSON.parse(atob(jwt.split('.')[1]));
          const userId = decodedToken.id;

          const response = await axios.get(`https://blogapp.kpisolkar24.workers.dev/api/users/${userId}`);
          const username = response.data.username;
          const initial = username ? username.charAt(0).toUpperCase() : "U";
          setUserInitial(initial);

        } catch (error) {
          console.error("Error fetching user data:", error);
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            localStorage.removeItem('jwt');
            navigate('/signin');
          }
        }
      }
    };

    fetchUserInitial();
  }, [navigate]);

  const handleHomeClick = () => {
    window.location.href = '/';
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex-shrink-0 flex items-center">
            <button onClick={handleHomeClick} className="text-xl font-bold text-foreground">
              <span className="hidden sm:inline">blogApp</span>
              <span className="sm:hidden">bA</span>
            </button>
          </div>

          <div className="flex items-center">
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{userInitial}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <span>View Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/create-blog" className="flex items-center">
                    <Plus className="mr-2 h-4 w-4" />
                    <span>Create a Blog</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>Help</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default StickyNavbar;
